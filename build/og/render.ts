import satori from 'satori';
import type { SatoriOptions } from 'satori';
import sharp from 'sharp';
import { OG_HEIGHT, OG_WIDTH } from './card.ts';
import type { OgCard } from './card.ts';

/**
 * OG 画像を PNG にする。satori で文字の形をパスにした SVG を作り、sharp で画素にする。
 * 文字をパスにしておくので、描く環境にフォントが入っていなくても同じ見た目になる
 */
export async function renderOgPng(card: OgCard, fonts: SatoriOptions['fonts']): Promise<Buffer> {
  const svg = await satori(card.render(), { width: OG_WIDTH, height: OG_HEIGHT, fonts });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
