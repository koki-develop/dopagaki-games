import { describe, expect, test } from 'bun:test';
import { STEP_HZ } from '../config.ts';
import { autoplayInput, makeSim } from '../sim/sim.test-support.ts';
import { parseStage } from '../sim/stage-parse.ts';
import { STAGES } from './stages.ts';

describe('STAGES', () => {
  test('7 面あり、どのステージも読み込める', () => {
    expect(STAGES.length).toBe(7);
    for (const s of STAGES) {
      const p = parseStage(s);
      expect(p.breakableCount).toBeGreaterThan(0);
    }
  });

  test('id は表示名を小文字にしたもので、重複しない', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['ignition', 'floodgate', 'circuit', 'prism', 'fortress', 'funnel', 'vault']);
    for (const s of STAGES) expect(s.id).toBe(s.name.toLowerCase());
  });

  test('どのステージも、自動プレイで残機を失わずに 40 秒以内にクリアできる', () => {
    for (const stage of STAGES) {
      for (let seed = 1; seed <= 3; seed++) {
        const sim = makeSim({ kind: 'stage', stage }, seed);
        for (let k = 0; k < 40 * STEP_HZ && sim.phase === 'playing'; k++) {
          sim.step(autoplayInput(sim, k));
          sim.events.clear();
        }
        expect(`${stage.id} (seed ${seed}): ${sim.phase}`).toBe(`${stage.id} (seed ${seed}): cleared`);
        expect(sim.lives).toBe(sim.config.stage.lives);
      }
    }
  });
});
