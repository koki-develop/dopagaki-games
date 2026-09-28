import { describe, expect, test } from 'bun:test';
import { parseStage } from '../sim/stage-parse.ts';
import { STAGES } from './stages.ts';

describe('STAGES', () => {
  test('5 面あり、どのステージも読み込める', () => {
    expect(STAGES.length).toBe(5);
    for (const s of STAGES) {
      const p = parseStage(s);
      expect(p.breakableCount).toBeGreaterThan(0);
    }
  });

  test('id は表示名を小文字にしたもので、重複しない', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['ignition', 'floodgate', 'circuit', 'prism', 'fortress']);
    for (const s of STAGES) expect(s.id).toBe(s.name.toLowerCase());
  });
});
