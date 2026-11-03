import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HoneypotError } from '../src/errors.js';
import { withHoneypotCheck } from '../src/honeypots.js';
import { collectElements } from '../src/in-page.js';
import { createWraith, type Wraith } from '../src/wraith.js';
import { startServer, type TestServer } from './helpers/server.js';

const TRAPS = `<!doctype html><html><head><title>Shop</title><style>
  body { font: 16px sans-serif; margin: 20px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
  .custom input { opacity: 0; position: absolute; }
</style></head><body>
<p><a id="real" href="/real">Real link</a></p>
<a id="card" href="/card"><div style="width:120px;height:40px;background:#eee">Card</div></a>
<a id="none" href="/trap/display" style="display:none">Free gift</a>
<div style="display:none"><a id="parent-none" href="/trap/parent">Free gift</a></div>
<a id="visibility" href="/trap/visibility" style="visibility:hidden">Free gift</a>
<a id="transparent" href="/trap/opacity" style="opacity:0">Free gift</a>
<div style="opacity:0.05"><a id="faint" href="/trap/faint">Free gift</a></div>
<a id="offscreen" href="/trap/offscreen" style="position:absolute;left:-9999px">Free gift</a>
<a id="tiny" href="/trap/tiny" style="display:inline-block;width:1px;height:1px;overflow:hidden">Free gift</a>
<div style="height:0;overflow:hidden"><a id="clipped" href="/trap/clipped">Free gift</a></div>
<a id="camouflage" href="/trap/colour" style="color:#fff">Free gift</a>
<a id="screen-reader" class="sr-only" href="/trap/sr-only">Free gift</a>
<form action="/submit">
  <label for="email">Email</label> <input id="email" name="email">
  <div style="position:absolute;left:-5000px"><label for="website">Website</label><input id="website" name="website"></div>
  <label class="custom"><input id="agree" type="checkbox"> I agree</label>
</form>
</body></html>`;

const FADE = `<!doctype html><title>Fade</title>
<button id="fade" style="opacity:0;transition:opacity .2s" onclick="document.title='clicked'">Continue</button>
<script>setTimeout(() => (document.getElementById('fade').style.opacity = '1'), 300);</script>`;

// Without a browser, only what the markup itself says is hidden can be judged.
const STATIC = `<!doctype html><body>
<a href="/ok">ok</a>
<a href="/t1" style="display: none">x</a>
<div hidden><a href="/t2">x</a></div>
<a href="/t3" class="sr-only">x</a>
<a href="/t4" style="position:absolute; left:-9999px">x</a>
<a href="/t5" aria-hidden="true" tabindex="-1">x</a>
<a href="/t6" style="color:red; opacity:0">x</a>
<a href="/responsive" class="hidden md:block">menu</a>
<div class="d-none d-lg-block"><a href="/desktop">desktop</a></div>
</body>`;

