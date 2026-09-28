import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { SatoriOptions } from 'satori';

/** 画像の文字に使うフォントの名前。スタイルの fontFamily にはこれを書く */
export const DISPLAY_FONT = 'Dela Gothic One';

/**
 * 画面の見出しと同じ Dela Gothic One を、アプリが使っている @fontsource のファイルから読む。
 * satori は WOFF2 を読めないので WOFF を使う。
 * 日本語のサブセットは ASCII もすべて含むので、この 1 本だけを渡す。
 * satori は同じ名前と太さのフォントを 1 本しか使わず、ラテン文字のサブセットを並べると日本語が描けなくなるため
 */
export async function loadFonts(): Promise<SatoriOptions['fonts']> {
  const url = import.meta.resolve('@fontsource/dela-gothic-one/files/dela-gothic-one-japanese-400-normal.woff');
  const data = await readFile(fileURLToPath(url));
  return [{ name: DISPLAY_FONT, data, weight: 400, style: 'normal' }];
}
