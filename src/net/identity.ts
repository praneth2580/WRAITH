import type { BrowserContext, Page } from 'playwright';

/**
 * What a user agent string says about the browser that sends it. wraith uses this to keep the
 * rest of what it presents (client hints, `navigator.platform`, request headers) consistent with
 * the user agent you choose.
 */
export interface BrowserIdentity {
  family: 'chrome' | 'edge' | 'firefox' | 'safari';
  /** Major version, such as '156'. */
  major: string;
  os: 'Windows' | 'macOS' | 'Linux' | 'Chrome OS' | 'Android' | 'iOS';
  mobile: boolean;
}

/** Reads a browser user agent. Null for anything else: bots, HeadlessChrome, and browsers wraith doesn't model. */
export function parseUserAgent(userAgent: string): BrowserIdentity | null {
  if (/HeadlessChrome|\b(OPR|YaBrowser|SamsungBrowser|UCBrowser|Vivaldi)\//.test(userAgent)) return null;
  const os = osOf(userAgent);
  if (!os) return null;
  const mobile = os === 'iOS' || (os === 'Android' && /\bMobile\b/.test(userAgent));
  // Every browser on iOS is WebKit underneath, and sends what Safari sends.
  if (os === 'iOS') {
    const version = /Version\/(\d+)/.exec(userAgent) ?? /OS (\d+)_/.exec(userAgent);
    return version ? { family: 'safari', major: version[1]!, os, mobile } : null;
  }
  let match = /\bEdg(?:A)?\/(\d+)/.exec(userAgent);
  if (match) return { family: 'edge', major: match[1]!, os, mobile };
  match = /\bChrome\/(\d+)/.exec(userAgent);
  if (match) return { family: 'chrome', major: match[1]!, os, mobile };
  match = /\bFirefox\/(\d+)/.exec(userAgent);
  if (match) return { family: 'firefox', major: match[1]!, os, mobile };
  match = /\bVersion\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//.exec(userAgent);
  if (match) return { family: 'safari', major: match[1]!, os, mobile };
  return null;
}

function osOf(userAgent: string): BrowserIdentity['os'] | null {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return 'iOS';
  if (/\bAndroid\b/.test(userAgent)) return 'Android';
  if (/\bWindows NT\b/.test(userAgent)) return 'Windows';
  if (/\bCrOS\b/.test(userAgent)) return 'Chrome OS';
  if (/\bMac OS X\b|\bMacintosh\b/.test(userAgent)) return 'macOS';
  if (/\bLinux\b|\bX11\b/.test(userAgent)) return 'Linux';
  return null;
}

const isChromium = (identity: BrowserIdentity) => identity.family === 'chrome' || identity.family === 'edge';

/** What `navigator.platform` says on that system. */
export function navigatorPlatform(identity: BrowserIdentity): string {
  switch (identity.os) {
    case 'Windows':
      return 'Win32';
    case 'macOS':
      return 'MacIntel';
    case 'Android':
      return 'Linux armv8l';
    case 'iOS':
      return 'iPhone';
    default:
      return 'Linux x86_64';
  }
}

export interface Brand {
  brand: string;
  version: string;
}

/** User-agent client hints, in the shape Chrome DevTools Protocol's `UserAgentMetadata` takes. */
export interface ClientHints {
  brands: Brand[];
  fullVersionList: Brand[];
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
  formFactors: string[];
}

// The values below stand in for the details a user agent string no longer carries (Chrome freezes
// the OS version in it). They are what current systems report.
const PLATFORM_VERSIONS: Record<BrowserIdentity['os'], string> = {
  Windows: '19.0.0',
  macOS: '26.1.0',
  Linux: '6.8.0',
  'Chrome OS': '16433.45.0',
  Android: '15.0.0',
  iOS: '',
};

/**
 * Chrome's brand list for a major version: its "GREASE" brand (a deliberately odd name such as
 * "Not:A-Brand", so servers don't hard-code the list), "Chromium", and the browser's own brand, in
 * an order picked by the version number. This follows Chromium's `GenerateBrandVersionList`.
 */
export function chromiumBrands(major: string, brand: string, fullVersion?: string): { brands: Brand[]; fullVersionList: Brand[] } {
  const seed = Number.parseInt(major, 10);
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
  const greaseVersion = ['8', '99', '24'][seed % 3]!;
  const grease = `Not${chars[seed % chars.length]}A${chars[(seed + 1) % chars.length]}Brand`;
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const order = orders[seed % orders.length]!;
  const full = fullVersion ?? `${major}.0.0.0`;
  const shuffle = (list: Brand[]) => {
    const out: Brand[] = [];
    list.forEach((item, i) => (out[order[i]!] = item));
    return out;
  };
  return {
    brands: shuffle([
      { brand: grease, version: greaseVersion },
      { brand: 'Chromium', version: major },
      { brand, version: major },
    ]),
    fullVersionList: shuffle([
      { brand: grease, version: `${greaseVersion}.0.0.0` },
      { brand: 'Chromium', version: full },
      { brand, version: full },
    ]),
  };
}

/**
 * The client hints a Chromium browser with this identity reports, or null for Firefox and Safari,
 * which don't have them. `fullVersion` is the running browser's version, used when its major
 * version matches the user agent's.
 */
export function clientHints(identity: BrowserIdentity, fullVersion?: string): ClientHints | null {
  if (!isChromium(identity)) return null;
  const full = fullVersion?.split('.')[0] === identity.major ? fullVersion : undefined;
  const { brands, fullVersionList } = chromiumBrands(identity.major, identity.family === 'edge' ? 'Microsoft Edge' : 'Google Chrome', full);
  const android = identity.os === 'Android';
  return {
    brands,
    fullVersionList,
    platform: identity.os,
    platformVersion: PLATFORM_VERSIONS[identity.os],
    architecture: android ? '' : identity.os === 'macOS' ? 'arm' : 'x86',
    model: '',
    mobile: identity.mobile,
    bitness: android ? '' : '64',
    wow64: false,
    formFactors: [identity.mobile ? 'Mobile' : android ? 'Tablet' : 'Desktop'],
  };
}

/** A structured-header list of brands, as in the `sec-ch-ua` header. */
function brandHeader(brands: Brand[]): string {
  return brands.map(({ brand, version }) => `"${brand}";v="${version}"`).join(', ');
}

/** `de-DE` → `['de-DE', 'de']`; `fr` → `['fr']`. */
function languagesFor(locale: string): string[] {
  const base = locale.split('-')[0]!;
  return base && base !== locale ? [locale, base] : [locale];
}

/** The Accept-Language a browser of this family sends for `locale`. */
export function acceptLanguage(identity: BrowserIdentity, locale: string): string {
  const [first, ...rest] = languagesFor(locale);
  const q = identity.family === 'firefox' ? '0.5' : '0.9';
  return [first, ...rest.map((language) => `${language};q=${q}`)].join(',');
}

/**
 * Whether browsers treat `url` as a secure context. Client hints and `Sec-Fetch-*` headers only
 * go to those: HTTPS, and loopback addresses.
 */
function isTrustworthy(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  if (protocol === 'https:' || protocol === 'wss:') return true;
  return hostname === 'localhost' || hostname.endsWith('.localhost') || /^127\./.test(hostname) || hostname === '[::1]';
}

const HTML_ACCEPT = {
  chromium: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  other: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/**
 * The headers this browser sends, besides User-Agent, when you type `url` into its address bar
 * (for GET), or with a script's request (other methods). Null when `userAgent` isn't a browser
 * wraith models, such as a bot's own name.
 */
export function browserHeaders(userAgent: string, url: string, options: { method?: string; locale?: string } = {}): Record<string, string> | null {
  const identity = parseUserAgent(userAgent);
  if (!identity) return null;
  const secure = isTrustworthy(url);
  const navigation = (options.method ?? 'GET').toUpperCase() === 'GET';
  const headers: Record<string, string> = {};
  const hints = clientHints(identity);
  if (hints && secure) {
    headers['sec-ch-ua'] = brandHeader(hints.brands);
    headers['sec-ch-ua-mobile'] = hints.mobile ? '?1' : '?0';
    headers['sec-ch-ua-platform'] = `"${hints.platform}"`;
  }
  if (navigation) {
    if (identity.family !== 'safari') headers['upgrade-insecure-requests'] = '1';
    headers.accept = isChromium(identity) ? HTML_ACCEPT.chromium : HTML_ACCEPT.other;
    if (secure) {
      headers['sec-fetch-site'] = 'none';
      headers['sec-fetch-mode'] = 'navigate';
      if (identity.family !== 'safari') headers['sec-fetch-user'] = '?1';
      headers['sec-fetch-dest'] = 'document';
    }
    // Brotli only over secure connections, as browsers do. (Not zstd: Node can't decode it everywhere.)
    headers['accept-encoding'] = secure ? 'gzip, deflate, br' : 'gzip, deflate';
  }
  headers['accept-language'] = acceptLanguage(identity, options.locale ?? 'en-US');
  return headers;
}

/**
 * @internal Makes every page in a Chromium context present `userAgent` consistently: the
 * `sec-ch-ua*` headers and `navigator.userAgentData` name the same browser and system as the user
 * agent, `navigator.platform` matches, and the languages match `locale`. Returns a function that
 * resolves once a page is set up; pages that open by themselves (popups) are set up as they appear.
 *
 * Null when the user agent isn't a Chromium browser wraith models; the context is left as it is.
 */
export function installIdentity(
  context: BrowserContext,
  options: { userAgent: string; locale: string; browserVersion: string; onError: (error: Error) => void },
): ((page: Page) => Promise<void>) | null {
  const identity = parseUserAgent(options.userAgent);
  const hints = identity && clientHints(identity, options.browserVersion);
  if (!identity || !hints) return null;
  const override = {
    userAgent: options.userAgent,
    // Chrome adds the q-values itself.
    acceptLanguage: languagesFor(options.locale).join(','),
    platform: navigatorPlatform(identity),
    userAgentMetadata: hints,
  };
  const ready = new WeakMap<Page, Promise<void>>();
  const prepare = (page: Page): Promise<void> => {
    let done = ready.get(page);
    if (!done) {
      // The session stays open for the page's lifetime: closing it would undo the override.
      done = context
        .newCDPSession(page)
        .then((session) => session.send('Emulation.setUserAgentOverride', override as never))
        .then(() => undefined);
      ready.set(page, done);
    }
    return done;
  };
  context.on('page', (page) => {
    prepare(page).catch((error: Error) => {
      if (!page.isClosed()) options.onError(error);
    });
  });
  return prepare;
}
