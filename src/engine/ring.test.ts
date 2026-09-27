import { describe, expect, test } from 'bun:test';
import { drawCount, RingCursor } from './ring.ts';
import type { DirtySink } from './ring.ts';
import { UploadScheduler } from './upload-ranges.ts';
import type { UploadRange, UploadTarget } from './upload-ranges.ts';

/** three.js の InterleavedBuffer の代わり。版と範囲を持ち、upload() で描画時の送信を真似る */
class FakeBuffer implements UploadTarget {
  readonly updateRanges: UploadRange[] = [];
  version = 0;
  uploadedVersion = 0;
  /** 最後に送った範囲（要素単位）。全体なら [0, length] の 1 つ */
  lastUpload: [number, number][] = [];
  readonly length: number;

  constructor(length: number) {
    this.length = length;
  }

  set needsUpdate(v: boolean) {
    if (v) this.version++;
  }

  get needsUpdate(): boolean {
    return false;
  }

  /** 版が上がっていれば送る。範囲がなければ全体、あれば各範囲を送って範囲を空にする（three.js の Attributes / AttributeUtils と同じ） */
  upload(): boolean {
    if (this.uploadedVersion >= this.version) return false;
    if (this.updateRanges.length === 0) {
      this.lastUpload = [[0, this.length]];
    } else {
      this.lastUpload = this.updateRanges.map((r) => [r.start, r.count]);
      this.updateRanges.length = 0;
    }
    this.uploadedVersion = this.version;
    return true;
  }
}

/** InstanceBuffer と同じ変換（インスタンス → 要素）で UploadScheduler へつなぐ */
function sinkFor(buf: FakeBuffer, stride: number): { sink: DirtySink; sched: UploadScheduler } {
  const sched = new UploadScheduler(buf, buf.length);
  const sink: DirtySink = {
    markDirty: (first, count) => sched.mark(first * stride, count * stride),
    markAllDirty: () => sched.markAll(),
  };
  return { sink, sched };
}

/** 送った範囲を記録するだけの受け手 */
class Recorder implements DirtySink {
  calls: string[] = [];
  markDirty(first: number, count: number): void {
    this.calls.push(`${first}+${count}`);
  }
  markAllDirty(): void {
    this.calls.push('all');
  }
}

describe('UploadScheduler', () => {
  test('範囲を足すと版が上がり、送るのはその範囲だけ', () => {
    const buf = new FakeBuffer(100);
    const s = new UploadScheduler(buf, 100);
    s.mark(10, 5);
    expect(buf.version).toBe(1);
    buf.upload();
    expect(buf.lastUpload).toEqual([[10, 5]]);
    expect(buf.upload()).toBe(false);
  });

  test('接する範囲・重なる範囲は 1 つにまとめる', () => {
    const buf = new FakeBuffer(100);
    const s = new UploadScheduler(buf, 100);
    s.mark(0, 8);
    s.mark(8, 8);
    s.mark(4, 4);
    buf.upload();
    expect(buf.lastUpload).toEqual([[0, 16]]);
  });

  test('全体の送り直しは、送られるまで後から足した範囲に負けない', () => {
    const buf = new FakeBuffer(100);
    const s = new UploadScheduler(buf, 100);
    s.markAll();
    s.mark(40, 4);
    s.mark(80, 4);
    expect(s.fullPending).toBe(true);
    buf.upload();
    expect(buf.lastUpload).toEqual([[0, 100]]);
    expect(s.fullPending).toBe(false);
    // 送ったあとは、また範囲だけを送る
    s.mark(40, 4);
    buf.upload();
    expect(buf.lastUpload).toEqual([[40, 4]]);
  });

  test('描画されないまま範囲が増え続けたら、全体にまとめる', () => {
    const buf = new FakeBuffer(1000);
    const s = new UploadScheduler(buf, 1000, 4);
    for (let i = 0; i < 10; i++) s.mark(i * 20, 4);
    expect(s.fullPending).toBe(true);
    expect(buf.updateRanges.length).toBe(1);
    buf.upload();
    expect(buf.lastUpload).toEqual([[0, 1000]]);
  });

  test('範囲の入れ物を使い回す（送ったあとに同じオブジェクトが再び積まれる）', () => {
    const buf = new FakeBuffer(100);
    const s = new UploadScheduler(buf, 100);
    s.mark(0, 4);
    const first = buf.updateRanges[0];
    buf.upload();
    s.mark(50, 4);
    expect(buf.updateRanges[0]).toBe(first);
    expect(buf.updateRanges[0]).toEqual({ start: 50, count: 4 });
  });
});

