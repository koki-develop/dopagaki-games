import { LoadError } from '../../../shared/fatal.ts';
import { cardCode, DECK_SIZE } from '../rules/cards.ts';

/*
 * カードの表の絵。イギリス式（English pattern）のトランプ 52 枚の SVG（faces/ に置く。出どころは faces/README.md）を、
 * 画像として読み込む。アトラスに描くのは card-art.ts。
 */

/** 表の SVG の大きさ（ピクセル。縦横比 2:3）と、角の丸みの半径 */
export const FACE_W = 360;
export const FACE_H = 540;
export const FACE_CORNER = 29.94;

/** カード c（0〜51）の表の SVG の URL。ビルドでは faces/ の各ファイルの URL に置き換わる */
const faceUrl = (c: number): string => new URL(`./faces/${cardCode(c)}.svg`, import.meta.url).href;

/** カードの表の画像。添字はカード（0〜51） */
export type CardFaces = readonly HTMLImageElement[];

/**
 * 52 枚の表の画像を読み込み、描ける状態（decode 済み）にする。DOM のない環境（bun test）では null。
 * 1 枚でも読めなければ LoadError で失敗する
 */
export async function loadCardFaces(): Promise<CardFaces | null> {
  if (typeof Image === 'undefined') return null;
  return Promise.all(
    Array.from({ length: DECK_SIZE }, async (_, c) => {
      const img = new Image();
      img.src = faceUrl(c);
      try {
        await img.decode();
      } catch (e) {
        throw new LoadError(`card face ${cardCode(c)} could not be loaded`, { cause: e });
      }
      return img;
    }),
  );
}
