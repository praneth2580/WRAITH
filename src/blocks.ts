/** Bot protection services wraith recognises. */
export type BotProtection =
  | 'cloudflare'
  | 'akamai'
  | 'datadome'
  | 'perimeterx'
  | 'kasada'
  | 'imperva'
  | 'aws-waf'
  | 'f5'
  | 'sucuri'
  | 'vercel'
  | 'anubis';

/** A bot protection service's answer in place of the page. */
export interface Block {
  /** Which service answered. */
  vendor: BotProtection;
  /**
   * `'challenge'`: it wants proof first, either a JavaScript check that a real browser runs by
   * itself or a CAPTCHA for a person. `'block'`: it refused the request outright.
   */
  kind: 'challenge' | 'block';
  status: number;
  url: string;
  /** What gave it away, such as `cf-mitigated: challenge header`. */
  evidence: string;
}

/** Display names, for messages. */
export const PROTECTION_NAMES: Record<BotProtection, string> = {
  cloudflare: 'Cloudflare',
  akamai: 'Akamai',
  datadome: 'DataDome',
  perimeterx: 'HUMAN (PerimeterX)',
  kasada: 'Kasada',
  imperva: 'Imperva',
  'aws-waf': 'AWS WAF',
  f5: 'F5',
  sucuri: 'Sucuri',
  vercel: 'Vercel',
  anubis: 'Anubis',
};

/** @internal The parts of a response the checks read. */
export interface ResponseSnapshot {
  url: string;
  status: number;
  headers: Headers | Record<string, string>;
  body: string;
}

type Found = Pick<Block, 'vendor' | 'kind' | 'evidence'>;
type Check = (r: { status: number; header: (name: string) => string | undefined; headerNames: string[]; body: string; title: string }) => Found | null;

const found = (vendor: BotProtection, kind: Block['kind'], evidence: string): Found => ({ vendor, kind, evidence });

