import { defineConfig } from 'oxlint';

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
  ],
});
