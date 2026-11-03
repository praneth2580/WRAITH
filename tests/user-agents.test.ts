import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RobotsDisallowedError, WraithError } from '../src/errors.js';
import { builtInUserAgents } from '../src/net/user-agents.js';
import { createWraith } from '../src/wraith.js';
import { startHttpProxy } from './helpers/proxy.js';
import { startServer, type TestServer } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await startServer({
    '/ua': (req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(`<h1>${req.headers['user-agent']}</h1>`),
    '/robots.txt': (_req, res) =>
      res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: mybot\nDisallow: /\n\nUser-agent: *\nAllow: /\n'),
  });
});

afterAll(() => server?.close());

const quiet = { human: 'off', network: { rateLimit: false } } as const;

function playwrightVersions() {
  const require = createRequire(import.meta.url);
  const core = createRequire(require.resolve('playwright/package.json')).resolve('playwright-core/package.json');
  const { browsers } = JSON.parse(readFileSync(join(dirname(core), 'browsers.json'), 'utf8')) as { browsers: { name: string; browserVersion: string }[] };
  return Object.fromEntries(browsers.map((b) => [b.name, b.browserVersion]));
}

describe('built-in user agents', () => {
  it('are current desktop browsers, matching what Playwright installs', () => {
    const versions = playwrightVersions();
    const chrome = versions.chromium!.split('.')[0];
    const firefox = versions.firefox!.split('.')[0];
    expect(builtInUserAgents('chromium')).toHaveLength(3);
    for (const agent of builtInUserAgents('chromium')) expect(agent).toContain(`Chrome/${chrome}.0.0.0`);
    for (const agent of builtInUserAgents('firefox')) expect(agent).toContain(`Firefox/${firefox}.0`);
    expect(builtInUserAgents('webkit')).toEqual([expect.stringContaining(`Version/${versions.webkit!.split('.').slice(0, 2).join('.')} Safari/`)]);
    const all = builtInUserAgents();
    expect(all).toHaveLength(8);
    expect(all.some((a) => a.includes(' Edg/'))).toBe(true);
    expect(all.some((a) => /headless/i.test(a))).toBe(false);
  });
});

describe('userAgent for static fetches', () => {
  it('takes a list in turn, unless a request sets its own', async () => {
    const wraith = createWraith({ ...quiet, userAgent: ['agent-a', 'agent-b'] });
    const seen = [];
    for (let i = 0; i < 3; i++) seen.push((await wraith.fetch(`${server.url}/ua`)).text('h1'));
    expect(seen).toEqual(['agent-a', 'agent-b', 'agent-a']);
    expect((await wraith.fetch(`${server.url}/ua`, { headers: { 'User-Agent': 'mine' } })).text('h1')).toBe('mine');
    await wraith.close();
  });

  it('keeps one user agent per proxy', async () => {
    const port = Number(new URL(server.url).port);
    const proxies = [await startHttpProxy(port), await startHttpProxy(port)];
    const wraith = createWraith({ ...quiet, proxy: proxies.map((p) => p.url), userAgent: ['agent-a', 'agent-b', 'agent-c'] });
    try {
      const seen = [];
      for (let i = 0; i < 4; i++) seen.push((await wraith.fetch('http://wraith.test/ua')).text('h1'));
      // Requests alternate between the two proxies, and each proxy keeps its agent.
      expect(seen).toEqual(['agent-a', 'agent-b', 'agent-a', 'agent-b']);
    } finally {
      await wraith.close();
      await Promise.all(proxies.map((p) => p.close()));
    }
  });

  it('names the crawler in robots.txt when it is a single string', async () => {
    const bot = createWraith({ ...quiet, network: { rateLimit: false, respectRobotsTxt: true }, userAgent: 'mybot' });
    await expect(bot.fetch(`${server.url}/ua`)).rejects.toThrow(RobotsDisallowedError);
    const rotating = createWraith({ ...quiet, network: { rateLimit: false, respectRobotsTxt: true }, userAgent: 'rotate' });
    expect((await rotating.fetch(`${server.url}/ua`)).text('h1')).toMatch(/^Mozilla\/5\.0/);
    await bot.close();
    await rotating.close();
  });
});

describe('userAgent for browser pages', () => {
  it('gives each instance the next one', async () => {
    const wraith = createWraith({ ...quiet, instances: 2, userAgent: ['agent-a', 'agent-b'] });
    try {
      const [a, b] = await Promise.all([wraith.open(`${server.url}/ua`), wraith.open(`${server.url}/ua`)]);
      expect([await a!.text('h1'), await b!.text('h1')]).toEqual(['agent-a', 'agent-b']);
      expect(await b!.raw.evaluate(() => navigator.userAgent)).toBe('agent-b');
    } finally {
      await wraith.close();
    }
  });

  it("with 'rotate', uses agents of the browser's own engine", async () => {
    const wraith = createWraith({ ...quiet, userAgent: 'rotate' });
    try {
      const page = await wraith.open(`${server.url}/ua`);
      const agent = await page.text('h1');
      expect(builtInUserAgents('chromium')).toContain(agent);
      expect(agent).not.toMatch(/Headless/);
    } finally {
      await wraith.close();
    }
  });

  it('checks its settings', () => {
    expect(() => createWraith({ userAgent: [] })).toThrow(WraithError);
    expect(() => createWraith({ userAgent: 'a', context: { userAgent: 'b' } })).toThrow(/not both/);
    expect(() => createWraith({ userAgent: 'a', network: { userAgent: 'b' } })).toThrow(/not both/);
  });
});
