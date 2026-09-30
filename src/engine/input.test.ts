import { describe, expect, test } from 'bun:test';
import { FakeElement, key } from './dom-events.test-support.ts';
import { RelativeDrag } from './input.ts';

class FakeSurface extends EventTarget {
  captured: number[] = [];
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
}

function pointer(type: string, pointerId: number, clientX: number, pointerType = 'touch', extra: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), { pointerId, clientX, pointerType, button: 0, relatedTarget: null, ...extra });
}

function setup() {
  const el = new FakeSurface();
  const win = new EventTarget();
  let nowMs = 0;
  const moves: number[] = [];
  const releases: number[] = [];
  const drag = new RelativeDrag(
    el,
    {
      onMove: (dx) => moves.push(dx),
      onRelease: (info) => releases.push(info.pressedAt),
    },
    { keyTarget: win, now: () => nowMs },
  );
  const setNow = (ms: number) => {
    nowMs = ms;
  };
  return { el, win, drag, moves, releases, setNow };
}

describe('RelativeDrag のポインター', () => {
  test('受け付けていない間は何もしない', () => {
    const { el, moves, releases } = setup();
    el.dispatchEvent(pointer('pointerdown', 1, 100));
    el.dispatchEvent(pointer('pointermove', 1, 120));
    el.dispatchEvent(pointer('pointerup', 1, 120));
    expect(moves).toEqual([]);
    expect(releases).toEqual([]);
  });

  test('指の移動量を伝え、離したら押した時刻（秒）つきで知らせる', () => {
    const { el, drag, moves, releases, setNow } = setup();
    drag.setActive(true);
    setNow(2500);
    const down = pointer('pointerdown', 1, 100);
    el.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(el.captured).toEqual([1]);
    el.dispatchEvent(pointer('pointermove', 1, 110));
    el.dispatchEvent(pointer('pointermove', 1, 105));
    setNow(3000);
    el.dispatchEvent(pointer('pointerup', 1, 105));
    expect(moves).toEqual([10, -5]);
    expect(releases).toEqual([2.5]);
  });

  test('pointercancel は離したものとして扱わない', () => {
    const { el, drag, releases } = setup();
    drag.setActive(true);
    el.dispatchEvent(pointer('pointerdown', 1, 100));
    el.dispatchEvent(pointer('pointercancel', 1, 100));
    el.dispatchEvent(pointer('pointerup', 1, 100));
    expect(releases).toEqual([]);
  });

  test('最初の指だけを使い、離れたら残っている指へ引き継ぐ', () => {
    const { el, drag, moves, releases } = setup();
    drag.setActive(true);
    el.dispatchEvent(pointer('pointerdown', 1, 100));
    el.dispatchEvent(pointer('pointerdown', 2, 300));
    el.dispatchEvent(pointer('pointermove', 2, 320));
    expect(moves).toEqual([]);
    el.dispatchEvent(pointer('pointerup', 1, 100));
    expect(releases.length).toBe(1);
    el.dispatchEvent(pointer('pointermove', 2, 330));
    expect(moves).toEqual([10]);
  });

  test('受け付けを切り替えると、押している指を忘れる（離しても発射しない）', () => {
    const { el, drag, releases } = setup();
    drag.setActive(true);
    el.dispatchEvent(pointer('pointerdown', 1, 100));
    drag.setActive(false);
    drag.setActive(true);
    el.dispatchEvent(pointer('pointerup', 1, 100));
    expect(releases).toEqual([]);
  });

  test('受け付ける前に押した指は、受け付けてから離しても発射しない', () => {
    const { el, drag, releases } = setup();
    el.dispatchEvent(pointer('pointerdown', 1, 100));
    drag.setActive(true);
    el.dispatchEvent(pointer('pointerup', 1, 100));
    expect(releases).toEqual([]);
  });

  test('マウスは押していなくても移動量を伝え、外へ出たら位置を忘れる', () => {
    const { el, drag, moves } = setup();
    drag.setActive(true);
    el.dispatchEvent(pointer('pointermove', 9, 100, 'mouse'));
    el.dispatchEvent(pointer('pointermove', 9, 110, 'mouse'));
    el.dispatchEvent(pointer('pointerleave', 9, 110, 'mouse'));
    el.dispatchEvent(pointer('pointermove', 9, 400, 'mouse'));
    el.dispatchEvent(pointer('pointermove', 9, 405, 'mouse'));
    expect(moves).toEqual([10, 5]);
  });

  test('pointerout は、ページの外へ出たときだけ位置を忘れる', () => {
    const { el, drag, moves } = setup();
    drag.setActive(true);
    el.dispatchEvent(pointer('pointermove', 9, 100, 'mouse'));
    el.dispatchEvent(pointer('pointerout', 9, 100, 'mouse', { relatedTarget: new EventTarget() }));
    el.dispatchEvent(pointer('pointermove', 9, 110, 'mouse'));
    el.dispatchEvent(pointer('pointerout', 9, 110, 'mouse'));
    el.dispatchEvent(pointer('pointermove', 9, 500, 'mouse'));
    expect(moves).toEqual([10]);
  });

  test('受け付けを切り替えると、マウスの位置を忘れる', () => {
    const { el, drag, moves } = setup();
    drag.setActive(true);
    el.dispatchEvent(pointer('pointermove', 9, 100, 'mouse'));
    drag.setActive(false);
    el.dispatchEvent(pointer('pointermove', 9, 300, 'mouse'));
    drag.setActive(true);
    el.dispatchEvent(pointer('pointermove', 9, 310, 'mouse'));
    el.dispatchEvent(pointer('pointermove', 9, 312, 'mouse'));
    expect(moves).toEqual([2]);
  });

  test('マウスの主ボタン以外で押しても、押したことにしない', () => {
    const { el, drag, moves, releases } = setup();
    drag.setActive(true);
    el.dispatchEvent(pointer('pointermove', 9, 100, 'mouse', { button: -1 }));
    el.dispatchEvent(pointer('pointerdown', 9, 100, 'mouse', { button: 2 }));
    el.dispatchEvent(pointer('pointermove', 9, 110, 'mouse', { button: -1 }));
    el.dispatchEvent(pointer('pointerup', 9, 110, 'mouse', { button: 2 }));
    expect(el.captured).toEqual([]);
    expect(releases).toEqual([]);
    // 押していないマウスの移動としては伝える
    expect(moves).toEqual([10]);
  });

  test('受け付けていない間は、既定の動作を止めない', () => {
    const { el } = setup();
    const down = pointer('pointerdown', 1, 100);
    el.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  });
});

