import type { ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectBlock } from '../src/blocks.js';
import { BlockedError } from '../src/errors.js';
import { createWraith } from '../src/wraith.js';
import { startServer, type TestServer } from './helpers/server.js';

const check = (status: number, headers: Record<string, string>, body = '') => detectBlock({ url: 'https://example.com/', status, headers, body });

describe('detectBlock', () => {
  it.each([
    ['Cloudflare challenge header', 403, { 'cf-mitigated': 'challenge', server: 'cloudflare' }, '<title>Just a moment...</title>', 'cloudflare', 'challenge'],
    ['Cloudflare challenge page', 503, { server: 'cloudflare' }, '<script>window._cf_chl_opt = {}</script>', 'cloudflare', 'challenge'],
    ['Cloudflare 1020', 403, { 'cf-ray': '8f1b2c3d4e5f6a7b-BOM' }, 'error code: 1020', 'cloudflare', 'block'],
    [
      'Akamai Access Denied',
      403,
      { server: 'AkamaiGHost' },
      '<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>Reference&#32;&#35;18&#46;a1b2c3d4</BODY></HTML>',
      'akamai',
      'block',
    ],
    ['Akamai sec-cpt', 428, {}, '<div id="sec-if-cpt-container"></div>', 'akamai', 'challenge'],
    ['DataDome CAPTCHA', 403, { 'x-datadome': 'protected' }, "<script>var dd={'rt':'c','host':'geo.captcha-delivery.com'}</script>", 'datadome', 'challenge'],
    ['DataDome ban', 403, { 'x-datadome': 'protected' }, "<script>var dd={'rt':'c','t':'bv','host':'geo.captcha-delivery.com'}</script>", 'datadome', 'block'],
    ['HUMAN Press & Hold', 403, {}, '<div id="px-captcha"></div><script>window._pxAppId = "PXabc";</script>', 'perimeterx', 'challenge'],
    ['Kasada', 429, { 'x-kpsdk-ct': 'token' }, '', 'kasada', 'challenge'],
    ['Imperva incident', 200, {}, '<p>Request unsuccessful. Incapsula incident ID: 123-456</p>', 'imperva', 'block'],
    [
      'Imperva challenge',
      200,
      {},
      '<html><head><META NAME="robots" CONTENT="noindex,nofollow"><script src="/_Incapsula_Resource?SWJIYLWA=abc"></script></head></html>',
      'imperva',
      'challenge',
    ],
    ['AWS WAF CAPTCHA', 405, { 'x-amzn-waf-action': 'captcha' }, '', 'aws-waf', 'challenge'],
    ['F5', 200, {}, 'The requested URL was rejected. Please consult with your administrator.<br>Your support ID is: 123', 'f5', 'block'],
    ['Sucuri', 403, { 'x-sucuri-block': 'yes' }, '', 'sucuri', 'block'],
    ['Vercel', 403, { 'x-vercel-mitigated': 'challenge' }, '', 'vercel', 'challenge'],
    ['Anubis', 200, {}, '<script id="anubis_challenge" type="application/json">{}</script>', 'anubis', 'challenge'],
  ])('recognises %s', (_name, status, headers, body, vendor, kind) => {
    expect(check(status, headers, body)).toMatchObject({ vendor, kind, status, url: 'https://example.com/' });
  });

  it.each([
    // Protected sites add these services' scripts to ordinary pages.
    ['an ordinary Cloudflare page', 200, { server: 'cloudflare' }, '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><h1>Hi</h1>'],
    ['a page with DataDome and HUMAN scripts', 200, { 'x-datadome': 'protected' }, '<script src="https://client.px-cloud.net/x.js"></script>'],
    ['a Cloudflare origin error', 521, { server: 'cloudflare' }, '<div id="cf-error-details">Web server is down</div>'],
    ['a plain 403', 403, {}, '<h1>Forbidden</h1>'],
    ['a plain 429', 429, { 'retry-after': '10' }, 'Too many requests'],
  ])('ignores %s', (_name, status, headers, body) => {
    expect(check(status, headers, body)).toBeNull();
  });
});

let server: TestServer;

const send = (res: ServerResponse, status: number, headers: Record<string, string>, body: string) =>
  res.writeHead(status, { 'content-type': 'text/html', ...headers }).end(body);

