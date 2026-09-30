import { useState } from 'react';
import { BALL_CAP, TUNING_LIMITS, tuning } from '../../games/breakout/config.ts';
import type { TuningRange } from '../../games/breakout/config.ts';
import { debugHooksOf } from '../../games/breakout/session.ts';
import type { SessionHandle } from '../../games/breakout/types.ts';
import { useDebugAutoplay, useFrameStats } from '../game/useDevStats.ts';

type Props = { session: SessionHandle };

type Section = keyof typeof TUNING_LIMITS;

const SECTIONS = Object.keys(TUNING_LIMITS) as Section[];

/**
 * 開発ビルドでだけ出す調整パネル。フレーム時間とボール数を表示し、ボールをまとめて足して性能を測れる。
 * 調整値は許容範囲（TUNING_LIMITS）の中で書き換えられ、次のプレイから効く（プレイの開始時に範囲へ収めた写しを取る）。
 */
export default function DevPanel({ session }: Props) {
  const hooks = debugHooksOf(session);
  const [open, setOpen] = useState(false);
  const stats = useFrameStats(hooks);
  const [autoplay, toggleAutoplay] = useDebugAutoplay(hooks);

  if (!hooks) return null;

  return (
    <div className="dev">
      <button type="button" className="dev-toggle" onClick={() => setOpen((v) => !v)}>
        DEV {stats ? `${stats.fps.toFixed(0)}fps ${stats.balls}` : ''}
      </button>
      {open && stats && (
        <div className="dev-body">
          <p>
            {stats.backend} / Q{stats.quality} / {stats.fps.toFixed(1)}fps / worst {stats.frameMs.toFixed(1)}ms
          </p>
          <p>
            balls {stats.balls} / blocks {stats.breakable} / {stats.phase} / audio {stats.audio} / voices {stats.voices}
          </p>
          <div className="dev-row">
            <button type="button" onClick={() => hooks.debugAddBalls(100)}>
              +100
            </button>
            <button type="button" onClick={() => hooks.debugAddBalls(BALL_CAP)}>
              →MAX
            </button>
            <button type="button" onClick={toggleAutoplay}>
              auto {autoplay ? 'ON' : 'OFF'}
            </button>
          </div>
          <p>調整値は次のプレイから効く</p>
          {SECTIONS.map((section) => {
            const limits = TUNING_LIMITS[section] as Record<string, TuningRange>;
            const values = tuning[section] as Record<string, number>;
            return (
              <fieldset key={section}>
                <legend>{section}</legend>
                {Object.entries(limits).map(([key, range]) => (
                  <label key={key}>
                    <span>{key}</span>
                    <input
                      type="number"
                      min={range.min}
                      max={range.max}
                      step={range.int ? 1 : 'any'}
                      defaultValue={values[key]}
                      onChange={(e) => {
                        const n = e.currentTarget.valueAsNumber;
                        // 範囲外の値も書いてよい。プレイの開始時に sanitizeTuning が範囲へ収める
                        if (Number.isFinite(n)) values[key] = n;
                      }}
                    />
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
      )}
    </div>
  );
}
