import { defineConfig } from 'oxlint';
import { PURE_MODULE_GLOBS } from './lint/pure-modules.ts';

const NOT_DETERMINISTIC = '素のモジュールは時刻・乱数・ロケール・GC の状態を読まない';
const REACHES_ENVIRONMENT = '素のモジュールは環境のグローバルに触れない';

export default defineConfig({
  plugins: ['react', 'typescript', 'oxc'],
  rules: {
    'react/rules-of-hooks': 'error',
    'react/exhaustive-deps': 'error',
    'typescript/no-non-null-assertion': 'error',
    'eslint/no-shadow': 'error',
    'react/only-export-components': ['warn', { allowConstantExport: true }],
  },
  overrides: [
    {
      files: ['src/**/*.test.ts', 'src/**/*.test-support.ts', 'build/**/*.test.ts', 'build/**/*.test-support.ts'],
      rules: { 'typescript/no-non-null-assertion': 'off' },
    },
    {
      // env を足さないので、定義済みのグローバルは ECMAScript の組み込みと、ここに挙げたものだけになる
      files: PURE_MODULE_GLOBS,
      // ブラウザにも Node にもあり、結果が環境によらない
      globals: { structuredClone: 'readonly', URL: 'readonly' },
      rules: {
        'eslint/no-undef': ['error', { typeof: true }],
        'eslint/no-restricted-globals': [
          'error',
          { name: 'Date', message: NOT_DETERMINISTIC },
          { name: 'Intl', message: NOT_DETERMINISTIC },
          { name: 'WeakRef', message: NOT_DETERMINISTIC },
          { name: 'FinalizationRegistry', message: NOT_DETERMINISTIC },
          { name: 'globalThis', message: REACHES_ENVIRONMENT },
          { name: 'eval', message: REACHES_ENVIRONMENT },
          { name: 'Function', message: REACHES_ENVIRONMENT },
        ],
        'eslint/no-restricted-properties': [
          'error',
          { object: 'Math', property: 'random', message: NOT_DETERMINISTIC },
          { property: 'localeCompare', message: NOT_DETERMINISTIC },
          { property: 'toLocaleString', message: NOT_DETERMINISTIC },
          { property: 'toLocaleDateString', message: NOT_DETERMINISTIC },
          { property: 'toLocaleTimeString', message: NOT_DETERMINISTIC },
          { property: 'toLocaleUpperCase', message: NOT_DETERMINISTIC },
          { property: 'toLocaleLowerCase', message: NOT_DETERMINISTIC },
        ],
      },
    },
  ],
});
