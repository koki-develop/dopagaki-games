import { bgmBass, bgmHat, bgmKick } from '../../../juice/audio/bgm-kit.ts';
import type { BassTone, HatTone, KickTone } from '../../../juice/audio/bgm-kit.ts';
import { LayeredBgm } from '../../../juice/audio/bgm.ts';
import type { Arrangement, StepVoice } from '../../../juice/audio/bgm.ts';
import type { AudioEngine } from '../../../juice/audio/engine.ts';
import type { IntervalTimer } from '../../../juice/audio/sequencer.ts';
import { envGain, midiToFreq, oscillator, stopTime } from '../../../juice/audio/synth.ts';

const BGM_BPM = 128;
const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = 16;

/** 4 小節で 1 周するコード進行（Am → F → C → G）。ルートの MIDI 番号と、パッドの構成音 */
const PROGRESSION = [
  { root: 33, pad: [57, 60, 64, 67, 71] },
  { root: 29, pad: [53, 57, 60, 64, 67] },
  { root: 36, pad: [55, 60, 64, 67, 74] },
  { root: 31, pad: [55, 59, 62, 67, 69] },
] as const;

const KICK_TONE: KickTone = { from: 160, to: 44, decay: 0.34, peak: 0.95, click: 0.18 };
const BASS_TONE: BassTone = { q: 6, open: 1600, closed: 220, sawPeak: 0.32, subPeak: 0.4 };
const HAT_TONE: HatTone = { cutoff: 7500, decay: 0.05, peak: 0.28 };

/** パッドの 1 音を 2 本のノコギリ波に分けるデチューン（セント） */
const PAD_DETUNE = 11;

/** 層。キックとベースは常に鳴らし、ハイハットとパッドは段階で出し入れする */
const KICK = 0;
const BASS = 1;
const HAT = 2;
const PAD = 3;

/**
 * ブロック崩しの BGM の中身。キックとベースのループに、ボール数の段階に応じて層を足していく。
 *
 * - 段階 0: キック + ベース
 * - 段階 1（25〜）: ハイハットが入る
 * - 段階 3（250〜）: ベースラインが倍速になる
 * - 段階 4（500、MAX）: シンセのパッドが重なる
 */
export const BREAKOUT_ARRANGEMENT: Arrangement = {
  bpm: BGM_BPM,
  stepsPerBeat: STEPS_PER_BEAT,
  layerCount: 4,
  layerLevel: (layer, tier) => {
    if (layer === HAT) return tier >= 1 ? 1 : 0;
    if (layer === PAD) return tier >= 4 ? 1 : 0;
    return 1;
  },
  // 層は数秒かけてフェードで出し入れし、段階が変わった瞬間を目立たせない
  layerTau: (layer) => (layer === PAD ? 1.5 : 1.2),
  play: (step, _time, tier, voice) => {
    const inBar = step % STEPS_PER_BAR;
    const chord = PROGRESSION[Math.floor(step / STEPS_PER_BAR) % PROGRESSION.length];

    if (inBar % 4 === 0) bgmKick(voice, KICK, KICK_TONE);

    if (tier >= 3) {
      if (inBar % 2 === 1) bgmBass(voice, BASS, chord.root + (inBar % 4 === 3 ? 12 : 0), 0.11, BASS_TONE);
    } else if (inBar % 4 === 2) {
      bgmBass(voice, BASS, chord.root, 0.2, BASS_TONE);
    }

    if (inBar % 2 === 0) bgmHat(voice, HAT, inBar % 4 === 2 ? 1 : 0.55, HAT_TONE);

    if (inBar === 0 && tier >= 4) pad(voice, chord.pad, (60 / BGM_BPM) * 4);
  },
};

/** どのノコギリ波も同じエンベロープなので、1 つにまとめてからローパスへつなぐ */
function pad(voice: StepVoice, midis: readonly number[], len: number): void {
  const v = voice(len + 0.2, 1, PAD);
  if (!v) return;
  const ctx = v.ctx;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  lp.Q.value = 0.5;
  lp.connect(v.out);
  const env = envGain(ctx, v.start, 0.25, len, 0.3 / Math.sqrt(midis.length * 2), lp);
  const end = stopTime(v.start, 0.25, len);
  for (let i = 0; i < midis.length; i++) {
    const f = midiToFreq(midis[i]);
    oscillator(v, v.start, 'sawtooth', f, end, env).detune.value = -PAD_DETUNE;
    oscillator(v, v.start, 'sawtooth', f, end, env).detune.value = PAD_DETUNE;
  }
}

/** ブロック崩しの BGM。画面を開いている間ずっと使い回す */
export const createBreakoutBgm = (engine: AudioEngine, timer?: IntervalTimer): LayeredBgm => new LayeredBgm(engine, BREAKOUT_ARRANGEMENT, timer);
