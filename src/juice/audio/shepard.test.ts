import { describe, expect, test } from 'bun:test';
import { MockAudioContext } from './mock-audio.test-support.ts';
import type { MockPeriodicWave } from './mock-audio.test-support.ts';
import {
  octavePosition,
  PENTATONIC,
  SHEPARD_HARMONICS,
  shepardAnchor,
  shepardWaveCoefficients,
  shepardWaves,
  shepardWeight,
} from './shepard.ts';
import type { ShepardWaveform } from './shepard.ts';

const COMPONENTS = 4;
/** 目印に使う半音。ペンタトニックの 5 音と、揺らぎで下へ回り込んだときの 12 */
const ANCHORS = [...PENTATONIC, 12];

function coefficients(anchor: number, type: ShepardWaveform): Float32Array {
  const imag = new Float32Array(SHEPARD_HARMONICS + 1);
  shepardWaveCoefficients(anchor, COMPONENTS, type, imag);
  return imag;
}

/** 標準の triangle 波形（奇関数で、時刻 0 で上向き、振幅 1） */
function idealTriangle(phase: number): number {
  const p = phase - Math.floor(phase);
  if (p < 0.25) return 4 * p;
  if (p < 0.75) return 2 - 4 * p;
  return 4 * p - 4;
}

/** 係数から 1 周期の波形の値を計算する（PeriodicWave の定義式） */
function synth(imag: Float32Array, phase: number): number {
  let x = 0;
  for (let n = 1; n < imag.length; n++) if (imag[n] !== 0) x += imag[n] * Math.sin(2 * Math.PI * n * phase);
  return x;
}

describe('Shepard tone の PeriodicWave', () => {
  test('sine: 2^k 倍音に成分 k の重みがそのまま入り、ほかは 0', () => {
    for (const anchor of ANCHORS) {
      const imag = coefficients(anchor, 'sine');
      for (let n = 0; n < imag.length; n++) {
        const k = Math.log2(n);
        const expected = Number.isInteger(k) && k < COMPONENTS ? shepardWeight(k, anchor / 12, COMPONENTS) : 0;
        expect(imag[n]).toBeCloseTo(expected, 6);
      }
    }
  });

  test('triangle: 成分ごとの triangle 波形の係数を足したものと一致する', () => {
    for (const anchor of ANCHORS) {
      const imag = coefficients(anchor, 'triangle');
      const expected = new Float64Array(imag.length);
      for (let k = 0; k < COMPONENTS; k++) {
        const w = shepardWeight(k, anchor / 12, COMPONENTS);
        // Web Audio 仕様の triangle の係数 b[m] = 8 sin(mπ/2) / (πm)²
        for (let m = 1; m * 2 ** k < imag.length; m++) expected[m * 2 ** k] += (w * 8 * Math.sin((m * Math.PI) / 2)) / (Math.PI * m) ** 2;
      }
      for (let n = 0; n < imag.length; n++) expect(imag[n]).toBeCloseTo(expected[n], 6);
    }
  });

  test('波形は、成分ごとの音を同時に start した和と同じ（位相も一致）', () => {
    for (const anchor of ANCHORS) {
      const h = anchor / 12;
      const sine = coefficients(anchor, 'sine');
      const tri = coefficients(anchor, 'triangle');
      let maxSine = 0;
      let maxTri = 0;
      for (let i = 0; i < 997; i++) {
        const phase = i / 997;
        let refSine = 0;
        let refTri = 0;
        for (let k = 0; k < COMPONENTS; k++) {
          const w = shepardWeight(k, h, COMPONENTS);
          refSine += w * Math.sin(2 * Math.PI * 2 ** k * phase);
          refTri += w * idealTriangle(2 ** k * phase);
        }
        maxSine = Math.max(maxSine, Math.abs(synth(sine, phase) - refSine));
        maxTri = Math.max(maxTri, Math.abs(synth(tri, phase) - refTri));
      }
      expect(maxSine).toBeLessThan(1e-6);
      // 差は係数を SHEPARD_HARMONICS 倍音で打ち切った分だけ（どれもナイキスト周波数より上）
      expect(maxTri).toBeLessThan(5e-3);
    }
  });

  test('目印の周波数と detune から、定義どおりの成分の周波数になる', () => {
    const base = 130.81;
    for (const degree of PENTATONIC) {
      for (let octave = -1; octave <= 3; octave++) {
        for (let cents = -8; cents <= 8; cents += 0.25) {
          const semis = octave * 12 + degree + cents / 100;
          const anchor = shepardAnchor(semis);
          const detune = (octavePosition(semis) - anchor) * 100;
          expect(Math.abs(detune)).toBeLessThanOrEqual(8 + 1e-9);
          const fundamental = base * 2 ** (anchor / 12) * 2 ** (detune / 1200);
          const h = octavePosition(semis) / 12;
          for (let k = 0; k < COMPONENTS; k++) {
            expect(fundamental * 2 ** k).toBeCloseTo(base * 2 ** (k + h), 9);
          }
        }
      }
    }
    // 0 から下へ揺れると、1 オクターブ上の目印 12 を使う（成分が 1 つずつ上へずれた組になる）
    expect(shepardAnchor(-0.05)).toBe(12);
  });

  test('揺らぎ（±8 セント）の分だけ重みを目印の値で代用しても、各成分の音量の差は 0.2dB 未満', () => {
    let worst = 0;
    for (const degree of PENTATONIC) {
      for (let cents = -8; cents <= 8; cents += 0.25) {
        const semis = degree + cents / 100;
        const anchor = shepardAnchor(semis);
        const h = octavePosition(semis) / 12;
        for (let k = 0; k < COMPONENTS; k++) {
          // 目印 12 の波形は、基本周波数が 1 オクターブ上なので、成分 k は元の成分 k（h ≒ 1）にあたる
          const exact = shepardWeight(k, h, COMPONENTS);
          const approx = shepardWeight(k, anchor / 12, COMPONENTS);
          worst = Math.max(worst, Math.abs(20 * Math.log10(approx / exact)));
        }
      }
    }
    expect(worst).toBeLessThan(0.2);
  });

  test('波形は AudioContext ごと・目印と種類ごとに 1 度だけ作り、正規化を切る', () => {
    const ctx = new MockAudioContext();
    const bank = shepardWaves(ctx.asContext(), COMPONENTS);
    expect(shepardWaves(ctx.asContext(), COMPONENTS)).toBe(bank);
    const a = bank.wave(4, 'sine');
    expect(bank.wave(4, 'sine')).toBe(a);
    expect(bank.wave(4, 'triangle')).not.toBe(a);
    bank.wave(12, 'triangle');
    bank.wave(12, 'triangle');
    expect(ctx.periodicWaves.length).toBe(3);
    const w = a as unknown as MockPeriodicWave;
    expect(w.disableNormalization).toBe(true);
    expect(w.real.every((x) => x === 0)).toBe(true);
    expect(w.imag.length).toBe(SHEPARD_HARMONICS + 1);

    const other = new MockAudioContext();
    expect(shepardWaves(other.asContext(), COMPONENTS)).not.toBe(bank);
  });
});
