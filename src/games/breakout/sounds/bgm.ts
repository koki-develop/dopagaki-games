import { bgmBass, bgmHat, bgmKick } from '../../../juice/audio/bgm-kit.ts';
import type { BassTone, HatTone, KickTone } from '../../../juice/audio/bgm-kit.ts';
import { LayeredBgm } from '../../../juice/audio/bgm.ts';
import type { Arrangement } from '../../../juice/audio/bgm.ts';
import type { AudioEngine } from '../../../juice/audio/engine.ts';
import type { IntervalTimer } from '../../../juice/audio/sequencer.ts';

const BGM_BPM = 128;
const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = 16;

/** 4 小節で 1 周するベースのルート（Am → F → C → G）の MIDI 番号 */
const PROGRESSION = [33, 29, 36, 31] as const;

const KICK_TONE: KickTone = { from: 160, to: 44, decay: 0.34, peak: 0.95, click: 0.18 };
const BASS_TONE: BassTone = { q: 6, open: 1600, closed: 220, sawPeak: 0.32, subPeak: 0.4 };
const HAT_TONE: HatTone = { cutoff: 7500, decay: 0.05, peak: 0.28 };

/** 層。キックとベースは常に鳴らし、ハイハットは段階で出し入れする */
const KICK = 0;
const BASS = 1;
const HAT = 2;

/**
 * ブロック崩しの BGM の中身。キックとベースのループに、ボール数の段階に応じて変化を足していく。
 *
 * - 段階 0: キック + ベース
 * - 段階 1（25〜）: ハイハットが入る
 * - 段階 3（250〜）: ベースラインが倍速になる
 */
export const BREAKOUT_ARRANGEMENT: Arrangement = {
  bpm: BGM_BPM,
  stepsPerBeat: STEPS_PER_BEAT,
  layerCount: 3,
  layerLevel: (layer, tier) => {
    if (layer === HAT) return tier >= 1 ? 1 : 0;
    return 1;
  },
  // 層は数秒かけてフェードで出し入れし、段階が変わった瞬間を目立たせない
  layerTau: () => 1.2,
  play: (step, _time, tier, voice) => {
    const inBar = step % STEPS_PER_BAR;
    const root = PROGRESSION[Math.floor(step / STEPS_PER_BAR) % PROGRESSION.length];

    if (inBar % 4 === 0) bgmKick(voice, KICK, KICK_TONE);

    if (tier >= 3) {
      if (inBar % 2 === 1) bgmBass(voice, BASS, root + (inBar % 4 === 3 ? 12 : 0), 0.11, BASS_TONE);
    } else if (inBar % 4 === 2) {
      bgmBass(voice, BASS, root, 0.2, BASS_TONE);
    }

    if (inBar % 2 === 0) bgmHat(voice, HAT, inBar % 4 === 2 ? 1 : 0.55, HAT_TONE);
  },
};

/** ブロック崩しの BGM。画面を開いている間ずっと使い回す */
export const createBreakoutBgm = (engine: AudioEngine, timer?: IntervalTimer): LayeredBgm => new LayeredBgm(engine, BREAKOUT_ARRANGEMENT, timer);