beforeAll(async () => {
  server = await startServer({
    '/ok': '<h1>Hello</h1>',
    '/denied': (_req, res) =>
      send(res, 403, { server: 'AkamaiGHost' }, '<html><head><title>Access Denied</title></head><body>Reference #18.a1b2c3d4.1730000000.abc</body></html>'),
    // A browser check that a real browser passes by itself: it sets a cookie and reloads.
    '/check': (req, res) => {
      if (/passed=1/.test(req.headers.cookie ?? '')) return send(res, 200, {}, '<h1>Welcome</h1>');
      send(
        res,
        403,
        { server: 'cloudflare', 'cf-mitigated': 'challenge' },
        `<title>Just a moment...</title><script>setTimeout(() => { document.cookie = 'passed=1; path=/'; location.reload(); }, 500)</script>`,
      );
    },
    // One that never clears, with a status that would otherwise be retried.
    '/stuck': (_req, res) => send(res, 503, { server: 'cloudflare' }, '<title>Just a moment...</title><script>window._cf_chl_opt = {}</script>'),
    '/datadome': `<iframe src="/captcha-delivery.com/captcha" width="320" height="400"></iframe>`,
    '/press-and-hold': `<div id="px-captcha" style="width: 300px; height: 100px"></div>`,
  });
});

afterAll(() => server?.close());

const quiet = { human: 'off', network: { rateLimit: false } } as const;

describe('static fetches', () => {
  it('throw BlockedError for a block page, without retrying', async () => {
    const wraith = createWraith(quiet);
    const before = server.hits.get('/stuck') ?? 0;
    const error = await wraith.fetch(`${server.url}/stuck`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedError);
    expect(error).toMatchObject({ vendor: 'cloudflare', kind: 'challenge', status: 503 });
    expect((error as Error).message).toMatch(/static fetch can't take part/);
    expect(server.hits.get('/stuck')! - before).toBe(1);
    await expect(wraith.fetch(`${server.url}/denied`)).rejects.toMatchObject({ vendor: 'akamai', kind: 'block' });
  });

  it("return the page with onBlock: 'return'", async () => {
    const wraith = createWraith({ ...quiet, network: { rateLimit: false, onBlock: 'return' } });
    const page = await wraith.fetch(`${server.url}/denied`);
    expect(page.status).toBe(403);
    expect(page.blocked).toMatchObject({ vendor: 'akamai', kind: 'block', evidence: 'Akamai "Access Denied" page' });
    expect((await wraith.fetch(`${server.url}/ok`)).blocked).toBeNull();
  });

  it('check the option', () => {
    expect(() => createWraith({ network: { onBlock: 'retry' as never } })).toThrow(/onBlock/);
  });
});

describe('browser pages', () => {
  it('throw BlockedError for a block page straight away', async () => {
    const wraith = createWraith(quiet);
    try {
      const started = Date.now();
      await expect(wraith.open(`${server.url}/denied`)).rejects.toMatchObject({ name: 'BlockedError', vendor: 'akamai', kind: 'block' });
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await wraith.close();
    }
  });

  it('let a browser check clear by itself', async () => {
    const wraith = createWraith(quiet);
    try {
      const page = await wraith.newPage();
      const response = await page.goto(`${server.url}/check`);
      expect(await page.text('h1')).toBe('Welcome');
      expect(response?.status()).toBe(200);
      expect(await page.blocked()).toBeNull();
    } finally {
      await wraith.close();
    }
  });

  it("give up on a check that doesn't clear, without retrying it", async () => {
    const wraith = createWraith({ ...quiet, network: { rateLimit: false, timeout: 2000 } });
    const before = server.hits.get('/stuck') ?? 0;
    try {
      const error = await wraith.open(`${server.url}/stuck`).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BlockedError);
      expect((error as Error).message).toMatch(/still there after 2 s/);
      expect(server.hits.get('/stuck')! - before).toBe(1);
    } finally {
      await wraith.close();
    }
  });

  it("report blocks with onBlock: 'return'", async () => {
    const wraith = createWraith({ ...quiet, network: { rateLimit: false, onBlock: 'return' } });
    try {
      const page = await wraith.open(`${server.url}/denied`);
      expect(await page.blocked()).toMatchObject({ vendor: 'akamai', kind: 'block', status: 403 });
      await page.goto(`${server.url}/ok`);
      expect(await page.blocked()).toBeNull();
    } finally {
      await wraith.close();
    }
  });

  it('hand DataDome and HUMAN CAPTCHAs to a person', async () => {
    const wraith = createWraith(quiet);
    try {
      const page = await wraith.open(`${server.url}/datadome`);
      expect(await page.detectChallenge()).toMatchObject({ kind: 'captcha', provider: 'datadome', answerable: false });
      await page.goto(`${server.url}/press-and-hold`);
      expect(await page.detectChallenge()).toMatchObject({ kind: 'captcha', provider: 'perimeterx', answerable: false });
    } finally {
      await wraith.close();
    }
  });
});
