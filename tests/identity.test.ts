import type { IncomingHttpHeaders } from 'node:http';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browserHeaders, chromiumBrands, parseUserAgent } from '../src/net/identity.js';
import { builtInUserAgents } from '../src/net/user-agents.js';
import { createWraith, type Wraith } from '../src/wraith.js';
import { startHttpProxy } from './helpers/proxy.js';
import { json, startServer, type TestServer } from './helpers/server.js';

const chrome = (version: number, platform = 'Windows NT 10.0; Win64; x64') =>
  `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

let server: TestServer;
/** Request headers the server saw, per path. */
const seen = new Map<string, IncomingHttpHeaders>();

beforeAll(async () => {
  server = await startServer({
    '/echo': (req, res) => json(res, 200, req.headers),
    '/page': (req, res) => {
      seen.set('/page', req.headers);
      res.writeHead(200, { 'content-type': 'text/html' }).end('<a id="pop" target="_blank" href="/popup">open</a>');
    },
    '/popup': '<p>popup</p>',
  });
});

afterAll(() => server?.close());

const quiet = { human: 'off', network: { rateLimit: false } } as const;

describe('parseUserAgent', () => {
  it('reads browser, version, system and form factor', () => {
    expect(parseUserAgent(chrome(131))).toEqual({ family: 'chrome', major: '131', os: 'Windows', mobile: false });
    expect(parseUserAgent(chrome(131, 'Macintosh; Intel Mac OS X 10_15_7'))?.os).toBe('macOS');
    expect(parseUserAgent(chrome(131, 'X11; Linux x86_64'))?.os).toBe('Linux');
    expect(parseUserAgent(`${chrome(131)} Edg/131.0.0.0`)).toMatchObject({ family: 'edge', major: '131' });
    expect(parseUserAgent(FIREFOX)).toEqual({ family: 'firefox', major: '133', os: 'Windows', mobile: false });
    expect(parseUserAgent(SAFARI)).toEqual({ family: 'safari', major: '18', os: 'macOS', mobile: false });
    expect(
      parseUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'),
    ).toEqual({ family: 'chrome', major: '131', os: 'Android', mobile: true });
    expect(
      parseUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ family: 'safari', major: '18', os: 'iOS', mobile: true });
  });

  it('leaves bots, headless browsers and unmodelled browsers alone', () => {
    expect(parseUserAgent('mybot/1.0 (+https://example.com/bot)')).toBeNull();
    expect(parseUserAgent('curl/8.5.0')).toBeNull();
    expect(parseUserAgent(chrome(131).replace('Chrome/', 'HeadlessChrome/'))).toBeNull();
    expect(parseUserAgent(`${chrome(131)} OPR/116.0.0.0`)).toBeNull();
  });

  it('understands every built-in user agent', () => {
    for (const agent of builtInUserAgents()) expect(parseUserAgent(agent), agent).not.toBeNull();
  });
});

describe('client hint brands', () => {
  // Real sec-ch-ua headers from Chrome on Windows.
  it.each([
    [120, '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"'],
    [124, '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"'],
    [131, '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'],
  ])('match what Chrome %i sends', (version, header) => {
    expect(browserHeaders(chrome(version), 'https://example.com/')?.['sec-ch-ua']).toBe(header);
  });

  it("match the installed browser's own list", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      // userAgentData only exists in secure contexts; loopback is one.
      await page.goto(`${server.url}/popup`);
      const own = await page.evaluate(() => (navigator as unknown as { userAgentData: { brands: { brand: string; version: string }[] } }).userAgentData.brands);
      const major = browser.version().split('.')[0]!;
      // Headless Chromium names itself HeadlessChrome where Chrome says Google Chrome.
      const expected = own.map((b) => (b.brand === 'HeadlessChrome' ? { ...b, brand: 'Google Chrome' } : b));
      expect(chromiumBrands(major, 'Google Chrome').brands).toEqual(expected);
    } finally {
      await browser.close();
    }
  });
});

describe('browserHeaders', () => {
  it("are Chrome's navigation headers, with client hints over HTTPS", () => {
    expect(browserHeaders(chrome(131), 'https://example.com/')).toEqual({
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'upgrade-insecure-requests': '1',
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-user': '?1',
      'sec-fetch-dest': 'document',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'en-US,en;q=0.9',
    });
  });

  it('leave out client hints and Sec-Fetch-* over plain HTTP, as browsers do', () => {
    const headers = browserHeaders(chrome(131), 'http://example.com/')!;
    expect(Object.keys(headers).filter((name) => name.startsWith('sec-'))).toEqual([]);
    expect(headers['accept-encoding']).toBe('gzip, deflate');
    // Loopback counts as secure.
    expect(browserHeaders(chrome(131), 'http://127.0.0.1:8080/')?.['sec-ch-ua']).toBeDefined();
  });

  it('follow the browser family and locale', () => {
    const firefox = browserHeaders(FIREFOX, 'https://example.com/', { locale: 'de-DE' })!;
    expect(firefox['sec-ch-ua']).toBeUndefined();
    expect(firefox['accept-language']).toBe('de-DE,de;q=0.5');
    expect(firefox.accept).toBe('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    const safari = browserHeaders(SAFARI, 'https://example.com/')!;
    expect(safari['sec-fetch-user']).toBeUndefined();
    expect(safari['upgrade-insecure-requests']).toBeUndefined();
    expect(safari['accept-language']).toBe('en-US,en;q=0.9');
    expect(browserHeaders(chrome(131), 'https://example.com/', { locale: 'fr' })?.['accept-language']).toBe('fr');
  });

  it("aren't navigation headers for other methods", () => {
    expect(Object.keys(browserHeaders(chrome(131), 'https://example.com/api', { method: 'POST' })!)).toEqual([
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'accept-language',
    ]);
  });

  it('are null for user agents that are not browsers', () => {
    expect(browserHeaders('mybot/1.0', 'https://example.com/')).toBeNull();
  });
});

describe('static fetches', () => {
  const echo = async (wraith: Wraith, init?: Parameters<Wraith['fetch']>[1], url = `${server.url}/echo`) => {
    try {
      return (await wraith.fetch(url, init)).json<Record<string, string>>();
    } finally {
      await wraith.close();
    }
  };

  it("send the user agent's browser headers", async () => {
    const headers = await echo(createWraith({ ...quiet, userAgent: chrome(131) }));
    expect(headers['sec-ch-ua']).toContain('"Google Chrome";v="131"');
    expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
    expect(headers['sec-fetch-mode']).toBe('navigate');
    expect(headers['accept-language']).toBe('en-US,en;q=0.9');
  });

  it("keep headers you set, and use the context's locale", async () => {
    const headers = await echo(createWraith({ ...quiet, userAgent: chrome(131), context: { locale: 'fr-FR' } }), {
      headers: { Accept: 'application/json' },
    });
    expect(headers.accept).toBe('application/json');
    expect(headers['accept-language']).toBe('fr-FR,fr;q=0.9');
  });

  it('send nothing extra with browserHeaders: false, or a bot user agent', async () => {
    for (const wraith of [
      createWraith({ ...quiet, userAgent: chrome(131), network: { rateLimit: false, browserHeaders: false } }),
      createWraith({ ...quiet, userAgent: 'mybot/1.0' }),
    ]) {
      const headers = await echo(wraith);
      expect(headers['sec-ch-ua']).toBeUndefined();
      expect(headers['sec-fetch-dest']).toBeUndefined();
      // Node's fetch sends its own defaults.
      expect(headers['accept-language']).toBe('*');
      expect(headers['sec-fetch-mode']).toBe('cors');
    }
  });

  it('match the URL each request goes to, through proxies too', async () => {
    const proxy = await startHttpProxy(Number(new URL(server.url).port));
    try {
      const headers = await echo(createWraith({ ...quiet, proxy: proxy.url, userAgent: chrome(131) }), {}, 'http://wraith.test/echo');
      expect(headers['sec-ch-ua']).toBeUndefined();
      expect(headers['sec-fetch-mode']).toBeUndefined();
      expect(headers['accept-language']).toBe('en-US,en;q=0.9');
    } finally {
      await proxy.close();
    }
  });
});

describe('browser pages', () => {
  type Seen = {
    platform: string;
    languages: readonly string[];
    webdriver: boolean;
    locale: string;
    brands: string[];
    hintPlatform: string;
    fullVersions: Record<string, string>;
  };
  const look = (page: import('playwright').Page) =>
    page.evaluate(async (): Promise<Seen> => {
      const data = (navigator as unknown as { userAgentData: any }).userAgentData;
      const high = await data.getHighEntropyValues(['fullVersionList']);
      return {
        platform: navigator.platform,
        languages: navigator.languages,
        webdriver: navigator.webdriver,
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        brands: data.brands.map((b: { brand: string }) => b.brand),
        hintPlatform: data.platform,
        fullVersions: Object.fromEntries(high.fullVersionList.map((b: { brand: string; version: string }) => [b.brand, b.version])),
      };
    });

  it('present the user agent consistently: client hints, platform and languages', async () => {
    const agent = builtInUserAgents('chromium').find((a) => a.includes('Windows'))!;
    const wraith = createWraith({ ...quiet, userAgent: agent });
    try {
      const page = await wraith.open(`${server.url}/page`);
      const headers = seen.get('/page')!;
      expect(headers['user-agent']).toBe(agent);
      expect(headers['sec-ch-ua']).toContain('"Google Chrome"');
      expect(headers['sec-ch-ua']).not.toContain('Headless');
      expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
      expect(headers['accept-language']).toBe('en-US,en;q=0.9');

      const browserVersion = (await wraith.context()).browser()!.version();
      const view = await look(page.raw);
      expect(view).toMatchObject({ platform: 'Win32', languages: ['en-US', 'en'], locale: 'en-US', hintPlatform: 'Windows' });
      expect(view.brands).toContain('Google Chrome');
      expect(view.fullVersions['Google Chrome']).toBe(browserVersion);
      // It doesn't hide that the browser is automated.
      expect(view.webdriver).toBe(true);
    } finally {
      await wraith.close();
    }
  });

  it('use context.userAgent and context.locale too, and name Edge for Edge', async () => {
    const mac = chrome(150, 'Macintosh; Intel Mac OS X 10_15_7');
    const wraith = createWraith({ ...quiet, context: { userAgent: `${mac} Edg/150.0.0.0`, locale: 'de-DE' } });
    try {
      const page = await wraith.open(`${server.url}/page`);
      expect(seen.get('/page')!['accept-language']).toBe('de-DE,de;q=0.9');
      const view = await look(page.raw);
      expect(view).toMatchObject({ platform: 'MacIntel', languages: ['de-DE', 'de'], hintPlatform: 'macOS' });
      expect(view.brands).toContain('Microsoft Edge');
      expect(view.fullVersions['Microsoft Edge']).toBe('150.0.0.0');
    } finally {
      await wraith.close();
    }
  });

  it('give each instance its own identity, popups included', async () => {
    const [windows, linux] = [chrome(150), chrome(150, 'X11; Linux x86_64')];
    const wraith = createWraith({ ...quiet, instances: 2, userAgent: [windows, linux] });
    try {
      const [a, b] = await Promise.all([wraith.open(`${server.url}/page`), wraith.open(`${server.url}/page`)]);
      expect((await look(a!.raw)).platform).toBe('Win32');
      expect((await look(b!.raw)).hintPlatform).toBe('Linux');
      const [popup] = await Promise.all([a!.raw.context().waitForEvent('page'), a!.raw.click('#pop')]);
      await popup.waitForLoadState();
      await expect.poll(async () => (await look(popup)).platform).toBe('Win32');
    } finally {
      await wraith.close();
    }
  });
});
