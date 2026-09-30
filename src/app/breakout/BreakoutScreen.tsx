import { useState, useSyncExternalStore } from 'react';
import { createControllerStore, hasNextStage } from '../../games/breakout/controller.ts';
import { breakoutRecords } from '../../games/breakout/records.ts';
import { createGameSession } from '../../games/breakout/session.ts';
import { breakoutSettings, BREAKOUT_SETTING_ITEMS } from '../../games/breakout/settings.ts';
import type { GamePort, HudState, SessionHandle } from '../../games/breakout/types.ts';
import { errorMessage } from '../../shared/errors.ts';
import { LatestFeed } from '../../shared/feed.ts';
import { createPortRelay } from '../../shared/port-relay.ts';
import FatalView from '../game/FatalView.tsx';
import GameSheets from '../game/GameSheets.tsx';
import { useGameSession } from '../game/useGameSession.ts';
import type { SessionBinding } from '../game/useGameSession.ts';
import { useScreenGuards } from '../game/useScreenGuards.ts';
import { LoadingOverlay } from '../ui/LoadingScreen.tsx';
import DevPanel from './DevPanel.tsx';
import Hud from './Hud.tsx';
import ReadyView from './ReadyView.tsx';
import ResultView from './ResultView.tsx';
import StageSelectView from './StageSelectView.tsx';
import TitleView from './TitleView.tsx';

/**
 * ブロック崩しの画面。どの画面を出すかは状態機械（controller.ts）が決め、ここはその表示とイベントの受け渡しだけを行う。
 * ゲーム本体（GameSession）はこの画面が表示されている間だけ生きている。
 */
export default function BreakoutScreen() {
  const records = breakoutRecords();
  const [relay] = useState(() => createPortRelay<GamePort>({ prepare: true, begin: true, setPaused: true, endRun: true }));
  const [store] = useState(() => createControllerStore(relay, records, () => performance.now()));
  const [hudFeed] = useState(() => new LatestFeed<HudState>());
  const [binding] = useState(
    (): SessionBinding<SessionHandle> => ({
      start: (el, alive) =>
        createGameSession(el, {
          onEvent: (e) => {
            if (alive()) store.dispatch(e);
          },
          onHud: (s) => {
            if (alive()) hudFeed.push(s);
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
  const dispatch = store.dispatch;
  useScreenGuards(dispatch);

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
        />
      )}

      {phase.k === 'stages' && (
        <StageSelectView
          records={rec}
          onChoose={(index) => dispatch({ t: 'choose', mode: { kind: 'stage', index } })}
          onBack={() => dispatch({ t: 'back' })}
        />
      )}

      {phase.k === 'ready' && <ReadyView mode={phase.mode} best={records.bestFor(phase.mode)} onStart={() => dispatch({ t: 'start' })} />}

      <GameSheets
        paused={phase.k === 'paused'}
        sheet={sheet}
        discardMessage="今のスコアは記録されません"
        settings={breakoutSettings()}
        settingItems={BREAKOUT_SETTING_ITEMS}
        dispatch={dispatch}
      />

      {phase.k === 'result' && (
        <ResultView
          result={phase.result}
          onRetry={() => dispatch({ t: 'retry' })}
          onNext={hasNextStage(phase.result, records.stageCount) ? () => dispatch({ t: 'next' }) : null}
          onTitle={() => dispatch({ t: 'toTitle' })}
        />
      )}

      {phase.k === 'error' && <FatalView cause={phase.cause} message={phase.message} />}

      {import.meta.env.DEV && session && phase.k !== 'error' && <DevPanel session={session} />}
    </div>
  );
}
