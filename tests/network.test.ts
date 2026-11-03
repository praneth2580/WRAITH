import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError, RobotsDisallowedError } from '../src/errors.js';
import { createWraith } from '../src/wraith.js';
import { startServer, type TestServer } from './helpers/server.js';

let server: TestServer;
let flaky = 0;

beforeAll(async () => {
  server = await startServer({
    '/robots.txt': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /private\n');
    },
    '/public': '<h1>public</h1>',
    '/private': '<h1>private</h1>',
    '/flaky': (_req, res) => {
      flaky++;
      res.writeHead(flaky === 1 ? 503 : 200, { 'content-type': 'text/html' });
      res.end(flaky === 1 ? 'busy' : '<h1>ok</h1>');
    },
    '/down': (_req, res) => {
      res.writeHead(503);
      res.end('down');
    },
    '/fast': '<p>fast</p>',
    '/': '<a href="/a">a</a> <a href="/b">b</a> <a href="https://elsewhere.example/">out</a>',
    '/a': '<h1>A</h1><a href="/c">c</a>',
    '/b': '<h1>B</h1><a href="/">home</a>',
    '/c': '<h1>C</h1>',
  });
});

afterAll(() => server.close());

describe('wraith.fetch', () => {
  it('retries 5xx responses and then succeeds', async () => {
    const wraith = createWraith({ network: { retries: 1, rateLimit: false } });
    const page = await wraith.fetch(`${server.url}/flaky`);
    expect(page.status).toBe(200);
    expect(page.text('h1')).toBe('ok');
    expect(server.hits.get('/flaky')).toBe(2);
  });

  it('throws HttpError once retries run out', async () => {
    const wraith = createWraith({ network: { retries: 1, rateLimit: false } });
    await expect(wraith.fetch(`${server.url}/down`)).rejects.toBeInstanceOf(HttpError);
    expect(server.hits.get('/down')).toBe(2);
  });

  it('returns 4xx pages without retrying', async () => {
    const wraith = createWraith({ network: { rateLimit: false } });
    const page = await wraith.fetch(`${server.url}/missing`);
    expect(page.status).toBe(404);
    expect(page.ok).toBe(false);
    expect(server.hits.get('/missing')).toBe(1);
  });

  it('respects robots.txt when asked to', async () => {
    const polite = createWraith({ network: { respectRobotsTxt: true, rateLimit: false } });
    await expect(polite.fetch(`${server.url}/private`)).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect((await polite.fetch(`${server.url}/public`)).status).toBe(200);
    // Off by default.
    expect((await createWraith().fetch(`${server.url}/private`)).status).toBe(200);
  });

  it('spreads requests to one host over time', async () => {
    const wraith = createWraith({ network: { rateLimit: { concurrency: 6, maxRequests: 2, intervalMs: 400 } } });
    const started = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => wraith.fetch(`${server.url}/fast`)));
    // 2 now, 2 after 400 ms, 2 after 800 ms.
    expect(Date.now() - started).toBeGreaterThanOrEqual(750);
  });
});

describe('static crawl', () => {
  it('follows same-origin links up to maxDepth', async () => {
    const wraith = createWraith({ network: { rateLimit: false } });
    const { results, errors } = await wraith.crawl({
      mode: 'static',
      start: `${server.url}/`,
      maxDepth: 1,
      handler: ({ page }) => page.extract({ heading: 'h1' }).heading ?? 'home',
    });
    expect(errors).toEqual([]);
    expect(results.map((r) => r.data).sort()).toEqual(['A', 'B', 'home']);
  });

  it('stops at maxPages and records failures without stopping', async () => {
    const wraith = createWraith({ network: { rateLimit: false, retries: 0 } });
    const { results, errors } = await wraith.crawl({
      mode: 'static',
      start: [`${server.url}/`, `${server.url}/down`],
      maxPages: 3,
      handler: ({ url }) => url,
    });
    expect(results.length + errors.length).toBe(3);
    expect(errors.map((e) => e.url)).toEqual([`${server.url}/down`]);
  });
});
