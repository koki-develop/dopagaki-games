import { useEffect, useState, useSyncExternalStore } from 'react';
import { createControllerStore, createPortRelay, hasNextStage } from '../../games/breakout/controller.ts';
import type { ControllerEvent } from '../../games/breakout/controller.ts';
import { HudFeed } from '../../games/breakout/hud/feed.ts';
import { breakoutRecords } from '../../games/breakout/records.ts';
import { createGameSession } from '../../games/breakout/session.ts';
import type { FatalCause, SessionCallbacks, SessionEvent, SessionHandle } from '../../games/breakout/types.ts';
import { errorMessage } from '../../shared/errors.ts';
import SettingsPanel from '../SettingsPanel.tsx';
import ConfirmDialog from '../ui/ConfirmDialog.tsx';
import { LoadingOverlay } from '../ui/LoadingScreen.tsx';
import Overlay from '../ui/Overlay.tsx';
import { hrefOf } from '../router.ts';
import DevPanel from './DevPanel.tsx';
import Hud from './Hud.tsx';
import PauseView from './PauseView.tsx';
import ReadyView from './ReadyView.tsx';
import ResultView from './ResultView.tsx';
import StageSelectView from './StageSelectView.tsx';
import TitleView from './TitleView.tsx';

const fromSession = (e: SessionEvent): ControllerEvent => {
  switch (e.t) {
    case 'runEnding':
      return { t: 'runEnding' };
    case 'finished':
      return { t: 'finished', result: e.result };
    case 'fatal':
      return { t: 'fatal', cause: e.cause, message: e.message };
  }
};

/** エラー画面の説明。原因ごとに、何ができなかったかを書く */
const FATAL_TEXT: Record<FatalCause, string> = {
  init: 'このブラウザでは、ゲームの描画（WebGPU / WebGL2）を始められませんでした。',
  lost: 'GPU との接続が切れ、ゲームの描画を作り直せませんでした。',
  internal: 'ゲームの処理で問題が起きたため、続けられませんでした。',
};

/** 確認ダイアログの文言。どちらも今のプレイは記録されずに消える */
const CONFIRM = {
  confirmRetry: { title: 'やり直す？', confirmLabel: 'やり直す' },
  confirmTitle: { title: 'タイトルへ戻る？', confirmLabel: 'タイトルへ' },
} as const;

/**
 * ブロック崩しの画面。どの画面を出すかは状態機械（controller.ts）が決め、ここはその表示とイベントの受け渡しだけを行う。
 * ゲーム本体（GameSession）はこの画面が表示されている間だけ生きている。
 */
