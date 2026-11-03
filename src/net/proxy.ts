import { ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { WraithError } from '../errors.js';

/** A proxy server, in the shape Playwright uses. */
export interface ProxySettings {
  /** `http://host:port`, `https://host:port` or `socks5://host:port`. `host:port` alone means HTTP. */
  server: string;
  username?: string;
  password?: string;
  /**
   * Comma-separated hosts that skip the proxy: `'localhost, .internal.example.com'`. A leading dot
   * (or `*.`) matches subdomains, and `<local>` matches hosts without a dot.
   */
  bypass?: string;
}

/**
 * A proxy URL such as `'http://user:pass@proxy.example.com:8080'` or `'socks5://127.0.0.1:1080'`,
 * proxy settings, or a list of either to spread work across.
 */
export type ProxyOption = string | ProxySettings | readonly (string | ProxySettings)[];

const SCHEMES = new Set(['http:', 'https:', 'socks5:']);
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443', 'socks5:': '1080' };

/** Hides the password in a proxy URL, for error messages and logs. */
export function redactProxy(server: string): string {
  return server.replace(/\/\/[^/@]*@/, '//***@');
}

/** Turns the `proxy` option into a list of normalised settings (empty when there's no proxy). */
export function resolveProxies(option: ProxyOption | undefined): ProxySettings[] {
  if (option === undefined) return [];
  const list = Array.isArray(option) ? option : [option as string | ProxySettings];
  if (list.length === 0) throw new WraithError('proxy: give at least one proxy, or leave the option out');
  return list.map(toSettings);
}

function toSettings(entry: string | ProxySettings): ProxySettings {
  const given: ProxySettings = typeof entry === 'string' ? { server: entry } : entry;
  if (typeof given?.server !== 'string' || !given.server.trim()) {
    throw new WraithError('proxy: each proxy needs a server, such as "http://proxy.example.com:8080"');
  }
  const raw = given.server.trim();
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    throw new WraithError(`proxy: "${redactProxy(raw)}" isn't a valid proxy URL`);
  }
  if (!SCHEMES.has(url.protocol)) {
    throw new WraithError(`proxy: ${url.protocol.slice(0, -1)} proxies aren't supported. Use http, https or socks5.`);
  }
  // Credentials can be in the URL or given separately; separate ones win.
  const username = given.username ?? (url.username ? decodeURIComponent(url.username) : undefined);
  const password = given.password ?? (url.password ? decodeURIComponent(url.password) : undefined);
  // Keep the port explicit: URL drops http's 80 and https's 443, and knows nothing of SOCKS's 1080.
  const settings: ProxySettings = { server: `${url.protocol}//${url.hostname}:${url.port || DEFAULT_PORTS[url.protocol]}` };
  if (username !== undefined) settings.username = username;
  if (password !== undefined) settings.password = password;
  if (given.bypass) settings.bypass = given.bypass;
  return settings;
}

/** Whether `url` skips the proxy under its bypass list. */
export function bypassesProxy(proxy: ProxySettings, url: string): boolean {
  if (!proxy.bypass) return false;
  const host = new URL(url).hostname.toLowerCase();
  return proxy.bypass.split(',').some((raw) => {
    const rule = raw.trim().toLowerCase().replace(/:\d+$/, '');
    if (!rule) return false;
    if (rule === '*') return true;
    if (rule === '<local>') return !host.includes('.');
    if (rule.startsWith('*.')) return host.endsWith(rule.slice(1));
    if (rule.startsWith('.')) return host.endsWith(rule);
    return host === rule;
  });
}

function dispatcherFor(proxy: ProxySettings): Dispatcher {
  if (proxy.server.startsWith('socks5:')) {
    return new Socks5ProxyAgent(proxy.server, {
      ...(proxy.username !== undefined ? { username: proxy.username } : {}),
      ...(proxy.password !== undefined ? { password: proxy.password } : {}),
    });
  }
  const credentials = proxy.username !== undefined ? `${proxy.username}:${proxy.password ?? ''}` : undefined;
  return new ProxyAgent({
    uri: proxy.server,
    ...(credentials ? { token: `Basic ${Buffer.from(credentials).toString('base64')}` } : {}),
  });
}

/** The parts of a fetch response wraith reads. */
export interface FetchResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  text(): Promise<string>;
}

export interface Fetcher {
  fetch(url: string, init: RequestInit): Promise<FetchResponse>;
  /** Closes the proxy connections. */
  close(): Promise<void>;
}

/**
 * A fetch that sends each request through the next proxy in turn, or straight out when there are
 * no proxies (or the URL is on the proxy's bypass list). With user agents, each request gets one,
 * unless it sets its own: the same one for every request through a given proxy, so an address
 * doesn't change browsers between requests, or the next in turn without proxies.
 */
export function createFetcher(proxies: readonly ProxySettings[], userAgents: readonly string[] = []): Fetcher {
  const dispatchers = new Map<ProxySettings, Dispatcher>();
  let next = 0;
  return {
    async fetch(url, init) {
      const turn = next++;
      const index = proxies.length > 0 ? turn % proxies.length : turn;
      const agent = userAgents.length > 0 ? userAgents[index % userAgents.length] : undefined;
      if (agent) {
        const headers = new Headers(init.headers);
        if (!headers.has('user-agent')) headers.set('user-agent', agent);
        init = { ...init, headers };
      }
      const proxy = proxies[index];
      if (!proxy || bypassesProxy(proxy, url)) return fetch(url, init);
      let dispatcher = dispatchers.get(proxy);
      if (!dispatcher) {
        dispatcher = dispatcherFor(proxy);
        dispatchers.set(proxy, dispatcher);
      }
      // undici's own fetch: Node's built-in one can't take a dispatcher from a different undici version.
      const response = await undiciFetch(url, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher });
      return {
        url: response.url,
        status: response.status,
        ok: response.ok,
        headers: new Headers([...response.headers]),
        text: () => response.text(),
      };
    },
    async close() {
      const open = [...dispatchers.values()];
      dispatchers.clear();
      await Promise.all(open.map((dispatcher) => dispatcher.close().catch(() => {})));
    },
  };
}
