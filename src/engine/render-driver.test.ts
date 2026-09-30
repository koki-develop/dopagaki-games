import { describe, expect, test } from 'bun:test';
import type { QualityLevel } from './quality.ts';
import { RenderDriver } from './render-driver.ts';
import type { DriverGraphics, GraphicsEvents } from './render-driver.ts';

class FakeGraphics implements DriverGraphics {
  readonly backend = 'fake';
  readonly host = null;
  loop: ((time?: number) => void) | null = null;
  renders = 0;
  disposed = false;
  size: [number, number] | null = null;
  quality: QualityLevel | null = null;
  private readonly log: string[];
  constructor(log: string[]) {
    this.log = log;
  }
  setAnimationLoop(cb: ((time?: number) => void) | null): void {
    this.loop = cb;
  }
  render(): void {
    this.renders++;
  }
  setSize(w: number, h: number): void {
    this.size = [w, h];
    this.log.push(`size ${w}x${h}`);
  }
  setQuality(q: QualityLevel): void {
    this.quality = q;
    this.log.push('graphics quality');
  }
  async warmUp(): Promise<void> {
    this.log.push('warmUp');
  }
  dispose(): void {
    this.disposed = true;
    this.loop = null;
  }
}

type SetupOptions = {
  /** n 番目（0 から）以降の作成を失敗させる */
  failFrom?: number;
  update?: () => boolean;
  detach?: () => void;
};

function setup(opts: SetupOptions = {}) {
  const log: string[] = [];
  const made: FakeGraphics[] = [];
  let events: GraphicsEvents | null = null;
  let now = 0;
  const failures: [string, unknown][] = [];
  let pending: (() => void) | null = null;
  let hold = false;
  const driver = new RenderDriver<FakeGraphics>({
    createGraphics: async (ev) => {
      if (opts.failFrom !== undefined && made.length >= opts.failFrom) throw new Error('no adapter');
      if (hold) await new Promise<void>((r) => (pending = r));
      const g = new FakeGraphics(log);
      made.push(g);
      events = ev;
      return g;
    },
    client: {
      attach: () => log.push('attach'),
      detach: () => {
        log.push('detach');
        opts.detach?.();
      },
      quality: () => log.push('client quality'),
      update: () => opts.update?.() ?? false,
      fail: (cause, e) => failures.push([cause, e]),
    },
    now: () => now,
  });
  return {
    driver,
    log,
    made,
    failures,
    holdCreation: () => {
      hold = true;
    },
    releaseCreation: () => pending?.(),
    frame: () => {
      now += 1000 / 60;
      made.at(-1)?.loop?.(now);
    },
    loseGpu: () => events?.onLost(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('RenderDriver', () => {
  test('大きさと品質を反映してから attach し、warmUp の後でループを回す', async () => {
    const h = setup();
    h.driver.setSize(390, 844);
    await h.driver.start();
    expect(h.log).toEqual(['size 390x844', 'graphics quality', 'client quality', 'attach', 'warmUp']);
    const g = h.made[0];
    expect(g?.loop).not.toBeNull();
    h.frame();
    expect(g?.renders).toBe(1);
  });

  test('GPU を失ったら detach してから作り直し、大きさを引き継ぐ', async () => {
    const h = setup();
    await h.driver.start();
    h.driver.setSize(100, 200);
    h.log.length = 0;
    h.loseGpu();
    await flush();
    expect(h.made).toHaveLength(2);
    expect(h.made[0]?.disposed).toBe(true);
    expect(h.log).toEqual(['detach', 'size 100x200', 'graphics quality', 'client quality', 'attach', 'warmUp']);
    expect(h.driver.graphics).toBe(h.made[1] ?? null);
    expect(h.failures).toEqual([]);
  });

  test('作り直せなければ lost を 1 回だけ知らせ、以後は何もしない', async () => {
    const h = setup({ failFrom: 1 });
    await h.driver.start();
    h.loseGpu();
    await flush();
    h.loseGpu();
    await flush();
    expect(h.failures.map(([c]) => c)).toEqual(['lost']);
    expect(h.driver.graphics).toBeNull();
  });

  test('最初の作成に失敗したら start が投げる', async () => {
    const h = setup({ failFrom: 0 });
    await expect(h.driver.start()).rejects.toThrow('no adapter');
  });

  test('フレームの処理で例外が投げられたら、ループを止めて internal を 1 回だけ知らせる', async () => {
    const h = setup({
      update: () => {
        throw new Error('boom');
      },
    });
    await h.driver.start();
    h.frame();
    h.frame();
    expect(h.failures).toHaveLength(1);
    expect(h.failures[0]?.[0]).toBe('internal');
    expect(h.made[0]?.loop).toBeNull();
  });

  test('作っている途中で破棄したら、できあがった描画一式をすぐに捨てる', async () => {
    const h = setup();
    h.holdCreation();
    const started = h.driver.start();
    await flush();
    h.driver.dispose();
    h.releaseCreation();
    await started;
    expect(h.made[0]?.disposed).toBe(true);
    expect(h.log).not.toContain('attach');
  });

  test('作り直すときに detach が例外を投げたら、ループを止めたまま internal を 1 回だけ知らせる', async () => {
    const h = setup({
      detach: () => {
        throw new Error('detach failed');
      },
    });
    await h.driver.start();
    h.loseGpu();
    await flush();
    expect(h.failures.map(([c]) => c)).toEqual(['internal']);
    expect(h.made).toHaveLength(1);
    expect(h.made[0]?.loop).toBeNull();
  });

  test('warmUp の途中で GPU を失ったら、作り直した描画一式でループを回す', async () => {
    const h = setup();
    let lostDuringWarmUp = false;
    const started = h.driver.start();
    // 最初の描画一式の warmUp が済む前に失う
    await Promise.resolve();
    if (h.made.length === 1) {
      h.loseGpu();
      lostDuringWarmUp = true;
    }
    await started;
    await flush();
    expect(lostDuringWarmUp).toBe(true);
    expect(h.made).toHaveLength(2);
    expect(h.made[0]?.disposed).toBe(true);
    expect(h.made[0]?.loop).toBeNull();
    expect(h.driver.graphics).toBe(h.made[1] ?? null);
    expect(h.made[1]?.loop).not.toBeNull();
    expect(h.failures).toEqual([]);
  });

  test('dispose() はループを止めて描画一式を捨て、以後 GPU を失っても作り直さない。何度呼んでもよい', async () => {
    const h = setup();
    await h.driver.start();
    const g = h.made[0];
    h.driver.dispose();
    h.driver.dispose();
    expect(g?.disposed).toBe(true);
    expect(h.driver.graphics).toBeNull();
    h.loseGpu();
    await flush();
    expect(h.made).toHaveLength(1);
    expect(h.log).not.toContain('detach');
  });
});
