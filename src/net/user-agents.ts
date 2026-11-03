import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { WraithError } from '../errors.js';

// `string & {}` keeps 'rotate' in editor suggestions while accepting any string.
/**
 * A user agent string, a list to spread across, or `'rotate'` for wraith's built-in list of
 * current desktop browsers.
 */
export type UserAgentOption = 'rotate' | (string & {}) | readonly string[];

type Engine = 'chromium' | 'firefox' | 'webkit';

// Used only if Playwright's list of browser versions can't be read.
const FALLBACK_VERSIONS = { chromium: '156', firefox: '157', webkit: '27.2' };

let versions: typeof FALLBACK_VERSIONS | undefined;

/** The browser versions Playwright installs, so built-in user agents track Playwright updates. */
function browserVersions(): typeof FALLBACK_VERSIONS {
  if (versions) return versions;
  try {
    // playwright-core isn't a direct dependency, so find it through playwright (works under pnpm too).
    const require = createRequire(import.meta.url);
    const core = createRequire(require.resolve('playwright/package.json')).resolve('playwright-core/package.json');
    const { browsers } = JSON.parse(readFileSync(join(dirname(core), 'browsers.json'), 'utf8')) as {
      browsers: { name: string; browserVersion?: string }[];
    };
    const version = (name: string) => browsers.find((browser) => browser.name === name)?.browserVersion;
    versions = {
      chromium: version('chromium')?.split('.')[0] ?? FALLBACK_VERSIONS.chromium,
      firefox: version('firefox')?.split('.')[0] ?? FALLBACK_VERSIONS.firefox,
      webkit: version('webkit')?.split('.').slice(0, 2).join('.') ?? FALLBACK_VERSIONS.webkit,
    };
  } catch {
    versions = FALLBACK_VERSIONS;
  }
  return versions;
}

const CHROME_PLATFORMS = ['Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 10_15_7', 'X11; Linux x86_64'];
const FIREFOX_PLATFORMS = ['Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 10.15', 'X11; Linux x86_64'];

/**
 * Current desktop user agents in the formats browsers send today, with versions taken from the
 * browsers Playwright installs. For one engine, only that engine's browsers: Chrome for chromium,
 * Firefox for firefox, Safari for webkit.
 */
export function builtInUserAgents(engine?: Engine): string[] {
  const v = browserVersions();
  const chrome = CHROME_PLATFORMS.map(
    (platform) => `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v.chromium}.0.0.0 Safari/537.36`,
  );
  const edge = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v.chromium}.0.0.0 Safari/537.36 Edg/${v.chromium}.0.0.0`;
  const firefox = FIREFOX_PLATFORMS.map((platform) => `Mozilla/5.0 (${platform}; rv:${v.firefox}.0) Gecko/20100101 Firefox/${v.firefox}.0`);
  const safari = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v.webkit} Safari/605.1.15`;
  if (engine === 'chromium') return chrome;
  if (engine === 'firefox') return firefox;
  if (engine === 'webkit') return [safari];
  return [...chrome, edge, ...firefox, safari];
}

export interface ResolvedUserAgents {
  /** For static fetches and robots.txt, taken in turn. */
  requests: string[];
  /** For browser instances, one each. */
  browser: string[];
}

export function resolveUserAgents(option: UserAgentOption | undefined, engine: Engine): ResolvedUserAgents {
  if (option === undefined) return { requests: [], browser: [] };
  if (option === 'rotate') return { requests: builtInUserAgents(), browser: builtInUserAgents(engine) };
  const list = typeof option === 'string' ? [option] : [...option];
  if (list.length === 0 || list.some((agent) => typeof agent !== 'string' || !agent.trim())) {
    throw new WraithError("userAgent must be a user agent string, a non-empty list of them, or 'rotate'");
  }
  return { requests: list, browser: list };
}
