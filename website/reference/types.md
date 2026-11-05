# Result types

## Challenge

Returned by `detectChallenge()` and `handoff()`, and passed to `onChallenge`.

```ts sig
interface Challenge {
  kind: 'captcha' | 'otp' | 'browser-check';
  provider: 'recaptcha' | 'hcaptcha' | 'turnstile' | 'geetest' | 'datadome' | 'perimeterx' | 'image' | 'cloudflare' | 'otp';
  url: string;
  message: string;     // a one-line explanation; for codes, includes the page's own wording
  image: Buffer;       // PNG of the challenge, or of the form asking for the code
  answerable: boolean; // true when typing an answer solves it
}
```

## Block

Returned by `page.blocked()`, `staticPage.blocked` and `detectBlock()`. `BlockedError` has the same fields.

```ts sig
interface Block {
  vendor: 'cloudflare' | 'akamai' | 'datadome' | 'perimeterx' | 'kasada' | 'imperva'
        | 'aws-waf' | 'f5' | 'sucuri' | 'vercel' | 'anubis';
  kind: 'challenge' | 'block'; // wants proof first, or refused outright
  status: number;
  url: string;
  evidence: string;            // what identified it, such as 'cf-mitigated: challenge header'
}
```

## ConsentStatus

Returned by `waitForConsent()` and `consentStatus()`.

```ts sig
interface ConsentStatus {
  cmp: string | null;         // the consent platform, such as 'onetrust', or null if none yet
  done: boolean;              // the banner has been dealt with
  succeeded: boolean | null;  // whether the reject/accept steps worked, once they've run
  hiddenOnly: boolean;        // the banner was only hidden with CSS, without recording a choice
}
```

## ActResult

Returned by `page.ai.act()`.

```ts sig
interface ActResult {
  success: boolean;  // the model reported the instruction as done
  message: string;   // the model's last explanation, or why it stopped
  steps: ActStep[];
}

interface ActStep {
  action: 'click' | 'type' | 'select' | 'press' | 'scroll';
  element?: string;  // the element acted on, as the model saw it
  value?: string;    // as the model wrote it, with %variables% unfilled
  reason: string;
  error?: string;    // set when the action failed
}
```

## CrawlResult

Returned by `wraith.crawl()`.

```ts sig
interface CrawlResult<T> {
  results: { url: string; depth: number; data: T }[];
  errors: { url: string; error: Error }[];
}
```

## StructuredData

Returned by `structuredData()` on browser and static pages.

```ts sig
interface StructuredData {
  jsonLd: Json[];                      // every JSON-LD object, arrays and @graph unpacked
  microdata: MicrodataItem[];          // schema.org itemscope/itemprop
  openGraph: Record<string, string>;   // og:*, twitter:*, article:*…
  meta: Record<string, string>;        // other <meta name> tags
  embedded: Record<string, unknown>;   // <script type="application/json" id> blocks, and app state on window
}

interface MicrodataItem {
  type: string | string[] | null;           // the itemtype
  properties: Record<string, unknown[]>;    // nested items appear as MicrodataItem
}
```

`jsonLdOfType(data, type)` returns the JSON-LD objects whose `@type` is `type`, or includes it when `@type` is an array. Full type URLs such as `https://schema.org/Product` match too.

App state read from `window` on browser pages: `__NEXT_DATA__`, `__NUXT__`, `__INITIAL_STATE__`, `__PRELOADED_STATE__`, `__APOLLO_STATE__`, `__REDUX_STATE__`, `__APP_STATE__`, `__INITIAL_DATA__`, `__remixContext` and `__staticRouterHydrationData`.
