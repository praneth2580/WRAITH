import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * tsx and other esbuild setups with keepNames wrap named inner functions in __name(), a helper
 * that exists in Node but not in the page, so a function sent through page.evaluate() breaks.
 * Top-level __name(fn, "fn") calls are harmless: they run in Node.
 */
async function nestedNameCalls(source: string): Promise<string[]> {
  const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022', keepNames: true });
  return code.split('\n').filter((line) => line.includes('__name(') && /^\s/.test(line));
}

describe('functions that run in the browser', () => {
  it('detects the problem it guards against', async () => {
    expect(await nestedNameCalls('export function f() { const g = () => 1; return g(); }')).not.toEqual([]);
  });

  it('src/in-page.ts works under keepNames', async () => {
    const source = await readFile(new URL('../src/in-page.ts', import.meta.url), 'utf8');
    expect(await nestedNameCalls(source)).toEqual([]);
  });
});