describe('RingCursor', () => {
  test('1 回の flush までに書いた範囲を 1 つにまとめる', () => {
    const r = new Recorder();
    const c = new RingCursor(10, r);
    for (let i = 0; i < 3; i++) c.claim();
    c.flush();
    expect(r.calls).toEqual(['0+3']);
    c.claim();
    c.flush();
    expect(r.calls).toEqual(['0+3', '3+1']);
    c.flush();
    expect(r.calls.length).toBe(2);
  });

  test('末尾で先頭へ戻ったら、末尾までと先頭からの 2 範囲に分ける', () => {
    const r = new Recorder();
    const c = new RingCursor(10, r);
    for (let i = 0; i < 7; i++) c.claim();
    c.flush();
    r.calls = [];
    for (let i = 0; i < 5; i++) c.claim();
    c.flush();
    expect(r.calls).toEqual(['7+3', '0+2']);
    expect(c.position).toBe(2);
  });

  test('ちょうど一周なら 2 範囲、一周を超えたら使った範囲全体を送る', () => {
    const r = new Recorder();
    const c = new RingCursor(10, r);
    for (let i = 0; i < 4; i++) c.claim();
    c.flush();
    r.calls = [];
    for (let i = 0; i < 10; i++) c.claim();
    c.flush();
    expect(r.calls).toEqual(['4+6', '0+4']);
    r.calls = [];
    for (let i = 0; i < 11; i++) c.claim();
    c.flush();
    expect(r.calls).toEqual(['0+10']);
  });

  test('drawCount は 2 未満にしない', () => {
    expect([0, 1, 2, 7].map(drawCount)).toEqual([2, 2, 2, 7]);
  });

  test('描画数は書いた一番後ろまで。2 未満にはせず、clear で戻る', () => {
    const r = new Recorder();
    const c = new RingCursor(100, r);
    expect(c.drawCount).toBe(2);
    c.claim();
    expect(c.drawCount).toBe(2);
    for (let i = 0; i < 29; i++) c.claim();
    expect(c.drawCount).toBe(30);
    for (let i = 0; i < 200; i++) c.claim();
    expect(c.drawCount).toBe(100);
    c.clear();
    expect(c.drawCount).toBe(2);
    expect(c.position).toBe(0);
    expect(r.calls).toEqual(['all']);
  });

  test('予算で実効容量を縮め、その位置で先頭へ戻る', () => {
    const r = new Recorder();
    const c = new RingCursor(100, r);
    c.setBudget(0.4);
    for (let i = 0; i < 45; i++) c.claim();
    expect(c.position).toBe(5);
    expect(c.drawCount).toBe(40);
    c.flush();
    expect(r.calls).toEqual(['0+40']);
  });

  test('予算を下げたとき、書き込み位置が実効容量の外なら先頭へ戻す。前に書いたものは描き続ける', () => {
    const r = new Recorder();
    const c = new RingCursor(100, r);
    for (let i = 0; i < 70; i++) c.claim();
    c.flush();
    r.calls = [];
    c.setBudget(0.5);
    expect(c.position).toBe(0);
    c.claim();
    c.claim();
    c.flush();
    expect(r.calls).toEqual(['0+2']);
    expect(c.drawCount).toBe(70);
  });

  test('同じフレームで予算を下げて書き込み位置が戻っても、書いた場所はすべて送る', () => {
    const r = new Recorder();
    const c = new RingCursor(100, r);
    for (let i = 0; i < 60; i++) c.claim();
    c.flush();
    r.calls = [];
    c.claim(); // 60
    c.setBudget(0.5); // 位置 61 → 0
    c.claim(); // 0
    c.flush();
    expect(r.calls).toEqual(['60+1', '0+1']);
  });

  test('予算は 0〜1 に収め、実効容量は最低 1', () => {
    /** 先頭へ戻るまでに受け取れる場所の数（実効容量） */
    const wrapAfter = (budget: number): number => {
      const c = new RingCursor(10, new Recorder());
      c.setBudget(budget);
      let n = 0;
      do {
        c.claim();
        n++;
      } while (c.position !== 0 && n < 100);
      return n;
    };
    expect(wrapAfter(2)).toBe(10);
    expect(wrapAfter(0)).toBe(1);
    expect(wrapAfter(Number.NaN)).toBe(10);
    expect(wrapAfter(0.5)).toBe(5);
  });
});

describe('InstanceRing の送信（RingCursor + UploadScheduler）', () => {
  const STRIDE = 16;

  test('clear した同じフレームで書いても、全体が送られる', () => {
    const buf = new FakeBuffer(50 * STRIDE);
    const { sink } = sinkFor(buf, STRIDE);
    const c = new RingCursor(50, sink);
    for (let i = 0; i < 20; i++) c.claim();
    c.flush();
    buf.upload();
    c.clear();
    c.claim();
    c.claim();
    c.flush();
    buf.upload();
    expect(buf.lastUpload).toEqual([[0, 50 * STRIDE]]);
  });

  test('clear のあと描画されないまま何フレーム書いても、全体の送信は残る', () => {
    const buf = new FakeBuffer(50 * STRIDE);
    const { sink, sched } = sinkFor(buf, STRIDE);
    const c = new RingCursor(50, sink);
    c.clear();
    for (let f = 0; f < 5; f++) {
      for (let i = 0; i < 3; i++) c.claim();
      c.flush();
    }
    expect(sched.fullPending).toBe(true);
    buf.upload();
    expect(buf.lastUpload).toEqual([[0, 50 * STRIDE]]);
  });

  test('先頭へ戻ったフレームは 2 範囲だけを送る', () => {
    const buf = new FakeBuffer(50 * STRIDE);
    const { sink } = sinkFor(buf, STRIDE);
    const c = new RingCursor(50, sink);
    for (let i = 0; i < 45; i++) c.claim();
    c.flush();
    buf.upload();
    for (let i = 0; i < 10; i++) c.claim();
    c.flush();
    buf.upload();
    expect(buf.lastUpload).toEqual([
      [45 * STRIDE, 5 * STRIDE],
      [0, 5 * STRIDE],
    ]);
  });

  test('描画されないフレームをまたいでも、書いた範囲はすべて送られる', () => {
    const buf = new FakeBuffer(50 * STRIDE);
    const { sink } = sinkFor(buf, STRIDE);
    const c = new RingCursor(50, sink);
    for (let i = 0; i < 5; i++) c.claim();
    c.flush();
    for (let i = 0; i < 5; i++) c.claim();
    c.flush();
    buf.upload();
    expect(buf.lastUpload).toEqual([[0, 10 * STRIDE]]);
  });
});
