import { LayeredBgm } from '../../../juice/audio/bgm.ts';
import type { Arrangement, StepVoice } from '../../../juice/audio/bgm.ts';
import type { AudioEngine } from '../../../juice/audio/engine.ts';
import type { IntervalTimer } from '../../../juice/audio/sequencer.ts';
import { bgmBass, bgmHat, bgmKick } from '../../../juice/audio/bgm-kit.ts';
import type { BassTone, HatTone, KickTone } from '../../../juice/audio/bgm-kit.ts';
import { midiToFreq, tone } from '../../../juice/audio/synth.ts';

const BGM_BPM = 116;
const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = 16;

/** 4 小節で 1 周するコード進行（Em → C → G → D）。ルートとアルペジオの音 */
const PROGRESSION = [
  { root: 28, arp: [64, 67, 71, 74] },
  { root: 24, arp: [64, 67, 72, 76] },
  { root: 31, arp: [62, 67, 71, 74] },
  { root: 26, arp: [62, 66, 69, 74] },
] as const;

/** 層 */
const KICK = 0;
const BASS = 1;
const HAT = 2;
const ARP = 3;

const KICK_TONE: KickTone = { from: 150, to: 42, decay: 0.32, peak: 0.9, click: 0.15 };
const BASS_TONE: BassTone = { q: 5, open: 1400, closed: 200, sawPeak: 0.3, subPeak: 0.38 };
const HAT_TONE: HatTone = { cutoff: 8000, decay: 0.045, peak: 0.24 };

/**
 * リバーシの BGM の中身。盤が埋まっていくほど層を足していく（段階は石の数から決める）。
 * - 段階 0: キック + ベース
 * - 段階 1: ハイハット
 * - 段階 2: アルペジオ
 * - 段階 3 以上: ベースが 8 分で刻む
 */
export const REVERSI_ARRANGEMENT: Arrangement = {
  bpm: BGM_BPM,
  stepsPerBeat: STEPS_PER_BEAT,
  layerCount: 4,
  layerLevel: (layer, tier) => {
    if (layer === HAT) return tier >= 1 ? 1 : 0;
    if (layer === ARP) return tier >= 2 ? 1 : 0;
    return 1;
  },
  layerTau: () => 1.2,
  play: (step, _time, tier, voice) => {
    const inBar = step % STEPS_PER_BAR;
    const chord = PROGRESSION[Math.floor(step / STEPS_PER_BAR) % PROGRESSION.length];

    if (inBar % 4 === 0) bgmKick(voice, KICK, KICK_TONE);
    if (tier >= 3) {
      if (inBar % 2 === 0) bgmBass(voice, BASS, chord.root + (inBar % 8 === 6 ? 12 : 0), 0.13, BASS_TONE);
    } else if (inBar === 0 || inBar === 6 || inBar === 10) {
      bgmBass(voice, BASS, chord.root, 0.22, BASS_TONE);
    }
    if (inBar % 2 === 1) bgmHat(voice, HAT, inBar % 4 === 3 ? 0.9 : 0.5, HAT_TONE);
    if (inBar % 2 === 0) arp(voice, chord.arp[(inBar / 2) % chord.arp.length]);
  },
};

/** アルペジオ: 三角波の短い音。石の音と重ならないよう、フィルタで角を丸めて小さく */
function arp(voice: StepVoice, midi: number): void {
  const v = voice(0.25, 0.5, ARP);
  if (!v) return;
  const lp = v.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  lp.connect(v.out);
  tone(v, v.start, 'triangle', midiToFreq(midi), 0.003, 0.18, 0.14, lp);
}

/** BGM のいちばん上の段階 */
export const BGM_TOP_TIER = 3;

/** 石の数（盤に置かれた数）から BGM の段階を決める。盤が埋まるほど上がる */
export function bgmTier(discs: number): number {
  if (discs >= 40) return BGM_TOP_TIER;
  if (discs >= 24) return 2;
  if (discs >= 12) return 1;
  return 0;
}

/** リバーシの BGM。画面を開いている間ずっと使い回す */
export const createReversiBgm = (engine: AudioEngine, timer?: IntervalTimer): LayeredBgm => new LayeredBgm(engine, REVERSI_ARRANGEMENT, timer);
