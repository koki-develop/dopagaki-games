import type { Rng } from '../../../shared/rng.ts';
import { DECK_SIZE, pointOf, POINTS } from './cards.ts';
import type { Card } from './cards.ts';

/** シューに入れる組の数 */
export const DECKS = 2;
export const SHOE_SIZE = DECKS * DECK_SIZE;

/** Fisher–Yates で cards を混ぜる（その場で並べ替える） */
function shuffle(cards: Card[], rng: Rng): void {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = cards[i];
    cards[i] = cards[j];
    cards[j] = t;
  }
}

/** decks 組ぶんのカード（番号の順） */
function fullShoe(decks: number): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) for (let c = 0; c < DECK_SIZE; c++) cards.push(c);
  return cards;
}

/**
 * カードを配るシュー。混ぜたカードを先頭から 1 枚ずつ配る。配る順は作ったときに決まり、変えるのは Fortune の入れ替え（swapNext）だけ。
 *
 * - カードが尽きたら、それまでのラウンドで捨てたカード（場に出ているカードは除く）を混ぜ直して続ける
 * - まだ配っていないカードの数を、点の種類（1〜10）ごとに数えておく。確率の計算に使う
 */
export class Shoe {
  /** まだ配っていないカードの数。添字は点の種類 − 1 */
  readonly remainingByPoint = new Int32Array(POINTS);
  private order: Card[];
  private pos = 0;
  private drawn = 0;
  private readonly discards: Card[] = [];
  private readonly rng: Rng | null;
  /** 捨てたカードを混ぜ直した回数 */
  reshuffles = 0;

  private constructor(order: Card[], rng: Rng | null) {
    this.order = order;
    this.rng = rng;
    for (const c of order) this.remainingByPoint[pointOf(c) - 1]++;
  }

  /** decks 組を rng で混ぜたシュー */
  static shuffled(rng: Rng, decks = DECKS): Shoe {
    const cards = fullShoe(decks);
    shuffle(cards, rng);
    return new Shoe(cards, rng);
  }

  /**
   * 先頭に top のカードをこの順で置き、残りを rng で混ぜたシュー（開発用の操作口とテストで、配るカードを決めるのに使う）。
   * decks 組に入っていない枚数のカードを top に含めたら投げる
   */
  static withTop(top: readonly Card[], rng: Rng, decks = DECKS): Shoe {
    const rest = fullShoe(decks);
    for (const c of top) {
      const i = rest.indexOf(c);
      if (i < 0) throw new Error(`card ${c} is not left in the shoe`);
      rest.splice(i, 1);
    }
    shuffle(rest, rng);
    return new Shoe([...top, ...rest], rng);
  }

  /** order の順にそのまま配るシュー（テスト用）。尽きたら、捨てたカードを捨てた順に配り直す */
  static ofOrder(order: readonly Card[]): Shoe {
    return new Shoe([...order], null);
  }

  /** 配った枚数（捨てたカードを混ぜ直した後も数え続ける） */
  get dealt(): number {
    return this.drawn;
  }

  /** シューに残っている枚数 */
  get remaining(): number {
    return this.order.length - this.pos;
  }

  /** 次に配るカードから数えて offset 枚目（0 が次の 1 枚）のカード。シューに残っていなければ -1 */
  peek(offset: number): Card {
    const i = this.pos + offset;
    return offset >= 0 && i < this.order.length ? this.order[i] : -1;
  }

  /**
   * 次に配るカードと、offset 枚目のカードを入れ替える（Fortune が使う）。残りのカードの構成は変わらない。
   * offset がシューに残っている枚数の外なら投げる
   */
  swapNext(offset: number): void {
    const j = this.pos + offset;
    if (offset <= 0 || j >= this.order.length) throw new Error(`no card at offset ${offset}`);
    const t = this.order[this.pos];
    this.order[this.pos] = this.order[j];
    this.order[j] = t;
  }

  /** 1 枚配る。尽きていたら、捨てたカードを混ぜ直してから配る。捨てたカードもなければ投げる */
  draw(): Card {
    if (this.pos >= this.order.length) this.refill();
    const c = this.order[this.pos++];
    this.remainingByPoint[pointOf(c) - 1]--;
    this.drawn++;
    return c;
  }

  /** ラウンドを終えて、場のカードを捨てる */
  discard(cards: readonly Card[]): void {
    for (const c of cards) this.discards.push(c);
  }

  private refill(): void {
    if (this.discards.length === 0) throw new Error('the shoe and the discards are empty');
    const cards = this.discards.splice(0);
    if (this.rng) shuffle(cards, this.rng);
    this.order = cards;
    this.pos = 0;
    for (const c of cards) this.remainingByPoint[pointOf(c) - 1]++;
    this.reshuffles++;
  }
}
