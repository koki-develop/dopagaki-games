import { describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PURE_MODULE_GLOBS, PURE_MODULE_PATTERNS, PURE_MODULES } from './pure-modules.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('PURE_MODULES', () => {
  test('挙げたファイルとディレクトリはどれもある（名前を変えたら一覧も直す）', () => {
    const missing = PURE_MODULES.filter((path) => {
      try {
        const st = statSync(root + path);
        return path.endsWith('/') ? !st.isDirectory() : !st.isFile();
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  test('ディレクトリはその中すべて、ファイルはそのファイルだけに当てはまる', () => {
    const i = PURE_MODULES.indexOf('src/shared/');
    const j = PURE_MODULES.indexOf('src/app/site.ts');
    const dir = new RegExp(PURE_MODULE_PATTERNS[i]);
    const file = new RegExp(PURE_MODULE_PATTERNS[j]);
    expect(dir.test('src/shared/math.ts')).toBe(true);
    expect(dir.test('src/sharedx/math.ts')).toBe(false);
    expect(file.test('src/app/site.ts')).toBe(true);
    expect(file.test('src/app/site.tsx')).toBe(false);
    expect([PURE_MODULE_GLOBS[i], PURE_MODULE_GLOBS[j]]).toEqual(['src/shared/**', 'src/app/site.ts']);
  });
});