const REASONS: Record<string, RegExp> = {
  none: /hidden \(display: none/,
  'parent-none': /hidden \(display: none/,
  visibility: /visibility: hidden/,
  transparent: /transparent \(opacity 0\)/,
  faint: /transparent \(opacity 0\.05\)/,
  offscreen: /off the page/,
  tiny: /too small to see \(1×1 px\)/,
  clipped: /clipped out of sight/,
  camouflage: /same colour as its background/,
  'screen-reader': /too small to see/,
  website: /off the page/,
};

let server: TestServer;
let wraith: Wraith;
let careful: Wraith;

beforeAll(async () => {
  server = await startServer({ '/': TRAPS, '/fade': FADE, '/static': STATIC, '/real': '<h1>Real</h1>', '/card': '<h1>Card</h1>' });
  wraith = createWraith({ human: 'off', network: { rateLimit: false } });
  careful = createWraith({ human: 'off', network: { rateLimit: false }, avoidHoneypots: true });
});

afterAll(async () => {
  await wraith?.close();
  await careful?.close();
  await server?.close();
});

describe('finding honeypots', () => {
  it('lists every trap with the reason a person could not see it, and nothing else', async () => {
    const page = await wraith.open(`${server.url}/`);
    const found = await page.honeypots();
    const byId = Object.fromEntries(found.map((h) => [/#([\w-]+)/.exec(h.element)![1], h.reason]));
    expect(Object.keys(byId).sort()).toEqual(Object.keys(REASONS).sort());
    for (const [id, reason] of Object.entries(REASONS)) expect(byId[id], id).toMatch(reason);
    expect(found.find((h) => h.element.startsWith('a#transparent'))).toMatchObject({ href: '/trap/opacity' });
    await page.close();
  });

  it('hides them from ai.act()', async () => {
    const page = await careful.open(`${server.url}/`);
    const labels = (await page.raw.evaluate(withHoneypotCheck(collectElements), 300)).map((e) => e.label);
    expect(labels).toEqual(expect.arrayContaining(['Real link', 'Card', 'Email', 'I agree']));
    expect(labels).not.toContain('Free gift');
    expect(labels).not.toContain('Website');
    // Without the check, the transparent and off-page traps would have been offered.
    const unchecked = (await page.raw.evaluate(collectElements, 300)).map((e) => e.label);
    expect(unchecked.filter((label) => label === 'Free gift').length).toBeGreaterThan(3);
    await page.close();
  });
});

describe('with avoidHoneypots', () => {
  it('links() leaves hidden links out', async () => {
    const plain = await wraith.open(`${server.url}/`);
    expect((await plain.links()).filter((l) => l.includes('/trap/'))).toHaveLength(10);
    const page = await careful.open(`${server.url}/`);
    expect(await page.links()).toEqual([`${server.url}/real`, `${server.url}/card`]);
    await plain.close();
    await page.close();
  });

  it('refuses to use honeypots, saying why', async () => {
    const page = await careful.open(`${server.url}/`);
    const error = await page.click('#transparent').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HoneypotError);
    expect(error).toMatchObject({ reason: 'transparent (opacity 0)', element: 'a#transparent "Free gift"' });
    await expect(page.type('#website', 'spam')).rejects.toThrow(/couldn't see it \(positioned off the page\)/);
    await expect(page.click('#none', { timeout: 1000 })).rejects.toThrow(HoneypotError);
    expect(page.url()).toBe(`${server.url}/`);
    await page.close();
  });

  it('still uses what people use: real fields, and checkboxes behind their labels', async () => {
    const page = await careful.open(`${server.url}/`);
    await page.type('#email', 'me@example.com');
    await page.check('#agree');
    expect(await page.raw.isChecked('#agree')).toBe(true);
    await page.click('#card');
    expect(page.url()).toBe(`${server.url}/card`);
    await page.close();
  });

  it('waits for elements that fade in', async () => {
    const page = await careful.open(`${server.url}/fade`);
    await page.click('#fade');
    expect(await page.title()).toBe('clicked');
    await page.close();
  });

  it('is off by default', async () => {
    const page = await wraith.open(`${server.url}/`);
    await page.click('#transparent');
    expect(page.url()).toBe(`${server.url}/trap/opacity`);
    await page.close();
  });
});

describe('static pages with avoidHoneypots', () => {
  it('leave out links the markup hides, but not ones shown on larger screens', async () => {
    const plain = await wraith.fetch(`${server.url}/static`);
    expect(plain.links()).toHaveLength(9);
    const page = await careful.fetch(`${server.url}/static`);
    expect(page.links()).toEqual([`${server.url}/ok`, `${server.url}/responsive`, `${server.url}/desktop`]);
  });

  it('keep crawls away from them', async () => {
    const { results } = await careful.crawl({ start: `${server.url}/static`, mode: 'static', maxDepth: 1, handler: ({ url }) => url });
    expect(results.map((r) => new URL(r.url).pathname).sort()).toEqual(['/desktop', '/ok', '/responsive', '/static']);
  });
});