describe('RelativeDrag のキーボード', () => {
  test('← を押したまま → を押して離すと、← の向きに戻る', () => {
    const { win, drag } = setup();
    drag.setActive(true);
    win.dispatchEvent(key('keydown', 'ArrowLeft'));
    expect(drag.keyDirection).toBe(-1);
    win.dispatchEvent(key('keydown', 'ArrowRight'));
    expect(drag.keyDirection).toBe(1);
    win.dispatchEvent(key('keyup', 'ArrowRight'));
    expect(drag.keyDirection).toBe(-1);
    win.dispatchEvent(key('keyup', 'ArrowLeft'));
    expect(drag.keyDirection).toBe(0);
  });

  test('A / D は大文字でも効く', () => {
    const { win, drag } = setup();
    drag.setActive(true);
    win.dispatchEvent(key('keydown', 'D'));
    expect(drag.keyDirection).toBe(1);
    win.dispatchEvent(key('keyup', 'd'));
    expect(drag.keyDirection).toBe(0);
    win.dispatchEvent(key('keydown', 'A'));
    expect(drag.keyDirection).toBe(-1);
  });

  test('発射はキーを離したときで、押した時刻を渡す', () => {
    const { win, drag, releases, setNow } = setup();
    drag.setActive(true);
    setNow(1000);
    const down = key('keydown', ' ');
    win.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    win.dispatchEvent(key('keydown', ' ', { repeat: true }));
    expect(releases).toEqual([]);
    setNow(1200);
    const up = key('keyup', ' ');
    win.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(releases).toEqual([1]);
  });

  test('受け付ける前に押したキーは、受け付けてから離しても発射しない', () => {
    const { win, drag, releases } = setup();
    const down = key('keydown', 'Enter');
    win.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    drag.setActive(true);
    const up = key('keyup', 'Enter');
    win.dispatchEvent(up);
    expect(releases).toEqual([]);
    expect(up.defaultPrevented).toBe(false);
  });

  test('受け付けていない間は、キーの既定の動作を止めない', () => {
    const { win } = setup();
    for (const k of [' ', 'Enter', 'ArrowLeft']) {
      const e = key('keydown', k);
      win.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    }
  });

  test('受け付けを切り替えると、押しているキーを忘れる', () => {
    const { win, drag, releases } = setup();
    drag.setActive(true);
    win.dispatchEvent(key('keydown', 'ArrowLeft'));
    win.dispatchEvent(key('keydown', 'Enter'));
    drag.setActive(false);
    drag.setActive(true);
    expect(drag.keyDirection).toBe(0);
    win.dispatchEvent(key('keyup', 'Enter'));
    expect(releases).toEqual([]);
  });

  test('ブラウザのショートカットは奪わない', () => {
    const { win, drag } = setup();
    drag.setActive(true);
    const e = key('keydown', 'd', { ctrlKey: true });
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(drag.keyDirection).toBe(0);
  });

  test.each([
    ['button', new FakeElement('button')],
    ['a[href]', new FakeElement('a', { href: '#' })],
    ['input', new FakeElement('input')],
    ['select', new FakeElement('select')],
    ['textarea', new FakeElement('textarea')],
    ['contenteditable', new FakeElement('div', { contenteditable: 'true' })],
    ['ボタンの中の要素', new FakeElement('span', {}, new FakeElement('button'))],
    ['ダイアログの中の要素', new FakeElement('p', {}, new FakeElement('div', { role: 'dialog' }))],
  ])('%s に届いたキーは扱わず、既定の動作も止めない', (_, target) => {
    const { win, drag, releases } = setup();
    drag.setActive(true);
    for (const k of ['Enter', ' ', 'ArrowLeft', 'd']) {
      const down = key('keydown', k, {}, target);
      win.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(false);
      expect(drag.keyDirection).toBe(0);
      const up = key('keyup', k, {}, target);
      win.dispatchEvent(up);
      expect(up.defaultPrevented).toBe(false);
    }
    expect(releases).toEqual([]);
  });

  test.each([
    ['リンクでない a', new FakeElement('a')],
    ['contenteditable="false"', new FakeElement('div', { contenteditable: 'false' })],
    ['ふつうの要素', new FakeElement('div', {}, new FakeElement('main'))],
  ])('%s に届いたキーは扱う', (_, target) => {
    const { win, drag, releases } = setup();
    drag.setActive(true);
    const down = key('keydown', 'Enter', {}, target);
    win.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    win.dispatchEvent(key('keyup', 'Enter', {}, target));
    expect(releases.length).toBe(1);
    win.dispatchEvent(key('keydown', 'ArrowRight', {}, target));
    expect(drag.keyDirection).toBe(1);
  });

  test('押している間にフォーカスがボタンへ移ったら、離したときに発射せず、押していたキーも忘れる', () => {
    const { win, drag, releases } = setup();
    const button = new FakeElement('button');
    drag.setActive(true);
    win.dispatchEvent(key('keydown', ' '));
    win.dispatchEvent(key('keydown', 'ArrowLeft'));
    expect(drag.keyDirection).toBe(-1);
    const upMove = key('keyup', 'ArrowLeft', {}, button);
    win.dispatchEvent(upMove);
    expect(upMove.defaultPrevented).toBe(false);
    expect(drag.keyDirection).toBe(0);
    const upLaunch = key('keyup', ' ', {}, button);
    win.dispatchEvent(upLaunch);
    expect(upLaunch.defaultPrevented).toBe(false);
    expect(releases).toEqual([]);
    // 忘れたので、あとからボタンの外で離しても発射しない
    win.dispatchEvent(key('keyup', ' '));
    expect(releases).toEqual([]);
  });

  test('blur で押しているキーを忘れる', () => {
    const { win, drag } = setup();
    drag.setActive(true);
    win.dispatchEvent(key('keydown', 'ArrowRight'));
    win.dispatchEvent(new Event('blur'));
    expect(drag.keyDirection).toBe(0);
  });
});

describe('RelativeDrag.dispose', () => {
  test('すべてのリスナーを外す', () => {
    const { el, win, drag, moves, releases } = setup();
    drag.setActive(true);
    drag.dispose();
    drag.setActive(true);
    el.dispatchEvent(pointer('pointerdown', 1, 100));
    el.dispatchEvent(pointer('pointermove', 1, 120));
    el.dispatchEvent(pointer('pointerup', 1, 120));
    el.dispatchEvent(pointer('pointermove', 9, 100, 'mouse'));
    el.dispatchEvent(pointer('pointermove', 9, 110, 'mouse'));
    win.dispatchEvent(key('keydown', 'ArrowLeft'));
    win.dispatchEvent(key('keydown', ' '));
    win.dispatchEvent(key('keyup', ' '));
    expect(moves).toEqual([]);
    expect(releases).toEqual([]);
    expect(drag.keyDirection).toBe(0);
  });
});
