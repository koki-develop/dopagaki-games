/**
 * 素のモジュール。ブラウザの機能にも Node の機能にも、時刻にも乱数にも触れない。
 * ビルドのコード（Node）からも読めて、ブロック崩しの sim とリバーシの CPU は同じシードと入力なら同じ結果になる。
 * 素のモジュールが import してよいのは素のモジュールだけ（.dependency-cruiser.ts）で、
 * 使ってよいグローバルは決定的な ECMAScript の組み込みと、ブラウザにも Node にもある一部だけ（oxlint.config.ts）。
 *
 * `/` で終わるものはディレクトリ、それ以外はファイル。パスはリポジトリの根からの相対。
 */
export const PURE_MODULES: readonly string[] = [
  'src/shared/',
  'src/juice/frame-time.ts',
  'src/app/site.ts',
  'src/app/game/result-best.ts',
  'src/app/reversi/summary.ts',
  'src/app/blackjack/summary.ts',
  'src/games/breakout/config.ts',
  'src/games/breakout/controller.ts',
  'src/games/breakout/hud/layout.ts',
  'src/games/breakout/hud/model.ts',
  'src/games/breakout/sim/',
  'src/games/breakout/records-model.ts',
  'src/games/breakout/session-state.ts',
  'src/games/breakout/types.ts',
  'src/games/breakout/fx/fracture.ts',
  'src/games/reversi/rules/',
  'src/games/reversi/ai/',
  'src/games/reversi/combo.ts',
  'src/games/reversi/config.ts',
  'src/games/reversi/controller.ts',
  'src/games/reversi/geometry.ts',
  'src/games/reversi/hud/layout.ts',
  'src/games/reversi/hud/model.ts',
  'src/games/reversi/match.ts',
  'src/games/reversi/records-model.ts',
  'src/games/reversi/scoring.ts',
  'src/games/reversi/session-state.ts',
  'src/games/reversi/stable-tracker.ts',
  'src/games/reversi/types.ts',
  'src/games/reversi/fx/choreo.ts',
  'src/games/reversi/fx/score-ticker.ts',
  'src/games/blackjack/rules/',
  'src/games/blackjack/strategy/',
  'src/games/blackjack/config.ts',
  'src/games/blackjack/controller.ts',
  'src/games/blackjack/denominations.ts',
  'src/games/blackjack/geometry.ts',
  'src/games/blackjack/hud/layout.ts',
  'src/games/blackjack/hud/model.ts',
  'src/games/blackjack/records-model.ts',
  'src/games/blackjack/scoring.ts',
  'src/games/blackjack/session-state.ts',
  'src/games/blackjack/streak.ts',
  'src/games/blackjack/table.ts',
  'src/games/blackjack/types.ts',
  'src/games/blackjack/fx/tension.ts',
];

const isDirectory = (path: string): boolean => path.endsWith('/');

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** dependency-cruiser の path に渡す正規表現 */
export const PURE_MODULE_PATTERNS = PURE_MODULES.map(
  (path) => `^${escapeRegExp(path)}${isDirectory(path) ? '' : '$'}`,
);

/** oxlint の overrides の files に渡す glob */
export const PURE_MODULE_GLOBS = PURE_MODULES.map((path) => (isDirectory(path) ? `${path}**` : path));
