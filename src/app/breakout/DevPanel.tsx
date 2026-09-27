import { useEffect, useState } from 'react';
import { BALL_CAP, TUNING_LIMITS, tuning } from '../../games/breakout/config.ts';
import type { TuningRange } from '../../games/breakout/config.ts';
import { debugHooksOf } from '../../games/breakout/session.ts';
import type { BreakoutDebugHooks } from '../../games/breakout/session.ts';
import type { SessionHandle } from '../../games/breakout/types.ts';

type Props = { session: SessionHandle };

type Stats = BreakoutDebugHooks['debugInfo'] & { fps: number; frameMs: number };

type Section = keyof typeof TUNING_LIMITS;

const SECTIONS = Object.keys(TUNING_LIMITS) as Section[];

/**
 * 開発ビルドでだけ出す調整パネル。フレーム時間とボール数を表示し、ボールをまとめて足して性能を測れる。
 * 調整値は許容範囲（TUNING_LIMITS）の中で書き換えられ、次のプレイから効く（プレイの開始時に範囲へ収めた写しを取る）。
 */
export default function DevPanel({ session }: Props) {
  const hooks = debugHooksOf(session);
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [autoplay, setAutoplay] = useState(() => hooks?.debugAutoplay ?? false);

  useEffect(() => {
    if (!hooks) return;
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    let worst = 0;
    let prev = last;
    const tick = (now: number) => {
      frames++;
      worst = Math.max(worst, now - prev);
      prev = now;
      if (now - last >= 500) {
        setStats({ fps: (frames * 1000) / (now - last), frameMs: worst, ...hooks.debugInfo });
        frames = 0;
        worst = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hooks]);

  if (!hooks) return null;

  const toggleAutoplay = () => {
    const on = !hooks.debugAutoplay;
    hooks.setDebugAutoplay(on);
    setAutoplay(on);
  };

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
            balls {stats.balls} / blocks {stats.live} / {stats.phase} / audio {stats.audio} / voices {stats.voices}
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
