import sharp from 'sharp';

/**
 * サイトのアイコン。暗い地に白い球と、それを囲むシアンの輪。
 * rounded はタブ用の角丸。iOS のホーム画面は自分で角を丸めるので、apple-touch-icon には角を付けない
 */
const iconSvg = (rounded: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"${rounded ? ' rx="14"' : ''} fill="#020108"/><circle cx="32" cy="32" r="14" fill="#fff"/><circle cx="32" cy="32" r="20" fill="none" stroke="#5ef2ff" stroke-width="4"/></svg>`;

const rasterize = (svg: string, size: number): Promise<Buffer> =>
  sharp(Buffer.from(svg), { density: (72 * size) / 64 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

/** アイコンのファイル。パスはサイトのルートから。index.html の <link> がこのパスを指す */
type IconFile = { readonly path: string; readonly contentType: string; readonly body: Buffer };

/**
 * ブラウザのタブには SVG を、SVG を読めない場面（Google 検索の favicon など）には PNG を、
 * iOS のホーム画面には apple-touch-icon を使わせる。Google 検索の favicon は 48px より大きいものが推奨される
 */
export async function renderIcons(): Promise<IconFile[]> {
  return [
    { path: '/favicon.svg', contentType: 'image/svg+xml', body: Buffer.from(iconSvg(true)) },
    { path: '/favicon.png', contentType: 'image/png', body: await rasterize(iconSvg(true), 96) },
    { path: '/apple-touch-icon.png', contentType: 'image/png', body: await rasterize(iconSvg(false), 180) },
  ];
}
