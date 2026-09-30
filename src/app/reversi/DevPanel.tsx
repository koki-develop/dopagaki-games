import { useState } from 'react';
import { debugHooksOf } from '../../games/reversi/session.ts';
import type { SessionHandle } from '../../games/reversi/types.ts';
import { useDebugAutoplay, useFrameStats } from '../game/useDevStats.ts';

type Props = { session: SessionHandle };

/** 開発ビルドでだけ出すパネル。フレーム時間と対局の状態を表示し、人の手番を CPU に打たせられる */
export default function DevPanel({ session }: Props) {
  const hooks = debugHooksOf(session);
  const [open, setOpen] = useState(false);
  const stats = useFrameStats(hooks);
  const [autoplay, toggleAutoplay] = useDebugAutoplay(hooks);

  if (!hooks) return null;

  return (
    <div className="dev">
      <button type="button" className="dev-toggle" onClick={() => setOpen((v) => !v)}>
        DEV {stats ? `${stats.fps.toFixed(0)}fps` : ''}
      </button>
      {open && stats && (
        <div className="dev-body">
          <p>
            {stats.backend} / Q{stats.quality} / {stats.fps.toFixed(1)}fps / worst {stats.frameMs.toFixed(1)}ms
          </p>
          <p>
            empties {stats.empties} / turn {stats.turn ?? '-'} / audio {stats.audio} / voices {stats.voices}
          </p>
          <div className="dev-row">
            <button type="button" onClick={toggleAutoplay}>
              auto {autoplay ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
