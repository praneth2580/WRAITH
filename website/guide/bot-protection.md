# Bot protection

Many sites sit behind a bot protection service. Sometimes the service answers instead of the site: a page saying access is denied, a JavaScript check, or a CAPTCHA. wraith recognises these answers from Cloudflare, Akamai, DataDome, HUMAN (PerimeterX), Kasada, Imperva, AWS WAF, F5, Sucuri, Vercel and Anubis, and stops with `BlockedError`. It doesn't extract data from the block page, and it doesn't keep asking.

```ts
import { BlockedError, createWraith } from 'wraithjs';

const wraith = createWraith();

try {
  const page = await wraith.fetch('https://example.com/products');
  console.log(page.extract({ names: { selector: '.product h2', list: true } }));
} catch (error) {
  if (!(error instanceof BlockedError)) throw error;
  console.warn(`${error.vendor} ${error.kind}: ${error.message}`);
}
```

## Blocks and challenges

`BlockedError` has the service's answer in `kind`:

- **`'block'`**: it refused the request outright, as with Cloudflare's error 1020, Akamai's "Access Denied", or a DataDome ban. wraith throws straight away.
- **`'challenge'`**: it wants proof first, either a JavaScript check that a real browser runs by itself or a CAPTCHA for a person.

What happens with a challenge depends on the page:

- **Static fetches** can't run JavaScript or show a CAPTCHA, so `fetch()` throws.
- **Browser pages** give the check up to 15 seconds (or `network.timeout`, if shorter) to clear by itself, the way it does for a person. If the page reloads into the real one, `goto()` returns that page's response as usual. If it doesn't clear, `goto()` throws.
- **CAPTCHAs** can go to a person: with [`handoff: { auto: true }`](/guide/captchas), they're handed off before wraith checks for blocks. The hand-off recognises DataDome's CAPTCHA and HUMAN's "Press & Hold" alongside reCAPTCHA, hCaptcha, Turnstile and GeeTest.

Either way, a block or challenge page is never retried, even when it comes with a 429 or 503 status that wraith would otherwise retry. Asking again straight away only adds load and usually makes the block last longer.

## Handling them yourself

With `network.onBlock: 'return'`, wraith returns the page and tells you what answered:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ network: { onBlock: 'return' } });

const page = await wraith.fetch(url);
if (page.blocked) console.log(page.blocked);
// { vendor: 'cloudflare', kind: 'challenge', status: 403, url, evidence: 'cf-mitigated: challenge header' }

const tab = await wraith.open(url);
console.log(await tab.blocked());   // the same, for the document showing now
```

`goto()` and `fetch()` check by themselves. After a click or other action that navigates, call `page.blocked()` when it matters. `detectBlock()` checks any response, such as one from `captureJson()` or your own HTTP client:

```ts
import { detectBlock } from 'wraithjs';
declare const response: Response;

const block = detectBlock({ url, status: response.status, headers: response.headers, body: await response.text() });
```

## How it recognises them

Each service has its own markers. Some are headers, such as `cf-mitigated: challenge`, `x-amzn-waf-action` or `x-vercel-mitigated`. Others are in the page: a challenge script, a CAPTCHA frame, or the service's own wording and reference numbers. `evidence` says which one matched.

Most of these services also add their scripts to ordinary pages, so a script alone doesn't count. It has to come with an error status, or the page has to be nothing but the challenge. An ordinary page from a protected site isn't flagged, and neither is a plain `403 Forbidden` from the site itself. A block page from a service wraith doesn't know looks like any other response.

## What wraith won't do

A block or a challenge is the site's decision about automated traffic. wraith reports it; it doesn't work around it:

- It doesn't solve CAPTCHAs or send them to solving services. A [person](/guide/captchas) can.
- It doesn't hide that its browser is automated: `navigator.webdriver` stays `true`.
- It doesn't take a clearance cookie from a browser page and replay it in static fetches, or rotate to another proxy or user agent to get past a block.

[User agents](/guide/proxies#user-agents) still present a consistent identity, so a site's checks see one coherent browser rather than a contradiction. If a site blocks you anyway, check its terms, slow down, or ask its owner for access or an API. See [Use responsibly](/guide/responsible-use).
