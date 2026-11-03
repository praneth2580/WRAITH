import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WaitTimeoutError, WraithError } from '../src/errors.js';
import { createWraith, type Wraith } from '../src/wraith.js';
import { json, startServer, type TestServer } from './helpers/server.js';

const LOADING = `<!doctype html><body>
<label for="email">Email</label> <input id="email">
<button id="load">Load results</button>
<div id="results"></div>
<nav><a href="#" class="x1">Prev</a> <button class="css-9f2a">Load results</button></nav>
<script>
  load.onclick = async () => {
    results.innerHTML = '<div class="spinner">Loading…</div>';
    const data = await (await fetch('/api/slow')).json();
    results.innerHTML = data.items.map((i) => '<p class="item">' + i + '</p>').join('');
  };
</script></body>`;

let server: TestServer;
let wraith: Wraith;

beforeAll(async () => {
  server = await startServer({
    '/disabled': `<button id="b" disabled onclick="document.title='clicked'">Submit</button>
      <script>setTimeout(() => b.disabled = false, 1000)</script>`,
    '/covered': `<button id="b" onclick="document.title='clicked'">Go</button>
      <div id="overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.4)" onclick="document.title='overlay'"></div>
      <script>setTimeout(() => overlay.remove(), 1000)</script>`,
    '/loading': LOADING,
    '/api/slow': (_req, res) => setTimeout(() => json(res, 200, { items: ['Apple', 'Banana', 'Cherry'] }), 800),
    '/busy': '<div class="loader" style="width:40px;height:40px">spinning</div><p>content</p>',
    '/redirecting': '<script>setTimeout(() => location.href = "/dest", 300)</script>',
    '/dest': '<h1>Destination</h1>',
  });
  wraith = createWraith({ human: 'fast', network: { rateLimit: false }, waits: { afterAction: 'none' } });
});

afterAll(async () => {
  await wraith?.close();
  await server?.close();
});

describe('clicks wait until the element can really be clicked', () => {
  it('waits for a disabled button to become enabled', async () => {
    const page = await wraith.open(`${server.url}/disabled`);
    const started = Date.now();
    await page.click('#b');
    expect(await page.title()).toBe('clicked');
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    await page.close();
  });

  it('waits for an overlay to go instead of clicking it', async () => {
    const page = await wraith.open(`${server.url}/covered`);
    await page.click('#b');
    expect(await page.title()).toBe('clicked');
    await page.close();
  });
});

describe('waitForSettled', () => {
  it('waits for the request, the spinner and the new content', async () => {
    const page = await wraith.open(`${server.url}/loading`);
    const started = Date.now();
    await page.click('#load');
    expect(await page.raw.locator('.item').count()).toBe(0);
    expect(await page.waitForSettled()).toBe(true);
    expect(await page.raw.locator('.item').count()).toBe(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(700);
    await page.close();
  });

  it("can be what every action waits for (waits: { afterAction: 'settle' })", async () => {
    const settled = createWraith({ human: 'fast', network: { rateLimit: false }, waits: { afterAction: 'settle' } });
    try {
      const page = await settled.open(`${server.url}/loading`);
      await page.click('#load');
      expect(await page.raw.locator('.item').count()).toBe(3);
    } finally {
      await settled.close();
    }
  });

  it('returns false instead of throwing when a loader never goes', async () => {
    const page = await wraith.open(`${server.url}/busy`);
    expect(await page.waitForSettled({ timeout: 800 })).toBe(false);
    expect(await page.waitForSettled({ timeout: 2000, loaders: false })).toBe(true);
    await page.close();
  });
});

describe('wait helpers', () => {
  it('waits for text, URLs and arbitrary conditions', async () => {
    const page = await wraith.open(`${server.url}/loading`);
    await page.click('#load');
    await page.waitForText('Cherry');
    const count = await page.waitUntil(async () => (await page.raw.locator('.item').count()) || null);
    expect(count).toBe(3);
    await expect(page.waitUntil(() => false, { timeout: 300, message: 'Never' })).rejects.toThrow(WaitTimeoutError);

    await page.goto(`${server.url}/redirecting`);
    await page.waitForUrl('**/dest');
    expect(await page.text('h1')).toBe('Destination');
    await page.close();
  });
});

describe('semantic targets', () => {
  it('finds elements by role, label and text instead of class names', async () => {
    const page = await wraith.open(`${server.url}/loading`);
    await page.type({ label: 'Email' }, 'me@example.com');
    expect(await page.raw.inputValue('#email')).toBe('me@example.com');
    // Two buttons share the name; `within` picks the one in the nav.
    await page.click({ role: 'button', name: 'Load results', within: { role: 'navigation' } });
    await page.click({ role: 'button', name: 'Load results' });
    await page.waitForText('Banana');
    await expect(page.click({ role: 'button', text: 'x' })).rejects.toThrow(WraithError);
    await page.close();
  });
});
