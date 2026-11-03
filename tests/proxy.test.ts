import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WraithError } from '../src/errors.js';
import { bypassesProxy, resolveProxies } from '../src/net/proxy.js';
import { createWraith } from '../src/wraith.js';
import { startHttpProxy, startSocksProxy, type TestProxy } from './helpers/proxy.js';
import { startServer, type TestServer } from './helpers/server.js';

// Pages are requested from a host that doesn't exist, so they can only arrive through a proxy.
const SITE = 'http://wraith.test';
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

let origin: TestServer;
const proxies: TestProxy[] = [];

beforeAll(async () => {
  origin = await startServer({
    '/': '<title>Origin</title><h1>Hello through a proxy</h1>',
    '/robots.txt': (_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow: /private'),
  });
});

afterAll(async () => {
  await Promise.all(proxies.map((proxy) => proxy.close()));
  await origin?.close();
});

async function httpProxy(auth?: string) {
  const proxy = await startHttpProxy(Number(new URL(origin.url).port), auth);
  proxies.push(proxy);
  return proxy;
}

async function socksProxy(user?: { username: string; password: string }) {
  const proxy = await startSocksProxy(Number(new URL(origin.url).port), user);
  proxies.push(proxy);
  return proxy;
}

describe('proxy settings', () => {
  it('reads URLs, credentials and settings objects', () => {
    expect(resolveProxies('http://me:p%40ss@proxy.example.com:8080')).toEqual([
      { server: 'http://proxy.example.com:8080', username: 'me', password: 'p@ss' },
    ]);
    expect(resolveProxies('proxy.example.com:3128')).toEqual([{ server: 'http://proxy.example.com:3128' }]);
    expect(resolveProxies([{ server: 'socks5://127.0.0.1:1080', username: 'u', password: 'p', bypass: 'localhost' }, 'https://p2:443'])).toEqual([
      { server: 'socks5://127.0.0.1:1080', username: 'u', password: 'p', bypass: 'localhost' },
      { server: 'https://p2:443' },
    ]);
    expect(resolveProxies(undefined)).toEqual([]);
  });

  it('rejects what it cannot use, without echoing passwords', () => {
    expect(() => resolveProxies('ftp://proxy:21')).toThrow(/ftp proxies aren't supported/);
    expect(() => resolveProxies([])).toThrow(WraithError);
    expect(() => resolveProxies({ server: '' })).toThrow(/needs a server/);
    expect(() => resolveProxies('http://me:secret@[bad')).toThrow(/http:\/\/\*\*\*@\[bad/);
    expect(() => createWraith({ proxy: 'http://p:1', context: { proxy: { server: 'http://q:1' } } })).toThrow(/not both/);
  });

  it('matches bypass rules like browsers do', () => {
    const proxy = { server: 'http://p:1', bypass: 'localhost, .internal.example.com, *.corp.example, <local>' };
    expect(bypassesProxy(proxy, 'http://localhost:3000/')).toBe(true);
    expect(bypassesProxy(proxy, 'https://api.internal.example.com/')).toBe(true);
    expect(bypassesProxy(proxy, 'https://wiki.corp.example/')).toBe(true);
    expect(bypassesProxy(proxy, 'http://intranet/')).toBe(true);
    expect(bypassesProxy(proxy, 'https://example.com/')).toBe(false);
  });
});

describe('static fetches through a proxy', () => {
  it('go through an HTTP proxy, with its login', async () => {
    const proxy = await httpProxy(basic('me', 'p@ss'));
    const wraith = createWraith({ network: { rateLimit: false }, proxy: 'http://me:p%40ss@127.0.0.1:' + new URL(proxy.url).port });
    try {
      const page = await wraith.fetch(`${SITE}/`);
      expect(page.extract({ h1: 'h1' }).h1).toBe('Hello through a proxy');
      expect(proxy.seen).toEqual(['wraith.test:80']);
      expect(proxy.credentials).toEqual([basic('me', 'p@ss')]);
    } finally {
      await wraith.close();
    }
  });

  it('go through a SOCKS5 proxy, with its login', async () => {
    const proxy = await socksProxy({ username: 'me', password: 'secret' });
    const wraith = createWraith({ network: { rateLimit: false }, proxy: { server: proxy.url, username: 'me', password: 'secret' } });
    try {
      const page = await wraith.fetch(`${SITE}/`);
      expect(page.text('h1')).toBe('Hello through a proxy');
      expect(proxy.seen).toEqual(['wraith.test:80']);
      expect(proxy.credentials).toEqual(['me:secret']);
    } finally {
      await wraith.close();
    }
  });

  it('rotate through a list of proxies, robots.txt included', async () => {
    const list = [await httpProxy(), await httpProxy(), await httpProxy()];
    const pagesBefore = origin.hits.get('/') ?? 0;
    const wraith = createWraith({ network: { rateLimit: false, respectRobotsTxt: true }, proxy: list.map((p) => p.url) });
    try {
      for (let i = 0; i < 3; i++) await wraith.fetch(`${SITE}/`);
      await expect(wraith.fetch(`${SITE}/private`)).rejects.toThrow(/robots\.txt/);
      // robots.txt, then three pages, taking the proxies in turn (the first one's tunnel is reused
      // for the third page, so each proxy sees one connection).
      expect(list.map((p) => p.seen)).toEqual([['wraith.test:80'], ['wraith.test:80'], ['wraith.test:80']]);
      expect((origin.hits.get('/') ?? 0) - pagesBefore).toBe(3);
      expect(origin.hits.get('/robots.txt')).toBe(1);
    } finally {
      await wraith.close();
    }
  });

  it('skip the proxy for bypassed hosts', async () => {
    const proxy = await httpProxy();
    const wraith = createWraith({ network: { rateLimit: false }, proxy: { server: proxy.url, bypass: '127.0.0.1' } });
    try {
      expect((await wraith.fetch(`${origin.url}/`)).ok).toBe(true);
      expect(proxy.seen).toEqual([]);
    } finally {
      await wraith.close();
    }
  });
});

describe('browser pages through a proxy', () => {
  it('use an HTTP proxy, logging in when it asks', async () => {
    const proxy = await httpProxy(basic('me', 'secret'));
    const wraith = createWraith({ human: 'off', network: { rateLimit: false }, proxy: proxy.url.replace('//', '//me:secret@') });
    try {
      const page = await wraith.open(`${SITE}/`);
      expect(await page.text('h1')).toBe('Hello through a proxy');
      expect(proxy.seen).toContain('wraith.test');
      expect(proxy.credentials).toContain(basic('me', 'secret'));
    } finally {
      await wraith.close();
    }
  });

  it('use a SOCKS5 proxy', async () => {
    const proxy = await socksProxy();
    const wraith = createWraith({ human: 'off', network: { rateLimit: false }, proxy: proxy.url });
    try {
      const page = await wraith.open(`${SITE}/`);
      expect(await page.title()).toBe('Origin');
      expect(proxy.seen).toContain('wraith.test:80');
    } finally {
      await wraith.close();
    }
  });

  it('explain that browsers cannot log in to SOCKS proxies', async () => {
    const wraith = createWraith({ proxy: 'socks5://me:secret@127.0.0.1:1' });
    try {
      await expect(wraith.newPage()).rejects.toThrow(/can't log in to SOCKS proxies \(socks5:\/\/127\.0\.0\.1:1\)/);
    } finally {
      await wraith.close();
    }
  });
});
