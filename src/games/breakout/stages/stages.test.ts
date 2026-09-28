import { describe, expect, test } from 'bun:test';
import { CELL_H, DANGER_Y, FIELD_H, STEP_HZ } from '../config.ts';
import { autoplayInput, makeSim } from '../sim/sim.test-support.ts';
import { parseStage } from '../sim/stage-parse.ts';
import { STAGES } from './stages.ts';

describe('STAGES', () => {
  test('50 面あり、どのステージも読み込める', () => {
    expect(STAGES.length).toBe(50);
    for (const s of STAGES) {
      const p = parseStage(s);
      expect(p.breakableCount).toBeGreaterThan(0);
    }
  });

  test('id は表示名を小文字にしたもので、重複しない', () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      'warmup',
      'stripes',
      'checker',
      'pyramid',
      'deluge',
      'zigzag',
      'heart',
      'pillars',
      'diamonds',
      'jackpot',
      'invader',
      'ladder',
      'waves',
      'target',
      'monolith',
      'bunker',
      'skull',
      'rain',
      'castle',
      'labyrinth',
      'chevron',
      'hourglass',
      'lattice',
      'totem',
      'starfield',
      'brickwork',
      'rocket',
      'stairs',
      'crossfire',
      'shafts',
      'mushroom',
      'sandwich',
      'twins',
      'ghost',
      'reactor',
      'crown',
      'keyhole',
      'domino',
      'serpent',
      'pachinko',
      'vortex',
      'anchor',
      'cathedral',
      'planet',
      'avalanche',
      'mosaic',
      'bastion',
      'eclipse',
      'gauntlet',
      'omega',
    ]);
    for (const s of STAGES) expect(s.id).toBe(s.name.toLowerCase());
  });

  test('どのステージも、一番下の行とパドルの間に余裕を残す', () => {
    for (const s of STAGES) {
      const lowest = FIELD_H - s.rows.length * CELL_H;
      expect(`${s.id}: ${lowest > DANGER_Y + 1}`).toBe(`${s.id}: true`);
    }
  });

  test('どのステージも、自動プレイで残機を失わずに 50 秒以内にクリアできる', () => {
    for (const stage of STAGES) {
      for (let seed = 1; seed <= 3; seed++) {
        const sim = makeSim({ kind: 'stage', stage }, seed);
        for (let k = 0; k < 50 * STEP_HZ && sim.phase === 'playing'; k++) {
          sim.step(autoplayInput(sim, k));
          sim.events.clear();
        }
        expect(`${stage.id} (seed ${seed}): ${sim.phase}`).toBe(`${stage.id} (seed ${seed}): cleared`);
        expect(sim.lives).toBe(sim.config.stage.lives);
      }
    }
  });
});
