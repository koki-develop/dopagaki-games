import type { IConfiguration } from 'dependency-cruiser';
import { PURE_MODULE_PATTERNS } from './lint/pure-modules.ts';

// パッケージは配置（hoisted か isolated か）によらず、パスの中の node_modules/<名前>/ で見分ける
const THREE = '(^|/)node_modules/(@types/)?three/';

const TEST_CODE = '\\.test(-support)?\\.tsx?$';

const config: IConfiguration = {
  forbidden: [
    {
      name: 'not-to-unresolvable',
      comment: '解決できない import は、ほかの規則の検査をすり抜ける',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-depends-on-nothing',
      comment: 'src/shared/ は何にも依存しない（テストのコードはテストの道具を読む）',
      severity: 'error',
      from: { path: '^src/shared/', pathNot: TEST_CODE },
      to: { pathNot: '^src/shared/' },
    },
    {
      name: 'juice-layer',
      comment: 'src/juice/ から読んでよいのは src/shared/ だけ',
      severity: 'error',
      from: { path: '^src/juice/' },
      to: { path: '^src/', pathNot: '^src/(shared|juice)/' },
    },
    {
      name: 'engine-layer',
      comment: 'src/engine/ から読んでよいのは src/shared/ だけ',
      severity: 'error',
      from: { path: '^src/engine/' },
      to: { path: '^src/', pathNot: '^src/(shared|engine)/' },
    },
    {
      name: 'games-layer',
      comment: 'ゲームから読んでよいのは src/shared/、src/juice/、src/engine/ と、そのゲーム自身だけ',
      severity: 'error',
      from: { path: '^src/games/([^/]+)/' },
      to: { path: '^src/', pathNot: '^src/(shared|juice|engine|games/$1)/' },
    },
    {
      name: 'app-layer',
      comment: 'src/app/ から src/ 直下のエントリは読まない',
      severity: 'error',
      from: { path: '^src/app/' },
      to: { path: '^src/', pathNot: '^src/(shared|juice|engine|games|app)/' },
    },
    {
      name: 'src-stays-in-src',
      comment: 'src/ はブラウザで動くので、Node で動く build/ や設定ファイルを読まない',
      severity: 'error',
      from: { path: '^src/' },
      to: { dependencyTypes: ['local'], pathNot: '^src/' },
    },
    {
      name: 'build-reads-pure-src',
      comment: 'build/ から読んでよい src/ のモジュールは、lint/pure-modules.ts の素のモジュールだけ',
      severity: 'error',
      from: { path: '^build/' },
      to: { path: '^src/', pathNot: PURE_MODULE_PATTERNS },
    },
    {
      name: 'pure-stays-pure',
      comment: '素のモジュールから辿れるのは素のモジュールだけ',
      severity: 'error',
      from: { path: PURE_MODULE_PATTERNS, pathNot: TEST_CODE },
      to: { pathNot: PURE_MODULE_PATTERNS, reachable: true },
    },
    {
      name: 'three-only-in-render',
      comment: 'three.js を import してよいのは src/engine/ と各ゲームの view/ だけ',
      severity: 'error',
      from: { pathNot: '^src/(engine|games/[^/]+/view)/' },
      to: { path: THREE },
    },
    {
      name: 'fx-without-three',
      comment: '各ゲームの fx/（演出）は three.js に依存しない',
      severity: 'error',
      from: { path: '^src/games/[^/]+/fx/' },
      to: { path: THREE, reachable: true },
    },
    {
      name: 'fx-reads-plain-view',
      comment: '各ゲームの fx/ が view/ から読んでよいのは look.ts と palette.ts だけ',
      severity: 'error',
      from: { path: '^src/games/([^/]+)/fx/' },
      to: { path: '^src/games/$1/view/', pathNot: '^src/games/$1/view/(look|palette)\\.ts$' },
    },
    {
      name: 'test-code-only-from-tests',
      comment: 'テストとテストの補助モジュールは、アプリの型チェックとビルドから外れる',
      severity: 'error',
      from: { pathNot: TEST_CODE },
      to: { path: TEST_CODE },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: '(^|/)node_modules/' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    skipAnalysisNotInRules: true,
  },
};

export default config;
