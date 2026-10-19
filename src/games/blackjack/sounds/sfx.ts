import { NO_SOUND, voiceHandle } from '../../../juice/audio/engine.ts';
import type { AudioEngine, Bus, SoundHandle, Voice, VoiceGroup, VoicePriority } from '../../../juice/audio/engine.ts';
import { pentatonicSemitones } from '../../../juice/audio/shepard.ts';
import { drumRoll, glide, jitterCents, noise, send, tone } from '../../../juice/audio/synth.ts';
import type { DrumRollShape } from '../../../juice/audio/synth.ts';
import { VoiceOpener } from '../../../juice/audio/voices.ts';
import type { Outcome } from '../types.ts';

/** 溜めのドラムロールの音色 */
const ROLL: DrumRollShape = { snareBody: 190, snareWire: 3200, timpani: 62, rateFrom: 16, rateTo: 34 };
/**
 * 呼び鈴の倍音（基音の比）と、それぞれの音量（基音を 1 として）。整数比にならない倍音で金属の鐘らしくしつつ、
 * 高い倍音ほど小さくして、耳に痛くない丸い音にする
 */
const BELL_PARTIALS = [1, 2.0, 2.76, 5.4] as const;
const BELL_LEVELS = [1, 0.32, 0.18, 0.05] as const;
/** 呼び鈴の高い帯域を削るローパス（Hz）と、打った瞬間の立ち上がり（秒。短すぎると耳に刺さる） */
const BELL_LOWPASS = 2600;
const BELL_ATTACK = 0.004;
/** 勝ちの呼び鈴の基準の高さ（Hz）。段階や連勝で、ここから五音音階で上げる（上げるのは BELL_STEPS 段まで） */
const BELL_BASE = 740;
const BELL_STEPS = 9;
/** 呼び鈴の倍音のうち、これより高いものは鳴らさない（聞こえず、耳に痛いだけなので） */
const BELL_CEILING = 16000;

/** 基準から五音音階で step 段上げた呼び鈴の高さ */
const bellAt = (step: number): number => BELL_BASE * 2 ** (pentatonicSemitones(Math.min(BELL_STEPS, Math.max(0, step))) / 12);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** cents だけ上げた周波数の倍率 */
const up = (cents: number): number => 2 ** (cents / 1200);

/**
 * ブラックジャックの効果音。卓の見た目と同じく、どれも実物の音に似せて、Web Audio の標準ノードだけでその場で作る。
 * 同じ音でも毎回、高さと音色と読み出すノイズの位置をわずかに揺らす。
 *
 * - カード: シューから抜ける紙の擦れ、フェルトに当たる紙の音と鈍い響き、返す紙の弾き、集めて滑らせる音、切り混ぜる音
 * - チップ: 焼き物のチップどうしが当たる短い「カチャッ」。払い戻しは山に重なっていく数枚の音、大きな勝ちは雪崩れる音
 * - 卓: 指でフェルトを叩く、手を払う、重く叩きつける音
 * - 節目: 本物の呼び鈴（金属の倍音。高い倍音を抑えてローパスで丸め、耳に痛くしない）。勝ちの段階や連勝が上がるほど高く、数多く鳴らす
 *
 * 勝ちは明るく高く、負け（バースト、ディーラーのブラックジャック、取られるチップ、負けたラウンド）はこもって低く、
 * 続けて負けた手ほど低く重くする。負けに祝福に聞こえる音（呼び鈴、山に積まれていく音）を付けない。
 *
 * 1 回のプレイごとに作り、鳴らす音はすべて group に属する。プレイを捨てるときは group.stopAll() で残響ごと止める。
 * 聞き逃せない節目の音（ブラックジャック・バースト・勝敗・連勝・最後のラウンド・最高スコアの更新）は event の優先度で鳴らす。
 */
export class BlackjackSfx {
  private readonly voices: VoiceOpener;

  constructor(engine: AudioEngine, group: VoiceGroup) {
    this.voices = new VoiceOpener(engine, group);
  }

