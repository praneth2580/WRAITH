// Type-checks every ```ts block in the docs against wraith's source, so the examples can't
// drift from the API. Blocks marked ```ts sig (signatures and type sketches) are skipped.
//
// Each block becomes the body of an async function, with `wraith`, `page` and `url` declared,
// so fragments like `await page.click('#go')` check without boilerplate. Its import and
// `declare` lines move to the top of the file.
//
// Run from website/: npm run check (needs the root project's dependencies installed).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(site, '.snippets');
const tsc = join(site, '..', 'node_modules', '.bin', 'tsc');

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  });
}

const PRELUDE = `import type { Wraith as __Wraith, WraithPage as __WraithPage } from 'wraithjs';
declare const wraith: __Wraith;
declare const page: __WraithPage;
declare const url: string;`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

const sources = new Map();
for (const file of markdownFiles(site)) {
  const name = relative(site, file).replace(/\.md$/, '').replace(/[\\/]/g, '_');
  const blocks = [...readFileSync(file, 'utf8').matchAll(/^```ts\n([\s\S]*?)^```$/gm)];
  blocks.forEach((match, i) => {
    const lines = match[1].split('\n');
    const top = lines.filter((line) => /^(import |declare )/.test(line));
    const body = lines.filter((line) => !/^(import |declare )/.test(line));
    const snippet = `${name}_${i + 1}.ts`;
    writeFileSync(join(out, snippet), `${top.join('\n')}\n${PRELUDE}\n\nexport async function snippet() {\n${body.join('\n')}\n}\n`);
    sources.set(snippet, `${relative(site, file)} (block ${i + 1})`);
  });
}

writeFileSync(
  join(out, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      types: ['node'],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      paths: { wraithjs: ['../../src/index.ts'] },
    },
    include: ['*.ts'],
  }),
);

try {
  execFileSync(tsc, ['-p', out], { stdio: 'pipe' });
  console.log(`All ${sources.size} TypeScript examples type-check.`);
} catch (error) {
  const output = String(error.stdout || error.message);
  // Point errors at the page and block they came from.
  console.error(output.replace(/^(?:\.snippets\/)?([\w.-]+\.ts)/gm, (match, snippet) => sources.get(snippet) ?? match));
  process.exitCode = 1;
}
