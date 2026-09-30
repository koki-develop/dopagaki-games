import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createControllerStore } from '../../games/reversi/controller.ts';
import { reversiPrefs, reversiRecords } from '../../games/reversi/records.ts';
import type { Color } from '../../games/reversi/rules/position.ts';
import { createGameSession } from '../../games/reversi/session.ts';
import { reversiSettings, REVERSI_SETTING_ITEMS } from '../../games/reversi/settings.ts';
import type { GamePort, HudState, SessionHandle } from '../../games/reversi/types.ts';
import { errorMessage } from '../../shared/errors.ts';
import { EventFeed, LatestFeed } from '../../shared/feed.ts';
import { createPortRelay } from '../../shared/port-relay.ts';
import FatalView from '../game/FatalView.tsx';
import GameSheets from '../game/GameSheets.tsx';
import { useGameSession } from '../game/useGameSession.ts';
import type { SessionBinding } from '../game/useGameSession.ts';
import { useScreenGuards } from '../game/useScreenGuards.ts';
import { LoadingOverlay } from '../ui/LoadingScreen.tsx';
import Callouts from './Callouts.tsx';
import type { CalloutEvent } from './Callouts.tsx';
import DevPanel from './DevPanel.tsx';
import Hud from './Hud.tsx';
import ResultView from './ResultView.tsx';
import TitleView from './TitleView.tsx';

/**
 * リバーシの画面。どの画面を出すかは状態機械（controller.ts）が決め、ここはその表示とイベントの受け渡しだけを行う。
 * ゲーム本体（GameSession）はこの画面が表示されている間だけ生きている。
 */
export default function ReversiScreen() {
  const records = reversiRecords();
  const prefs = reversiPrefs();
  const [relay] = useState(() => createPortRelay<GamePort>({ start: true, setPaused: true, endRun: true }));
  const [store] = useState(() => createControllerStore(relay, records, () => performance.now()));
  const [hudFeed] = useState(() => new LatestFeed<HudState>());
  const [calloutFeed] = useState(() => new EventFeed<CalloutEvent>());
  const [announceFeed] = useState(() => new EventFeed<string>());
  const [binding] = useState(
    (): SessionBinding<SessionHandle> => ({
      start: (el, alive) =>
        createGameSession(el, {
          onEvent: (e) => {
            if (!alive()) return;
            // 新しい対局が始まったら、前の対局の盤の上の文字を片付ける。始まりの知らせは、その対局の文字より先に届く
            if (e.t === 'started') calloutFeed.push({ kind: 'newRun' });
            // 結果が確定したら（儀式を飛ばしたときも）、集計と決着を片付ける
            if (e.t === 'finished') calloutFeed.push({ kind: 'ceremonyEnd' });
            store.dispatch(e);
          },
          onHud: (s) => {
            if (alive()) hudFeed.push(s);
          },
          onCallout: (c) => {
            if (alive()) calloutFeed.push(c);
          },
          onAnnounce: (text) => {
            if (alive()) announceFeed.push(text);
          },
        }),
      bind: (s) => relay.bind(s),
      loaded: () => store.dispatch({ t: 'loaded' }),
      failed: (e) => store.dispatch({ t: 'fatal', cause: 'init', message: errorMessage(e) }),
    }),
  );
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const session = useGameSession(stageEl, binding);

  const phase = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const rec = useSyncExternalStore(records.subscribe, records.get);
  const chosen = useSyncExternalStore(prefs.subscribe, prefs.get);
  const dispatch = store.dispatch;
  useScreenGuards(dispatch);
  const chooseSide = (human: Color) => prefs.update(() => ({ human }));

  // 打った手・パス・終局を読み上げる。同じ文が続いても読み上げ直すよう、要素の中身を毎回入れ替える
  const liveRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    return announceFeed.connect((text) => {
      const el = liveRef.current;
      if (el) el.textContent = text;
    });
  }, [announceFeed]);

  const setup = 'setup' in phase ? phase.setup : chosen;
  const hudVisible = phase.k === 'playing' || phase.k === 'paused' || phase.k === 'ending';
  const sheet = phase.k === 'title' || phase.k === 'paused' ? phase.sheet : null;

  return (
    <div className="screen">
      <div ref={setStageEl} className="stage" />

      <Hud feed={hudFeed} session={session} visible={hudVisible} human={setup.human} canPause={phase.k === 'playing'} onPause={() => dispatch({ t: 'pause' })} />
      <Callouts feed={calloutFeed} />
      <p ref={liveRef} className="visually-hidden" aria-live="polite" aria-atomic="true" />

      {phase.k === 'loading' && <LoadingOverlay />}

      {phase.k === 'title' && (
        <TitleView
          records={rec}
          setup={chosen}
          onChooseSide={chooseSide}
          onStart={() => dispatch({ t: 'start', setup: chosen })}
          onSettings={() => dispatch({ t: 'openSettings' })}
        />
      )}

      <GameSheets
        paused={phase.k === 'paused'}
        sheet={sheet}
        discardMessage="今の対局は記録されません"
        settings={reversiSettings()}
        settingItems={REVERSI_SETTING_ITEMS}
        dispatch={dispatch}
      />

      {phase.k === 'result' && (
        <ResultView result={phase.result} onRetry={() => dispatch({ t: 'retry' })} onTitle={() => dispatch({ t: 'toTitle' })} />
      )}

      {phase.k === 'error' && <FatalView cause={phase.cause} message={phase.message} />}

      {import.meta.env.DEV && session && phase.k !== 'error' && <DevPanel session={session} />}
    </div>
  );
}
