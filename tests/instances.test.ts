import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WraithError } from '../src/errors.js';
import { createWraith } from '../src/wraith.js';
import { startHttpProxy, type TestProxy } from './helpers/proxy.js';
import { startServer, type TestServer } from './helpers/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await startServer({
    '/': '<title>Home</title><h1>Home</h1>',
    '/login': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'session=abc; Path=/' });
      res.end('<h1>Logged in</h1>');
    },
    '/whoami': (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<h1>${req.headers.cookie ?? 'nobody'}</h1>`);
    },
  });
});

afterAll(() => server?.close());

const quiet = { human: 'off', network: { rateLimit: false } } as const;

describe('instances', () => {
  it('are independent sessions with their own cookies', async () => {
    const wraith = createWraith({ ...quiet, instances: 2 });
    try {
      const a = await wraith.open(`${server.url}/login`, { instance: 0 });
      await a.goto(`${server.url}/whoami`);
      const b = await wraith.open(`${server.url}/whoami`, { instance: 1 });
      expect([a.instance, b.instance]).toEqual([0, 1]);
      expect(await a.text('h1')).toBe('session=abc');
      expect(await b.text('h1')).toBe('nobody');
    } finally {
      await wraith.close();
    }
  });

  it('take new pages in turn, then whichever is least busy', async () => {
    const wraith = createWraith({ ...quiet, instances: 3 });
    try {
      const pages = await Promise.all([wraith.newPage(), wraith.newPage(), wraith.newPage(), wraith.newPage()]);
      expect(pages.map((p) => p.instance)).toEqual([0, 1, 2, 0]);
      await pages[1]!.close();
      expect((await wraith.newPage()).instance).toBe(1);
    } finally {
      await wraith.close();
    }
  });

  it('share one browser by default, or get their own', async () => {
    const shared = createWraith({ ...quiet, instances: 2 });
    const separate = createWraith({ ...quiet, instances: { count: 2, separateBrowsers: true } });
    try {
      expect((await shared.context(0)).browser()).toBe((await shared.context(1)).browser());
      expect((await separate.context(0)).browser()).not.toBe((await separate.context(1)).browser());
    } finally {
      await shared.close();
      await separate.close();
    }
  });

  it('each use the next proxy, one instance per proxy by default', async () => {
    const port = Number(new URL(server.url).port);
    const proxies: TestProxy[] = [await startHttpProxy(port), await startHttpProxy(port)];
    const wraith = createWraith({ ...quiet, proxy: proxies.map((p) => p.url) });
    try {
      expect(wraith.instanceCount).toBe(2);
      const [a, b] = await Promise.all([wraith.open('http://wraith.test/'), wraith.open('http://wraith.test/')]);
      expect([a!.instance, b!.instance]).toEqual([0, 1]);
      expect(proxies[0]!.seen).toEqual(['wraith.test']);
      expect(proxies[1]!.seen).toEqual(['wraith.test']);
    } finally {
      await wraith.close();
      await Promise.all(proxies.map((p) => p.close()));
    }
  });

  it('start a fresh session when one is closed under them', async () => {
    const wraith = createWraith({ ...quiet });
    try {
      await (await wraith.context()).close();
      const page = await wraith.open(`${server.url}/`);
      expect(await page.title()).toBe('Home');
    } finally {
      await wraith.close();
    }
  });

  it('check their settings', async () => {
    expect(() => createWraith({ instances: 0 })).toThrow(/instances must be a whole number >= 1/);
    expect(() => createWraith({ instances: { count: 1.5 } })).toThrow(WraithError);
    expect(() => createWraith({ browser: 'netscape' as 'chromium' })).toThrow(/Unknown browser/);
    const wraith = createWraith({ instances: 2 });
    await expect(wraith.newPage({ instance: 2 })).rejects.toThrow(/from 0 to 1, not 2/);
    await expect(wraith.context(-1)).rejects.toThrow(WraithError);
    await wraith.close();
  });
});