  /** カードがシューから抜けて飛ぶ「シュッ」。duration 秒かけて抜ける */
  deal(duration: number): void {
    const v = this.open(duration + 0.05, 0.45);
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'bandpass', 2200, 1.2, 0.004, duration, 0.4, Math.random()).frequency, 5200, t + duration);
    this.paper(v, t, 5200, 0.012, 0.3);
  }

  /** カードが卓に着いた: 紙の当たる音とフェルトの鈍い響き。chosen は、プレイヤーが選んで引いた 1 枚（少し重く） */
  land(chosen: boolean): void {
    const v = this.open(0.5, chosen ? 0.95 : 0.7);
    if (!v) return;
    const t = v.start;
    this.paper(v, t, rand(1600, 2100), 0.035, 0.75);
    this.thud(v, t, 170 * up(jitterCents(40)), 0.12, 0.5);
    if (chosen) this.thud(v, t, 80, 0.26, 0.4);
    send(v, chosen ? 0.1 : 0.05);
  }

  /** カードを表に返した「パチン」。suspense は溜めた後に返したか（鋭く大きく） */
  flip(suspense: boolean): void {
    const v = this.open(0.25, suspense ? 0.9 : 0.55);
    if (!v) return;
    const t = v.start;
    this.paper(v, t, rand(3600, 4400), suspense ? 0.05 : 0.025, 0.8);
    this.paper(v, t + 0.008, rand(1400, 1700), 0.03, 0.45);
  }

  /**
   * 溜めのドラムロール。duration 秒かけて細かく大きくなり、終わりの瞬間に途切れる（カードが返る音・決着の音で締める）。
   * ほかの音を消した無音の中で鳴らすので、lead の経路で鳴らす。途中で止めるときは、返した口の stop を呼ぶ
   */
  drumRoll(duration: number): SoundHandle {
    const v = this.open(duration + 0.25, 0.8, 'event', 'lead');
    if (!v) return NO_SOUND;
    drumRoll(v, v.start, duration, ROLL);
    return voiceHandle(v);
  }

  /** ディーラーが伏せたカードの角を持ち上げて確かめる: 紙の端をめくる小さな擦れ */
  peek(): void {
    const v = this.open(0.35, 0.45);
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'bandpass', 2600, 2, 0.02, 0.16, 0.3, Math.random()).frequency, 4200, t + 0.16);
    this.paper(v, t + 0.17, 3000, 0.02, 0.35);
  }

  /** チップを置いた・着いた「カチャッ」。index は何枚目か（少しずつ高く） */
  chip(index: number): void {
    const v = this.open(0.2, 0.6);
    if (!v) return;
    this.clack(v, v.start, (index % 6) * 30, 1);
  }

  /**
   * 勝ったラウンドの払い戻しのチップが山に着いた・手持ちへ戻った: 山に重なる「カチャカチャ」。
   * index は続けて何枚目かで、続くほど少し高く明るくし、heat（0〜1）で重なる枚数を増やす
   */
  coin(index: number, heat: number): void {
    const v = this.open(0.35, 0.5 + 0.25 * heat, 'event');
    if (!v) return;
    const t = v.start;
    const cents = Math.min(10, index) * 35;
    this.settle(v, t, 2 + Math.round(heat * 2), cents, 0.9);
    send(v, 0.06);
  }

  /** 止めた: 手のひらで卓を払う音 */
  stand(): void {
    const v = this.open(0.25, 0.45);
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'bandpass', 1100, 1.1, 0.01, 0.15, 0.4, Math.random()).frequency, 500, t + 0.15);
  }

  /** 分けた: 2 枚が左右へ滑る音と、置き直すときの紙の音 */
  split(): void {
    const v = this.open(0.4, 0.6);
    if (!v) return;
    const t = v.start;
    this.slide(v, t, 0.16, 1600, 3600, 0.4);
    this.slide(v, t + 0.06, 0.16, 1500, 3400, 0.35);
    this.paper(v, t + 0.2, 2000, 0.03, 0.4);
  }

  /** ダブルした: 指で卓を強く 1 回叩く（「もう 1 枚」の合図。賭けを積む音はチップが鳴らす） */
  double(): void {
    const v = this.open(0.35, 0.8, 'event');
    if (!v) return;
    const t = v.start;
    this.knock(v, t, 1);
    this.thud(v, t, 120, 0.16, 0.45);
  }

  /** バーストした: 重く叩きつける鈍い音と、カードを払いのける紙の音 */
  bust(): void {
    const v = this.open(0.9, 0.85, 'event');
    if (!v) return;
    const t = v.start;
    this.thud(v, t, 95, 0.5, 0.9);
    this.paper(v, t, 1200, 0.06, 0.5, 2400);
    this.slide(v, t + 0.08, 0.35, 1400, 500, 0.4);
  }

  /** 21 になった: 呼び鈴を 1 回 */
  twentyOne(): void {
    const v = this.open(1.4, 0.7, 'event');
    if (!v) return;
    this.bell(v, v.start, BELL_BASE, 1.1, 0.22);
    send(v, 0.2);
  }

  /**
   * ブラックジャック: 呼び鈴を高く 3 回打ち、チップが雪崩れて、卓を重く叩く。
   * 1 回のプレイで 1 回ほどの節目なので、いちばん厚く鳴らす
   */
  blackjack(): void {
    const v = this.open(2.6, 0.95, 'event');
    if (!v) return;
    const t = v.start;
    this.bell(v, t, BELL_BASE * up(700), 1.6, 0.26);
    this.bell(v, t + 0.12, BELL_BASE * up(1200), 1.6, 0.24);
    this.bell(v, t + 0.24, BELL_BASE * up(1900), 1.8, 0.24);
    this.thud(v, t, 70, 0.6, 0.85);
    this.cascade(v, t + 0.05, 14, 0.7, 300);
    send(v, 0.3);
  }

  /**
   * ディーラーがバーストした。rising（そのラウンドに勝った）なら、ディーラーのカードを払う音に呼び鈴を重ね、
   * そうでなければ（差し引き 0 か負けのラウンド）カードを払う音だけ
   */
  dealerBust(rising: boolean): void {
    const v = this.open(rising ? 1.3 : 0.45, rising ? 0.8 : 0.6, rising ? 'event' : 'normal');
    if (!v) return;
    const t = v.start;
    this.paper(v, t, 1500, 0.05, 0.6, 2200);
    this.slide(v, t + 0.04, 0.25, 900, 2400, 0.35);
    if (!rising) return;
    this.bell(v, t + 0.05, BELL_BASE * up(500), 1.1, 0.2);
    send(v, 0.2);
  }

  /** ディーラーのブラックジャック: 伏せたカードを返す鋭い紙の音と、低く重い響き */
  dealerBlackjack(): void {
    const v = this.open(1.4, 0.75, 'event');
    if (!v) return;
    const t = v.start;
    this.paper(v, t, 3800, 0.05, 0.7);
    this.thud(v, t + 0.02, 58, 1.0, 0.95);
    this.thud(v, t + 0.3, 46, 0.8, 0.5);
  }

  /** 勝ったラウンド: チップが崩れ落ちる音。tier（0〜4）が上がるほど枚数を増やし、段階 1 から呼び鈴、段階 3 から重い響きを重ねる */
  win(tier: number): void {
    const v = this.open(1.8, 0.6 + 0.08 * tier, 'event');
    if (!v) return;
    const t = v.start;
    this.cascade(v, t, 4 + tier * 3, 0.18 + tier * 0.08, 60 * tier);
    for (let k = 0; k < Math.min(3, tier); k++) this.bell(v, t + 0.05 + k * 0.1, bellAt(tier + k), 1.0, 0.18);
    if (tier >= 3) this.thud(v, t, 75, 0.5, 0.7);
    send(v, 0.12 + 0.04 * tier);
  }

  /** 手が負けた: チップがディーラーへ掻き取られる、こもった音。step は続けて何回目か（低く重くなっていく） */
  lose(step: number): void {
    const v = this.open(0.6, 0.6);
    if (!v) return;
    const t = v.start;
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(500, 1400 - step * 180);
    lp.connect(v.out);
    this.slide(v, t, 0.28, 1200, 450, 0.45, lp);
    this.clack(v, t + 0.02, -200 - step * 120, 0.6, lp);
    this.clack(v, t + 0.09, -320 - step * 120, 0.45, lp);
    this.thud(v, t, Math.max(50, 110 - step * 10), 0.25, 0.4);
  }

  /** 引き分け: 指で卓を軽く 2 回叩く */
  push(): void {
    const v = this.open(0.35, 0.45);
    if (!v) return;
    const t = v.start;
    this.knock(v, t, 0.6);
    this.knock(v, t + 0.11, 0.6);
  }

  /** 連勝が積まれた: 呼び鈴。count が増えるほど高く、打つ回数を増やす */
  streak(count: number): void {
    const v = this.open(1.6, 0.55 + 0.3 * Math.min(1, count / 6), 'event');
    if (!v) return;
    const t = v.start;
    const strikes = Math.max(1, Math.min(3, count - 1));
    for (let k = 0; k < strikes; k++) this.bell(v, t + k * 0.09, bellAt(count + k), 1.1, 0.2);
    send(v, 0.18);
  }

  /** 連勝が途切れた: 手で押さえて止めた呼び鈴の、こもった短い音 */
  streakBreak(): void {
    const v = this.open(0.45, 0.55);
    if (!v) return;
    const t = v.start;
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(v.out);
    this.bell(v, t, BELL_BASE * up(-1200), 0.14, 0.22, lp);
    this.knock(v, t + 0.01, 0.6);
  }

  /** 最後のラウンドの賭けを選び始めた: 呼び鈴の 2 打 */
  finalRound(): void {
    const v = this.open(2, 0.7, 'event');
    if (!v) return;
    const t = v.start;
    this.bell(v, t, 660, 1.1, 0.16);
    this.bell(v, t + 0.22, 880, 1.3, 0.16);
    send(v, 0.3);
  }

  /** 捨てたカードを混ぜ直した: カードを弾いて切り混ぜる「パラパラ」と、まとめる「ザッ」 */
  reshuffle(): void {
    const v = this.open(0.9, 0.55);
    if (!v) return;
    const t = v.start;
    let at = t;
    for (let k = 0; k < 26; k++) {
      this.paper(v, at, rand(2600, 4200), 0.012, 0.28);
      at += 0.024 - k * 0.0004;
    }
    this.slide(v, at + 0.03, 0.18, 2800, 900, 0.4);
  }

  /** 選べない操作を選んだ: 指で縁を叩く、鈍い 2 回 */
  nope(): void {
    const v = this.open(0.2, 0.5);
    if (!v) return;
    const t = v.start;
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    lp.connect(v.out);
    this.knock(v, t, 0.8, lp);
    this.knock(v, t + 0.07, 0.6, lp);
  }

  /** カードを集める「ザッ」 */
  sweep(): void {
    const v = this.open(0.4, 0.4);
    if (!v) return;
    this.slide(v, v.start, 0.25, 3000, 900, 0.4);
  }

  /** プレイの始まりに卓が整う音: フェルトを払う音と、チップラックのチップが触れ合う音 */
  tableIn(): void {
    const v = this.open(0.9, 0.6);
    if (!v) return;
    const t = v.start;
    glide(noise(v, t, 'bandpass', 500, 0.8, 0.03, 0.4, 0.3, Math.random()).frequency, 1800, t + 0.4);
    this.settle(v, t + 0.25, 3, -100, 0.5);
    send(v, 0.15);
  }

  /** 自己ベストを超えた: 呼び鈴を駆け上がるように 5 回打ち、チップが雪崩れる */
  newBest(): void {
    const v = this.open(2.6, 0.85, 'event');
    if (!v) return;
    const t = v.start;
    for (let k = 0; k < 5; k++) this.bell(v, t + k * 0.08, bellAt(2 + k), 1.4, 0.2);
    this.cascade(v, t + 0.35, 12, 0.6, 200);
    send(v, 0.35);
  }

  /**
   * 終わりの決着。増やしたら呼び鈴の連打とチップの雪崩と重い響き、同じなら呼び鈴を低く 1 回、
   * 減らしたら（破産を含む）チップが掻き取られる音と低く重い響き
   */
  verdict(outcome: Outcome): void {
    if (outcome === 'profit') {
      const v = this.open(3, 0.9, 'event');
      if (!v) return;
      const t = v.start;
      for (let k = 0; k < 4; k++) this.bell(v, t + k * 0.11, bellAt(4 + k), 1.8, 0.22);
      this.thud(v, t, 62, 0.9, 0.9);
      this.cascade(v, t + 0.05, 30, 1.3, 250);
      send(v, 0.4);
      return;
    }
    if (outcome === 'even') {
      const v = this.open(1.6, 0.6, 'event');
      if (!v) return;
      this.bell(v, v.start, BELL_BASE * up(-1200), 1.2, 0.2);
      send(v, 0.25);
      return;
    }
    const v = this.open(1.4, 0.75, 'event');
    if (!v) return;
    const t = v.start;
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(v.out);
    this.slide(v, t, 0.6, 1000, 300, 0.5, lp);
    this.thud(v, t, 55, 1.0, 0.95);
  }

  // ---- 実物の音の部品 ----

  /** 焼き物のチップどうしが当たる音: 高い帯域の短いノイズを 2 回（2 枚が続けて当たる）と、硬い胴の短い鳴り。cents だけ高くする */
  private clack(v: Voice, t: number, cents: number, gain: number, dest: AudioNode = v.out): void {
    const k = up(jitterCents(70) + cents);
    noise(v, t, 'bandpass', 3400 * k, 3.5, 0.0004, 0.014, 0.75 * gain, Math.random(), dest);
    noise(v, t + rand(0.004, 0.009), 'bandpass', 5200 * k, 3, 0.0004, 0.01, 0.45 * gain, Math.random(), dest);
    tone(v, t, 'sine', 2050 * k, 0.0004, 0.022, 0.12 * gain, dest);
    tone(v, t, 'sine', 640 * k, 0.0008, 0.018, 0.1 * gain, dest);
  }

  /** チップが山に重なって落ち着く: count 回の「カチャ」を、間を詰めながら弱めていく */
  private settle(v: Voice, t: number, count: number, cents: number, gain: number): void {
    let at = t;
    for (let k = 0; k < count; k++) {
      this.clack(v, at, cents + k * 20, gain * (1 - k * 0.18));
      at += 0.035 - k * 0.006;
    }
  }

  /** チップが雪崩れる: count 枚を duration 秒にばらけさせ（後ほど間を空け）、高さを少しずつ散らす */
  private cascade(v: Voice, t: number, count: number, duration: number, cents: number): void {
    for (let k = 0; k < count; k++) {
      const at = t + (duration * k * k) / Math.max(1, count * count) + rand(0, 0.02);
      this.clack(v, at, cents + rand(-150, 250), rand(0.45, 0.9));
    }
  }

  /** 紙の音（弾く・当たる・めくる）: 帯域を絞った短いノイズ。lowpass を渡すと、その周波数でこもらせる */
  private paper(v: Voice, t: number, freq: number, decay: number, gain: number, lowpass = 0): void {
    if (lowpass > 0) {
      const lp = v.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lowpass;
      lp.connect(v.out);
      noise(v, t, 'bandpass', freq, 1.4, 0.0005, decay, gain, Math.random(), lp);
      return;
    }
    noise(v, t, 'bandpass', freq, 1.4, 0.0005, decay, gain, Math.random());
  }

  /** カードやチップがフェルトの上を滑る音: 帯域が from から to へ動くノイズ */
  private slide(v: Voice, t: number, duration: number, from: number, to: number, gain: number, dest: AudioNode = v.out): void {
    glide(noise(v, t, 'bandpass', from, 1, 0.01, duration, gain, Math.random(), dest).frequency, to, t + duration);
  }

  /** フェルトに当たる鈍い響き: freq から下がるサイン波と、こもったノイズ */
  private thud(v: Voice, t: number, freq: number, decay: number, gain: number): void {
    glide(tone(v, t, 'sine', freq, 0.002, decay, gain).frequency, freq * 0.5, t + decay * 0.8);
    noise(v, t, 'lowpass', 400, 0.7, 0.001, Math.min(0.12, decay), gain * 0.35, Math.random());
  }

  /** 指で卓や縁を叩く音: こもった短いノイズと、低い胴鳴り */
  private knock(v: Voice, t: number, gain: number, dest: AudioNode = v.out): void {
    noise(v, t, 'bandpass', 700 * up(jitterCents(60)), 1.2, 0.0008, 0.03, 0.6 * gain, Math.random(), dest);
    tone(v, t, 'sine', 170 * up(jitterCents(40)), 0.001, 0.06, 0.35 * gain, dest);
  }

  /**
   * 呼び鈴の 1 打: 倍音を、高いほど小さく早く消えるように重ね、ローパスで丸める。f は基音、decay は基音の長さ。
   * BELL_CEILING を超える倍音は鳴らさない
   */
  private bell(v: Voice, t: number, f: number, decay: number, peak: number, dest: AudioNode = v.out): void {
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = BELL_LOWPASS;
    lp.Q.value = 0.5;
    lp.connect(dest);
    BELL_PARTIALS.forEach((ratio, i) => {
      if (f * ratio <= BELL_CEILING) tone(v, t, 'sine', f * ratio, BELL_ATTACK, decay / (1 + i * 1.2), peak * BELL_LEVELS[i], lp);
    });
  }

  private open(duration: number, gain: number, priority: VoicePriority = 'normal', bus: Bus = 'sfx'): Voice | null {
    return this.voices.open(duration, gain, priority, bus);
  }
}
