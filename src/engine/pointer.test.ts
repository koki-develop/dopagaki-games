import { describe, expect, test } from 'bun:test';
import { FakeElement, key } from './dom-events.test-support.ts';
import { PointerInput } from './pointer.ts';

/** 左上が (10, 20) にある要素の代役 */
class FakeSurface extends EventTarget {
  captured: number[] = [];
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
  getBoundingClientRect(): { left: number; top: number } {
    return { left: 10, top: 20 };
  }
}

function pointer(type: string, pointerId: number, x: number, y: number, pointerType = 'touch', button = 0): Event {
  return Object.assign(new Event(type, { cancelable: true }), { pointerId, clientX: x, clientY: y, pointerType, button });
}

function setup() {
  const el = new FakeSurface();
  const win = new EventTarget();
  let nowMs = 0;
  const log: string[] = [];
  const input = new PointerInput(
    el,
    {
      onPress: (x, y) => log.push(`press ${x},${y}`),
      onMove: (x, y, pressed) => log.push(`${pressed ? 'drag' : 'hover'} ${x},${y}`),
      onRelease: (x, y, at) => log.push(`release ${x},${y} @${at}`),
      onCancel: () => log.push('cancel'),
      onKeyMove: (dx, dy) => log.push(`key ${dx},${dy}`),
      onKeyConfirm: (at) => log.push(`confirm @${at}`),
    },
    { keyTarget: win, now: () => nowMs },
  );
  return {
    el,
    win,
    input,
    log,
    setNow: (ms: number) => {
      nowMs = ms;
    },
  };
}

describe('PointerInput のポインター', () => {
  test('受け付けていない間は何もしない', () => {
    const { el, log } = setup();
    el.dispatchEvent(pointer('pointerdown', 1, 50, 60));
    el.dispatchEvent(pointer('pointerup', 1, 50, 60));
    expect(log).toEqual([]);
  });

  test('要素の左上からの位置で、押す・動かす・離すを伝える。離すときは押した時刻（秒）を付ける', () => {
    const { el, input, log, setNow } = setup();
    input.setActive(true);
    setNow(1500);
    const down = pointer('pointerdown', 1, 50, 60);
    el.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(el.captured).toEqual([1]);
    el.dispatchEvent(pointer('pointermove', 1, 55, 70));
    el.dispatchEvent(pointer('pointerup', 1, 56, 71));
    expect(log).toEqual(['press 40,40', 'drag 45,50', 'release 46,51 @1.5']);
  });

  test('最初に触れた指だけを追い、ほかの指は無視する', () => {
    const { el, input, log } = setup();
    input.setActive(true);
    el.dispatchEvent(pointer('pointerdown', 1, 20, 30));
    el.dispatchEvent(pointer('pointerdown', 2, 90, 90));
    el.dispatchEvent(pointer('pointermove', 2, 95, 95));
    el.dispatchEvent(pointer('pointerup', 2, 95, 95));
    el.dispatchEvent(pointer('pointerup', 1, 20, 30));
    expect(log).toEqual(['press 10,10', 'release 10,10 @0']);
  });

  test('pointercancel は離したことにせず、取り消しとして伝える', () => {
    const { el, input, log } = setup();
    input.setActive(true);
    el.dispatchEvent(pointer('pointerdown', 1, 20, 30));
    el.dispatchEvent(pointer('pointercancel', 1, 20, 30));
    el.dispatchEvent(pointer('pointerup', 1, 20, 30));
    expect(log).toEqual(['press 10,10', 'cancel']);
  });

  test('押していないマウスはホバーとして伝え、外へ出たら取り消す。指のホバーはない', () => {
    const { el, input, log } = setup();
    input.setActive(true);
    el.dispatchEvent(pointer('pointermove', 1, 30, 40, 'mouse'));
    el.dispatchEvent(pointer('pointerleave', 1, 0, 0, 'mouse'));
    el.dispatchEvent(pointer('pointermove', 2, 30, 40, 'touch'));
    expect(log).toEqual(['hover 20,20', 'cancel']);
  });

  test('受け付けを切り替えると、押している指を忘れる', () => {
    const { el, input, log } = setup();
    input.setActive(true);
    el.dispatchEvent(pointer('pointerdown', 1, 20, 30));
    input.setActive(false);
    input.setActive(true);
    el.dispatchEvent(pointer('pointerup', 1, 20, 30));
    expect(log).toEqual(['press 10,10']);
  });
});