// Every check needs a signal that only appears on the service's block or challenge page. Most of
// these services also add scripts to ordinary pages, so a script alone isn't enough: those checks
// also need an error status, or a page that is nothing but the challenge.
const CHECKS: Check[] = [
  // Cloudflare
  ({ header, status, body, title }) => {
    if (header('cf-mitigated') === 'challenge') return found('cloudflare', 'challenge', 'cf-mitigated: challenge header');
    const cloudflare = /cloudflare/i.test(header('server') ?? '') || header('cf-ray') !== undefined;
    if (!cloudflare || status < 400) return null;
    if (/window\._cf_chl_opt|\/cdn-cgi\/challenge-platform\/h\//.test(body) || /^just a moment/i.test(title)) {
      return found('cloudflare', 'challenge', 'Cloudflare challenge page');
    }
    // 1006-1012, 1015 and 1020 are its refusals; other 1xxx codes are configuration errors.
    if ((status === 403 || status === 429) && /Sorry, you have been blocked|error code: 10(0[6-9]|1[02]|15|20)\b|cf-error-details/i.test(body)) {
      return found('cloudflare', 'block', 'Cloudflare block page');
    }
    return null;
  },
  // Akamai
  ({ header, status, body, title }) => {
    if (status >= 400 && /\/_sec\/cp_challenge\/|sec-if-cpt-container/.test(body)) return found('akamai', 'challenge', 'Akamai sec-cpt challenge');
    const akamai = /AkamaiGHost/i.test(header('server') ?? '') || /errors\.edgesuite\.net|Reference&#32;&#35;\d|Reference #\d+\.[0-9a-f]+\.\d+/.test(body);
    if (akamai && status === 403 && /access denied/i.test(title || body.slice(0, 500))) return found('akamai', 'block', 'Akamai "Access Denied" page');
    return null;
  },
  // DataDome
  ({ header, status, body }) => {
    const header_ = header('x-datadome') !== undefined || header('x-dd-b') !== undefined;
    const page = /captcha-delivery\.com|var dd\s*=\s*\{/.test(body);
    if (status < 400 || (!header_ && !page)) return null;
    if (/['"]t['"]\s*:\s*['"]bv['"]/.test(body)) return found('datadome', 'block', 'DataDome ban page');
    return page ? found('datadome', 'challenge', 'DataDome CAPTCHA page') : found('datadome', 'block', 'x-datadome header on an error');
  },
  // HUMAN, formerly PerimeterX
  ({ status, body }) =>
    status >= 400 && /id=["']px-captcha["']|window\._pxAppId|captcha\.px-cdn\.net/.test(body)
      ? found('perimeterx', 'challenge', 'HUMAN (PerimeterX) "Press & Hold" page')
      : null,
  // Kasada
  ({ status, headerNames, body }) => {
    if (status < 400) return null;
    if (headerNames.some((name) => name.startsWith('x-kpsdk-'))) return found('kasada', 'challenge', 'x-kpsdk-* headers on an error');
    return status === 429 && /\/ips\.js\b|\bKPSDK\b/.test(body) ? found('kasada', 'challenge', 'Kasada ips.js challenge') : null;
  },
  // Imperva (Incapsula)
  ({ body }) => {
    if (/Incapsula incident ID|Request unsuccessful\. Incapsula/i.test(body)) return found('imperva', 'block', 'Imperva incident page');
    const bare = body.length < 10_000 && /<meta[^>]+robots[^>]+noindex/i.test(body);
    return bare && /\/_Incapsula_Resource\?/.test(body) ? found('imperva', 'challenge', 'Imperva challenge page') : null;
  },
  // AWS WAF
  ({ header, status, body }) => {
    const action = header('x-amzn-waf-action');
    if (action) return found('aws-waf', action === 'block' ? 'block' : 'challenge', `x-amzn-waf-action: ${action} header`);
    return (status === 202 || status === 405) && /AwsWafIntegration|\.awswaf\.com/.test(body)
      ? found('aws-waf', 'challenge', 'AWS WAF challenge page')
      : null;
  },
  // F5 BIG-IP (sent with any status, often 200)
  ({ body }) =>
    /The requested URL was rejected\. Please consult with your administrator/i.test(body) ? found('f5', 'block', 'F5 "requested URL was rejected" page') : null,
  // Sucuri
  ({ header, body }) => {
    if (header('x-sucuri-block') !== undefined || /Sucuri WebSite Firewall - Access Denied|Access Denied - Sucuri Website Firewall/i.test(body)) {
      return found('sucuri', 'block', 'Sucuri "Access Denied" page');
    }
    return /sucuri_cloudproxy_js/.test(body) ? found('sucuri', 'challenge', 'Sucuri JavaScript check') : null;
  },
  // Vercel
  ({ header }) => {
    const mitigated = header('x-vercel-mitigated');
    if (!mitigated) return null;
    return found('vercel', mitigated === 'challenge' ? 'challenge' : 'block', `x-vercel-mitigated: ${mitigated} header`);
  },
  // Anubis (open source, self-hosted)
  ({ status, body }) => {
    if (/id=["']anubis_challenge["']/.test(body)) return found('anubis', 'challenge', 'Anubis proof-of-work page');
    return status >= 400 && /\/\.within\.website\/x\/cmd\/anubis\//.test(body) ? found('anubis', 'block', 'Anubis refusal page') : null;
  },
];

/** @internal The second half of a BlockedError's message: what to do about it. */
export function adviceFor(block: Block, where: 'static' | 'browser', waitedMs = 0): string {
  const refusal =
    "wraith doesn't retry blocked requests. The site's protection refused this client: check the site's terms, slow down, " +
    'or ask its owner for access or an API.';
  if (block.kind === 'block') return refusal;
  if (where === 'static') {
    return (
      "A static fetch can't take part in a challenge. In a browser page (wraith.open) its JavaScript check can run, and a CAPTCHA " +
      "can go to a person with the handoff option. Pass network.onBlock: 'return' to get this page anyway."
    );
  }
  return (
    `It was still there after ${Math.round(waitedMs / 1000)} s. A CAPTCHA can go to a person with the handoff option; ` +
    "a check that never clears means the site isn't letting this browser in."
  );
}

/**
 * Recognises a bot protection service's block or challenge page from the response: its status,
 * headers and HTML. Null for anything else, including ordinary pages from protected sites.
 */
export function detectBlock(response: ResponseSnapshot): Block | null {
  const headers = response.headers instanceof Headers ? response.headers : new Headers(response.headers);
  const header = (name: string) => headers.get(name) ?? undefined;
  const headerNames = [...headers.keys()];
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(response.body)?.[1]?.trim() ?? '';
  for (const check of CHECKS) {
    const result = check({ status: response.status, header, headerNames, body: response.body, title });
    if (result) return { ...result, status: response.status, url: response.url };
  }
  return null;
}
