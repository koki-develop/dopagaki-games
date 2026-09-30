import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';

/** three.js の TSL が式を積む先（StackNode）を切り替える口。型定義にないので、実行時の関数を取り出して使う */
type StackApi = { setCurrentStack(stack: unknown): void; getCurrentStack(): unknown };
type StackNodeLike = Node & { nodes: Node[] };

/** Fn の中身（JS の関数）を持つ node。Fn の呼び出し（ShaderCallNodeInternal）と、Loop や If に渡した中身（ShaderNodeInternal） */
type Deferred = Node & { shaderNode?: { jsFunc: (...args: unknown[]) => unknown }; jsFunc?: (...args: unknown[]) => unknown };

type MathLike = Node & { isMathNode?: boolean; method?: string; aNode?: Node; bNode?: Node };
type ConstLike = Node & { isConstNode?: boolean; value?: unknown };
type VarLike = Node & { isVarNode?: boolean; node?: Node };

const stackApi = TSL as unknown as StackApi;
const StackNode = (THREE as unknown as { StackNode: new () => StackNodeLike }).StackNode;

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && (v as { isNode?: boolean }).isNode === true;

/**
 * Fn・Loop・If の中身は、シェーダーを組み立てるまで作られない。空の StackNode の上で中身を呼び、できた node を返す。
 * 組み立ての情報（NodeBuilder）を使う three.js の組み込みの中身は呼べないので、辿らない
 */
function expand(n: Deferred): Node[] {
  const fn = n.shaderNode?.jsFunc ?? n.jsFunc;
  if (typeof fn !== 'function') return [];
  const prev = stackApi.getCurrentStack();
  const stack = new StackNode();
  stackApi.setCurrentStack(stack);
  try {
    const out = fn({ i: TSL.int(0) }, null);
    return isNode(out) ? [out, ...stack.nodes] : [...stack.nodes];
  } catch {
    return [];
  } finally {
    stackApi.setCurrentStack(prev);
  }
}

/** root からつながる node のうち、match に合うもの（Fn・Loop・If の中身も組み立てて辿る） */
export function findNodes(root: Node, match: (n: Node) => boolean): Node[] {
  const seen = new Set<number>();
  const found: Node[] = [];
  const todo: Node[] = [root];
  while (todo.length > 0) {
    const n = todo.pop() as Node;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    if (match(n)) found.push(n);
    for (const c of n.getChildren()) todo.push(c);
    for (const c of expand(n as Deferred)) todo.push(c);
  }
  return found;
}

/** root から target へ node のつながりを辿れるか（Fn・Loop・If の中身も組み立てて辿る） */
export const reaches = (root: Node, target: Node): boolean => findNodes(root, (n) => n.id === target.id).length > 0;

/** 変数の node（TSL の max や pow などは結果を変数に包む）を外した中身 */
function unwrap(n: Node | undefined): Node | undefined {
  let x = n as VarLike | undefined;
  while (x?.isVarNode === true && x.node) x = x.node as VarLike;
  return x;
}

/** n 自身が method の MathNode なら、それ（変数に包まれたものは外さない。同じ式を 2 回数えないように） */
const mathOf = (n: Node, method: string): MathLike | null => {
  const m = n as MathLike;
  return m.isMathNode === true && m.method === method ? m : null;
};

const constValue = (n: Node | undefined): number | null => {
  const c = unwrap(n) as ConstLike | undefined;
  return c?.isConstNode === true && typeof c.value === 'number' ? c.value : null;
};

/** MathNode の pow か */
export const isPow = (n: Node): boolean => mathOf(n, 'pow') !== null;

/** root から辿れる smoothstep のうち、両端が定数で edge0 >= edge1 のもの（結果が決まらない）の両端 */
export function reversedSmoothsteps(root: Node): [number, number][] {
  const out: [number, number][] = [];
  for (const n of findNodes(root, (x) => mathOf(x, 'smoothstep') !== null)) {
    const m = n as MathLike;
    const e0 = constValue(m.aNode);
    const e1 = constValue(m.bNode);
    if (e0 !== null && e1 !== null && e0 >= e1) out.push([e0, e1]);
  }
  return out;
}

/** 負にならないと式の形から分かる値か（0 以上の定数、max(x, 0 以上の定数)、clamp(x, 0 以上の定数, …)、abs） */
function nonNegative(n: Node | undefined): boolean {
  if (!n) return false;
  const c = constValue(n);
  if (c !== null) return c >= 0;
  const m = unwrap(n) as MathLike | undefined;
  if (m?.isMathNode !== true) return false;
  if (m.method === 'abs') return true;
  if (m.method === 'max') return (constValue(m.bNode) ?? -1) >= 0 || (constValue(m.aNode) ?? -1) >= 0;
  if (m.method === 'clamp') return (constValue(m.bNode) ?? -1) >= 0;
  return false;
}

/** root から辿れる pow のうち、底が負にならないと式の形から分からないもの（負の底では値が決まらない） */
export const unguardedPows = (root: Node): Node[] => findNodes(root, (n) => isPow(n) && !nonNegative((n as MathLike).aNode));
