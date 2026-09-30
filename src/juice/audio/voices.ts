import type { AudioEngine, Bus, Voice, VoiceGroup, VoicePriority, VoiceRequest } from './engine.ts';

/**
 * 1 つのまとまり（VoiceGroup）に属する音を確保する。要求のオブジェクトを 1 つ使い回し、鳴らすたびにオブジェクトを作らない。
 * 効果音はプレイごとに作って、プレイの VoiceGroup に属させる
 */
export class VoiceOpener {
  private readonly engine: AudioEngine;
  private readonly req: VoiceRequest;
  private readonly bus: Bus;

  constructor(engine: AudioEngine, group: VoiceGroup, bus: Bus = 'sfx') {
    this.engine = engine;
    this.bus = bus;
    this.req = { bus, duration: 0, gain: 1, priority: 'normal', group };
  }

  /**
   * duration 秒の音を今から鳴らす枠を確保する。鳴らせないときは null。
   * 聞き逃せない節目の音は priority を event にして、大量に鳴る普段の音に枠を奪われないようにする。
   * 無音の中で鳴らす音は bus を lead にする
   */
  open(duration: number, gain: number, priority: VoicePriority = 'normal', bus: Bus = this.bus): Voice | null {
    const r = this.req;
    r.bus = bus;
    r.duration = duration;
    r.gain = gain;
    r.priority = priority;
    return this.engine.voice(r);
  }
}
