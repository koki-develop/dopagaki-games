/**
 * 素のモジュール。ブラウザの機能にも Node の機能にも、時刻にも乱数にも触れない。
 * ビルドのコード（Node）からも読めて、ブロック崩しの sim は同じシードと入力なら同じ結果になる。
 * 素のモジュールが import してよいのは素のモジュールだけ（.dependency-cruiser.ts）で、
 * 使ってよいグローバルは決定的な ECMAScript の組み込みと、ブラウザにも Node にもある一部だけ（oxlint.config.ts）。
 *
 * `/` で終わるものはディレクトリ、それ以外はファイル。パスはリポジトリの根からの相対。
 */
export const PURE_MODULES = [
  'src/shared/',
  'src/app/site.ts',
  'src/games/breakout/config.ts',
  'src/games/breakout/sim/',
  'src/games/breakout/fx/fracture.ts',
];

const isDirectory = (path: string): boolean => path.endsWith('/');

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** dependency-cruiser の path に渡す正規表現 */
export const PURE_MODULE_PATTERNS = PURE_MODULES.map(
  (path) => `^${escapeRegExp(path)}${isDirectory(path) ? '' : '$'}`,
);

/** oxlint の overrides の files に渡す glob */
export const PURE_MODULE_GLOBS = PURE_MODULES.map((path) => (isDirectory(path) ? `${path}**` : path));