describe('PointerInput のマウスのボタン', () => {
  test('主ボタン以外で押しても、押す・離すを伝えない', () => {
    const { el, input, log } = setup();
    input.setActive(true);
    el.dispatchEvent(pointer('pointerdown', 9, 30, 40, 'mouse', 2));
    el.dispatchEvent(pointer('pointerup', 9, 30, 40, 'mouse', 2));
    expect(el.captured).toEqual([]);
    expect(log).toEqual([]);
  });
});

describe('PointerInput.dispose', () => {
  test('すべてのリスナーを外す', () => {
    const { el, win, input, log } = setup();
    input.setActive(true);
    input.dispose();
    input.setActive(true);
    el.dispatchEvent(pointer('pointerdown', 1, 30, 40));
    el.dispatchEvent(pointer('pointermove', 1, 35, 40));
    el.dispatchEvent(pointer('pointerup', 1, 35, 40));
    el.dispatchEvent(pointer('pointermove', 9, 50, 50, 'mouse', -1));
    el.dispatchEvent(pointer('pointerleave', 9, 50, 50, 'mouse', -1));
    win.dispatchEvent(key('keydown', 'ArrowLeft'));
    win.dispatchEvent(key('keydown', ' '));
    win.dispatchEvent(key('keyup', ' '));
    expect(log).toEqual([]);
  });
});

describe('PointerInput のキー', () => {
  test('矢印キーと WASD で 1 マスずつ動かし、自動の繰り返しも伝える', () => {
    const { win, input, log } = setup();
    input.setActive(true);
    const e = key('keydown', 'ArrowUp');
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    win.dispatchEvent(key('keydown', 'd'));
    win.dispatchEvent(key('keydown', 'S', { repeat: true }));
    expect(log).toEqual(['key 0,-1', 'key 1,0', 'key 0,1']);
  });

  test('スペースと Enter は、受け付けている間に押したキーを離したときに決める', () => {
    const { win, input, log, setNow } = setup();
    win.dispatchEvent(key('keydown', 'Enter'));
    input.setActive(true);
    win.dispatchEvent(key('keyup', 'Enter'));
    setNow(3000);
    win.dispatchEvent(key('keydown', ' '));
    win.dispatchEvent(key('keydown', ' ', { repeat: true }));
    win.dispatchEvent(key('keyup', ' '));
    expect(log).toEqual(['confirm @3']);
  });

  test('ボタンやダイアログに届いたキーと、修飾キーつきのキーは扱わない', () => {
    const { win, input, log } = setup();
    input.setActive(true);
    const button = new FakeElement('button');
    const inDialog = new FakeElement('div', {}, new FakeElement('div', { role: 'dialog' }));
    for (const target of [button, inDialog]) {
      const e = key('keydown', 'ArrowLeft', {}, target);
      win.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
      win.dispatchEvent(key('keydown', 'Enter', {}, target));
      win.dispatchEvent(key('keyup', 'Enter', {}, target));
    }
    win.dispatchEvent(key('keydown', 'd', { ctrlKey: true }));
    expect(log).toEqual([]);
  });

  test('フォーカスが外れたら、押していた決めるキーを忘れる', () => {
    const { win, input, log } = setup();
    input.setActive(true);
    win.dispatchEvent(key('keydown', 'Enter'));
    win.dispatchEvent(new Event('blur'));
    win.dispatchEvent(key('keyup', 'Enter'));
    expect(log).toEqual([]);
  });
});