export default function BreakoutScreen() {
  const records = breakoutRecords();
  const [relay] = useState(createPortRelay);
  const [store] = useState(() => createControllerStore(relay, records, () => performance.now()));
  const [hudFeed] = useState(() => new HudFeed());
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [session, setSession] = useState<SessionHandle | null>(null);

  const phase = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const rec = useSyncExternalStore(records.subscribe, records.get);
  const dispatch = store.dispatch;

  // ゲーム本体（レンダラー）の作成と破棄
  useEffect(() => {
    if (!stageEl) return;
    let cancelled = false;
    let handle: SessionHandle | null = null;
    const callbacks: SessionCallbacks = {
      onEvent: (e) => {
        if (!cancelled) store.dispatch(fromSession(e));
      },
      onHud: (s) => {
        if (!cancelled) hudFeed.push(s);
      },
    };
    createGameSession(stageEl, callbacks).then(
      (s: SessionHandle) => {
        if (cancelled) {
          s.dispose();
          return;
        }
        handle = s;
        relay.bind(s);
        setSession(s);
        store.dispatch({ t: 'loaded' });
      },
      (e: unknown) => {
        if (!cancelled) store.dispatch({ t: 'fatal', cause: 'init', message: errorMessage(e) });
      },
    );
    return () => {
      cancelled = true;
      relay.bind(null);
      handle?.dispose();
      setSession(null);
    };
  }, [stageEl, store, relay, hudFeed]);

  // タブが隠れたら一時停止する（プレイ中だけ。判断は状態機械が行う）
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') store.dispatch({ t: 'hidden' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [store]);

  // Escape: 開いているものを閉じる。プレイ中なら一時停止する
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.repeat) store.dispatch({ t: 'escape' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  // キーの押しっぱなしによる自動の繰り返しでは、ボタンを押さない。
  // 画面が切り替わると次の画面のボタンにフォーカスが移るので、押し続けた Enter が次の操作まで進めてしまうのを防ぐ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target instanceof HTMLButtonElement) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  const mode = 'mode' in phase ? phase.mode : null;
  const hudVisible = phase.k === 'ready' || phase.k === 'playing' || phase.k === 'paused' || phase.k === 'ending';
  const sheet = phase.k === 'title' || phase.k === 'paused' ? phase.sheet : null;

  return (
    <div className="screen">
      <div ref={setStageEl} className="stage" />

      <Hud
        feed={hudFeed}
        session={session}
        visible={hudVisible}
        showLives={mode?.kind === 'stage'}
        canPause={phase.k === 'playing'}
        onPause={() => dispatch({ t: 'pause' })}
      />

      {phase.k === 'loading' && <LoadingOverlay />}

      {phase.k === 'title' && (
        <TitleView
          records={rec}
          onEndless={() => dispatch({ t: 'choose', mode: { kind: 'endless' } })}
          onStages={() => dispatch({ t: 'openStages' })}
          onSettings={() => dispatch({ t: 'openSettings' })}
          portalHref={hrefOf('portal')}
        />
      )}

      {phase.k === 'stages' && (
        <StageSelectView
          records={rec}
          onChoose={(index) => dispatch({ t: 'choose', mode: { kind: 'stage', index } })}
          onBack={() => dispatch({ t: 'back' })}
        />
      )}

      {phase.k === 'ready' && <ReadyView mode={phase.mode} onStart={() => dispatch({ t: 'start' })} />}

      {phase.k === 'paused' && (
        <PauseView
          hidden={phase.sheet === 'confirmRetry' || phase.sheet === 'confirmTitle'}
          onResume={() => dispatch({ t: 'resume' })}
          onAskRetry={() => dispatch({ t: 'askRetry' })}
          onSettings={() => dispatch({ t: 'openSettings' })}
          onAskTitle={() => dispatch({ t: 'askTitle' })}
        />
      )}

      {(sheet === 'confirmRetry' || sheet === 'confirmTitle') && (
        <ConfirmDialog
          key={sheet}
          title={CONFIRM[sheet].title}
          message="今のスコアは記録されません"
          confirmLabel={CONFIRM[sheet].confirmLabel}
          onConfirm={() => dispatch({ t: 'confirm' })}
          onCancel={() => dispatch({ t: 'cancel' })}
        />
      )}

      {phase.k === 'result' && (
        <ResultView
          result={phase.result}
          onRetry={() => dispatch({ t: 'retry' })}
          onNext={hasNextStage(phase.result, records.stageCount) ? () => dispatch({ t: 'next' }) : null}
          onTitle={() => dispatch({ t: 'toTitle' })}
        />
      )}

      {phase.k === 'error' && (
        <Overlay tone="solid">
          <div className="panel" role="alert">
            <h2 className="panel-title">表示できませんでした</h2>
            <p>{FATAL_TEXT[phase.cause]}</p>
            <p className="muted small">{phase.message}</p>
            <div className="panel-actions">
              <a className="btn" href={hrefOf('portal')}>
                もどる
              </a>
            </div>
          </div>
        </Overlay>
      )}

      {sheet === 'settings' && <SettingsPanel onClose={() => dispatch({ t: 'closeSettings' })} />}

      {import.meta.env.DEV && session && phase.k !== 'error' && <DevPanel session={session} />}
    </div>
  );
}
