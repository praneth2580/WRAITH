# wraith

[![npm (beta)](https://img.shields.io/npm/v/wraithjs/beta?label=npm%40beta)](https://www.npmjs.com/package/wraithjs)
[![node](https://img.shields.io/node/v/wraithjs)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/wraithjs)](#license)

Web scraping and browser automation for Node.js, with human-like input you can tune or switch off, and optional AI from a local model or an API key. Everything runs in your own process: there's no server and no hosted service.

> **Beta.** wraith is a pre-release. The API may still change before 1.0, so pin the exact version (`npm install wraithjs@beta --save-exact`) and read the [changelog](#changelog) before upgrading.

- **Human behaviour, one option away.** Curved mouse paths with Fitts's-law timing and occasional overshoot, typing with corrected typos, wheel scrolling, reading pauses, and random delays between actions. Pick a preset or adjust any setting.
- **Two ways to load a page.** A real browser (Playwright) for JavaScript-heavy sites, or a plain HTTP fetch, which is much faster, for pages that don't need JavaScript. Both use the same extraction API.
- **Selector extraction with inferred types.** Describe the data with CSS selectors and get typed results back.
- **Polite by default.** A per-host rate limit, retries with backoff, and optional robots.txt checks (including Crawl-delay).
- **Waits that understand the page.** Clicks wait until a button is enabled and uncovered. `waitForSettled()` waits for requests, spinners and skeletons to finish.
- **Robust to generated class names.** Find elements by role, label or text; read values next to their labels; pull JSON-LD, embedded app state, or the site's own API responses.
- **Consent banners, pagination and hand-off.** Reject (or accept) cookie banners automatically, page through "Next", "Load more" and infinite scroll, and hand CAPTCHAs and one-time codes to a person.
- **Optional AI.** Extract into a zod schema, ask questions about a page, or give plain-language instructions ("log in with %user%"). Works with Ollama (local), Claude, OpenAI, and any OpenAI-compatible server such as LM Studio, vLLM or OpenRouter.

It builds on existing libraries rather than reinventing them: [Playwright](https://playwright.dev), [cheerio](https://cheerio.js.org), [zod](https://zod.dev), [p-queue](https://github.com/sindresorhus/p-queue), [p-retry](https://github.com/sindresorhus/p-retry), [robots-parser](https://github.com/samclarke/robots-parser), [node-html-markdown](https://github.com/crosstype/node-html-markdown) and DuckDuckGo's [autoconsent](https://github.com/duckduckgo/autoconsent).

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- Guides: [Human behaviour](#human-behaviour) · [Browser pages and static pages](#browser-pages-and-static-pages) · [Extracting with selectors](#extracting-with-selectors) · [Sites with generated class names](#sites-with-generated-class-names) · [Waiting](#waiting) · [Pagination](#pagination) · [Consent banners](#consent-banners) · [CAPTCHAs and verification codes](#captchas-and-verification-codes) · [Crawling](#crawling) · [AI](#ai) · [Network and politeness](#network-and-politeness) · [Browser options and sessions](#browser-options-and-sessions)
- [API reference](#api-reference): [createWraith options](#createwraith-options) · [Wraith class](#wraith-class) · [WraithPage](#wraithpage) · [StaticPage](#staticpage) · [Targets](#targets) · [Selector schemas](#selector-schemas) · [JsonCapture](#jsoncapture) · [AI options](#ai-options) · [Result types](#result-types) · [Errors](#errors) · [Other exports](#other-exports)
- [Troubleshooting](#troubleshooting)
- [Use responsibly](#use-responsibly) · [Changelog](#changelog) · [Development](#development) · [License](#license)

## Install

```bash
npm install wraithjs@beta
npx playwright install chromium   # once, downloads the browser wraith drives
```

- Node.js 20.18.1 or later.
- ESM only: use `import`, not `require` (see [Troubleshooting](#troubleshooting) for CommonJS projects).
- TypeScript types are included.

AI providers are optional. Install only the one you use:

```bash
npm install @anthropic-ai/sdk   # for provider: 'anthropic'
npm install openai              # for provider: 'openai' (also LM Studio, vLLM, OpenRouter…)
# provider: 'ollama' needs no package, just a running Ollama
```

## Quick start

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith(); // human: 'natural' by default

try {
  const page = await wraith.open('https://quotes.toscrape.com/login');
  await page.type('#username', 'me');                      // key by key, with the odd corrected typo
  await page.type('#password', 'secret', { typos: false });
  await page.click('input[type=submit]');                   // curved mouse path, then press and release

  const { quotes } = await page.extract({
    quotes: {
      selector: '.quote',
      list: true,
      fields: { text: '.text', author: '.author', tags: { selector: '.tag', list: true } },
    },
  });
  console.log(quotes); // { text: string | null; author: string | null; tags: string[] }[]
} finally {
  await wraith.close(); // always close, or the browser keeps your process alive
}
```

No browser needed? `wraith.fetch()` downloads and parses the HTML directly:

```ts
const page = await wraith.fetch('https://quotes.toscrape.com/');
const { next } = page.extract({ next: 'li.next a@href' }); // absolute URL, or null
```

## Human behaviour

Set it once on `createWraith({ human })`, or per page with `wraith.newPage({ human })`.

| Value | Effect |
| --- | --- |
| `'natural'` (default) or `true` | Paced like an average person |
| `'fast'` | Still human-shaped (mouse paths, key-by-key typing), with short delays and no typos |
| `'careful'` | Slower and more deliberate, with more typos and overshoots |
| `'off'` or `false` | Plain Playwright: instant fills and clicks, no delays |
| `{ preset, ...overrides }` | Any preset with your own changes |

```ts
createWraith({
  human: {
    preset: 'natural',
    actionDelay: [400, 1500],                         // ms before each action
    typing: { keyDelay: [80, 200], typoChance: 0.04 },
    mouse: { speed: 0.8, overshootChance: 0.3 },
  },
  seed: 1234, // makes every delay, path and typo reproducible
});
```

Every setting, with each preset's values. Times are in ms, and `a–b` is a `[min, max]` range picked from at random each time.

| Setting | What it controls | natural | fast | careful |
| --- | --- | --- | --- | --- |
| `actionDelay` | Pause before each click, type, select or press | 250–900 | 60–220 | 600–2200 |
| `mouse.enabled` | Move along a path before clicking; `false` clicks without moving | true | true | true |
| `mouse.speed` | 1 is an average person; 2 is twice as fast | 1 | 2.5 | 0.7 |
| `mouse.overshootChance` | Chance of overshooting a distant target, then correcting | 0.15 | 0.05 | 0.25 |
| `mouse.jitter` | Pixels of wobble along the path | 2 | 1 | 3 |
| `mouse.hoverDelay` | Pause between arriving and pressing | 60–220 | 20–70 | 150–450 |
| `mouse.clickHold` | How long the button stays down | 50–130 | 25–60 | 70–180 |
| `typing.keyDelay` | Time per key | 55–170 | 15–55 | 90–260 |
| `typing.wordPause` | Extra pause after a space | 60–250 | 0–40 | 120–500 |
| `typing.typoChance` | Chance per letter of hitting a neighbouring key and fixing it | 0.02 | 0 | 0.035 |
| `scroll.step` | Pixels per wheel tick | 80–180 | 220–420 | 60–140 |
| `scroll.stepDelay` | Pause between wheel ticks | 30–110 | 10–40 | 60–200 |
| `reading.wordsPerMinute` | Pace for `page.read()` | 200–300 | 600–900 | 150–230 |

How it works: before clicking, wraith waits until the element is visible, enabled, no longer moving, and not covered by anything (a loading overlay, say), up to the timeout. It aims at a point near the element's centre, never its edges. The cursor follows a Bézier curve with a minimum-jerk speed profile, and Fitts's law sets how long each move takes. Elements below the fold are reached with wheel ticks, not a scroll jump. Elements inside iframes use Playwright's own click.

## Browser pages and static pages

- **`wraith.open(url)`** (or `wraith.newPage()` then `page.goto(url)`) gives a **`WraithPage`**: a real browser tab. JavaScript runs, and input is humanized.
- **`wraith.fetch(url)`** gives a **`StaticPage`**: the HTML from a plain HTTP request. Nothing runs, and it's many times faster. Use it whenever the data is in the page source.

Both have `extract()`, `structuredData()`, `links()`, `text()`, `markdown()` and `ai`, and both go through the same rate limit, retries and robots.txt check. The browser launches on the first browser page, not before. See [WraithPage](#wraithpage) and [StaticPage](#staticpage) for every method.

## Extracting with selectors

```ts
page.extract({
  title: 'h1',                                   // text of the first match, or null
  image: 'img.cover@src',                        // attribute; href/src become absolute URLs
  price: { selector: '.price', transform: (v) => Number(v.replace(/[^\d.]/g, '')) },
  tags: { selector: '.tag', list: true },        // string[]
  stock: { selector: '.stock', default: 'unknown' },
  items: {                                       // a list of objects
    selector: '.item',
    list: true,
    fields: { name: 'h3', url: 'a@href' },
  },
});
```

The result type is inferred from the schema. For example, `price` is `number | null` and `items` is `{ name: string | null; url: string | null }[]`. The full format is in [Selector schemas](#selector-schemas).

## Sites with generated class names

Classes like `css-1x2y3z`, `sc-bdfBwQ` or `Button_primary__3xYz` change with every deploy. Ways round them, most robust first:

**1. Capture the site's own API.** Most modern sites load their data as JSON, with proper field names. Start capturing before the request happens:

```ts
const page = await wraith.newPage();
const products = page.captureJson('/api/products');   // URL substring, RegExp, or (response) => boolean
await page.goto(url);
await page.autoScroll();
console.log(products.data);                             // every matching response, parsed
await products.next();                                  // or wait for the next one
```

**2. Read the data the page embeds** for search engines and its own scripts:

```ts
import { jsonLdOfType } from 'wraithjs';

const data = await page.structuredData();              // static pages too: page.structuredData()
jsonLdOfType(data, 'Product');                          // JSON-LD, with @graph unpacked
data.microdata;                                         // schema.org itemprop data
data.openGraph['og:title']; data.meta.description;
data.embedded.__NEXT_DATA__;                            // also __NUXT__, __INITIAL_STATE__, __APOLLO_STATE__… in the browser
```

**3. Describe elements the way a person would.** Anywhere a target is accepted:

```ts
await page.click({ role: 'button', name: 'Add to cart' });
await page.type({ label: 'Email' }, 'me@example.com');
await page.click({ text: 'Next', within: { role: 'navigation' } });
// also placeholder, alt, title, testId; exact: true; nth: 2
```

And in `extract()`, read values by the label next to them, or find elements by their text:

```ts
page.extract({
  price: { near: 'Price' },                     // "Price: ₹499", <dt>Price</dt><dd>…</dd>, <th>…</th><td>…</td>, …
  specs: { near: /^(SKU|Brand)$/, list: true },
  next: { text: 'Next', attr: 'href' },
  title: '[class^="ProductCard_title__"]',      // CSS modules: the prefix is stable, the hash isn't
  rating: '[itemprop="ratingValue"]@content',
});
```

**4. Let the AI read it.** `page.ai.extract(schema)` ignores markup entirely. It's the slowest and costliest option, so keep it for when the others don't work.

## Waiting

Clicks, key presses and selects already wait for the element to be clickable. After the action, they wait for any page load it started (`waits.afterAction`, default `'navigation'`). For everything else:

```ts
await page.click('#search');
await page.waitForSettled();          // requests done, content stopped changing, no spinner/loader/skeleton
await page.waitForText('results');
await page.waitForUrl('**/checkout');
await page.waitFor('.overlay', { state: 'hidden' });
const total = await page.waitUntil(async () => Number(await page.text('.count')) || null);
```

`waitForSettled()` returns `false` instead of throwing if the page never goes quiet (a ticking clock or carousel). It recognises common loaders (`[aria-busy]`, spinners, loaders, skeletons, indeterminate progress bars). Add your own with `{ loaders: ['.my-overlay'] }`, or turn them off with `loaders: false`. To make every action wait like this:

```ts
createWraith({ waits: { afterAction: 'settle', settle: { networkIdleMs: 500, domIdleMs: 300, timeout: 15_000 } } });
```

## Pagination

```ts
for await (const n of page.paginate({ next: { role: 'link', name: 'Next' }, maxPages: 20 })) {
  rows.push(...(await page.extract(schema)).rows);
}
// { loadMore: 'button.more' }   clicks until the button goes
// { scroll: true }               infinite scroll
```

It stops when the control is gone or disabled, when a step changes nothing, or at `maxPages`. Without a browser, it follows the Next link's href:

```ts
for await (const page of wraith.paginate(url, { next: 'li.next a' })) { /* page is a StaticPage */ }
```

## Consent banners

```ts
const wraith = createWraith({ consent: 'reject' });   // or 'accept'
const page = await wraith.open(url);
await page.waitForConsent();              // optional: { cmp, done, succeeded, hiddenOnly }
```

This uses DuckDuckGo's autoconsent rules (hundreds of consent platforms, in pages and iframes), plus its heuristic for custom banners. `'reject'` never clicks a banner's only Accept button. When there's no reject option it clicks an "OK"/"Got it" acknowledgement, or leaves the banner alone. The banner is answered with a DOM click, not a humanized one. It's off by default.

## CAPTCHAs and verification codes

wraith doesn't solve CAPTCHAs. It hands them to a person and carries on afterwards. `detectChallenge()` finds reCAPTCHA, hCaptcha, Turnstile, GeeTest, image CAPTCHAs, Cloudflare browser checks and one-time-code prompts. It ignores invisible and already-solved widgets, and returns a PNG of the challenge:

```ts
const challenge = await page.detectChallenge();
// { kind: 'captcha' | 'otp' | 'browser-check', provider, message, image: Buffer, answerable, url }
```

`handoff()` gets a person through it. Their answer is typed in and submitted, and if the site rejects it they're asked again (up to three times). Otherwise wraith waits while they solve it in the browser window.

```ts
await page.handoff();   // visible browser: solve it in the window. Headless: answer in this terminal (the image path is printed)

// Or ask them anywhere: your app, a chat bot, your phone.
createWraith({
  handoff: {
    auto: true,                                   // check after every navigation and action
    onChallenge: async (challenge) => askMyTeam(challenge.message, challenge.image),  // return the answer, or nothing once handled
    timeout: 300_000,
  },
});
```

Widgets like reCAPTCHA need clicks, so they can only be solved in a visible browser (`headless: false`). Image CAPTCHAs and one-time codes can be answered from anywhere.

## Crawling

```ts
const { results, errors } = await wraith.crawl({
  start: 'https://books.toscrape.com/',
  mode: 'static',             // or 'browser' (default) for JavaScript sites
  maxPages: 100,
  maxDepth: 2,
  include: /\/catalogue\//,   // RegExp or (url) => boolean; exclude works the same way
  concurrency: 3,
  handler: async ({ page, url, depth, enqueue }) => page.extract({ title: 'h1' }),
});
```

The crawl follows same-origin links automatically (`followLinks: false` lets you choose links with `enqueue`). A failed page is recorded in `errors` and doesn't stop the crawl.

## AI

```ts
import { createWraith, z } from 'wraithjs';

const wraith = createWraith({
  ai: { provider: 'ollama', model: 'qwen2.5:7b' },
  // ai: { provider: 'anthropic' },                                            // ANTHROPIC_API_KEY
  // ai: { provider: 'openai', model: '<model>' },                             // OPENAI_API_KEY
  // ai: { provider: 'openai', model: '<model>', baseURL: 'http://localhost:1234/v1' }, // LM Studio etc.
});
```

Use the `z` that wraith exports, so your schemas and wraith share one zod instance.

**Extract into a schema.** The reply is validated with zod. If it doesn't fit, the model sees the errors and gets one chance to correct itself.

```ts
const page = await wraith.fetch('https://books.toscrape.com/');
const { books } = await page.ai.extract(
  z.object({ books: z.array(z.object({ title: z.string(), price: z.number() })) }),
  { selector: 'ol.row', instruction: 'Price as a number in pounds' },
);
```

**Ask a question:** `await page.ai.ask('What is the return policy?')`.

**Act on plain-language instructions** (browser pages). On each step the model sees the page's interactive elements and picks one action. wraith performs it with the page's human behaviour, and the loop continues until the model reports the task done.

```ts
const result = await page.ai.act('Log in with username %user% and password %pass%', {
  variables: { user: process.env.SITE_USER!, pass: process.env.SITE_PASS! },
  maxSteps: 5,
});
// result.success, result.message, result.steps
```

`variables` are substituted only when the action runs, so the model never sees them. It also never sees what is typed in form fields, only whether each field is empty or filled.

**For content you already have:** `wraith.ai.extract(text, schema)` and `wraith.ai.ask(question, text)`.

**Provider notes**

- **anthropic** defaults to `claude-opus-5-5` at `effort: 'medium'`, using structured outputs, so replies always match the schema. If the model declines a request, it is retried on Anthropic's recommended fallback model (`fallbacks: false` turns this off).
- **ollama** sends your schema as Ollama's `format`, and requests a 16k context (`numCtx`), because Ollama's default context is too small for most pages. On a CPU-only machine, expect minutes per call for a full page; narrow the input with `selector`.
- **openai** works with any server that implements chat completions. Use `jsonMode: 'json_object'` if a server rejects `json_schema`.
- **custom**: `{ provider: 'custom', complete: async ({ system, prompt, schema }) => '...' }`.

Pages longer than `ai.maxInputChars` are rejected with an error rather than silently cut short. Pass `selector` to send part of a page. Page content is always marked to the model as untrusted, so instructions hidden in a page are ignored.

## Network and politeness

```ts
createWraith({
  network: {
    timeout: 30_000,
    retries: 2,                       // network errors, timeouts, 408/425/429/5xx; exponential backoff
    rateLimit: { concurrency: 2, maxRequests: 4, intervalMs: 1000 }, // per host; false to disable
    respectRobotsTxt: true,           // throws RobotsDisallowedError; honours Crawl-delay
    userAgent: 'my-bot/1.0 (+https://example.com/bot)',
    headers: { 'accept-language': 'en' },
  },
});
```

## Browser options and sessions

```ts
createWraith({
  browser: 'chromium',               // or 'firefox' | 'webkit' (install it with npx playwright install firefox)
  headless: false,                   // watch it work
  context: {                         // passed to Playwright's newContext()
    viewport: { width: 1366, height: 768 },
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    proxy: { server: 'http://proxy:8080' },
    storageState: 'session.json',    // reuse a saved login
  },
  blockResources: ['image', 'font', 'media'], // faster scraping
});

await wraith.saveSession('session.json'); // cookies + localStorage
```

One `Wraith` holds one browser and one context, so its pages share cookies. Create another `Wraith` for an isolated session. Anything wraith doesn't cover is available through Playwright: `page.raw` is the Playwright `Page`, and `wraith.context()` the `BrowserContext`.

## API reference

Everything below is exported from `wraithjs`. Times are in milliseconds.

### createWraith options

`createWraith(options?: WraithOptions): Wraith`. Nothing launches until the first browser page is opened.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `human` | `boolean \| 'off' \| 'fast' \| 'natural' \| 'careful' \| { preset?, ...settings }` | `'natural'` | [Human behaviour](#human-behaviour) |
| `browser` | `'chromium' \| 'firefox' \| 'webkit'` | `'chromium'` | |
| `headless` | `boolean` | `true` | `false` opens a visible window |
| `launch` | Playwright `LaunchOptions` | | Passed to `browserType.launch()` |
| `context` | Playwright `BrowserContextOptions` | | Viewport, user agent, locale, timezone, proxy, `storageState`… |
| `blockResources` | `('image' \| 'media' \| 'font' \| 'stylesheet')[]` | none | Don't download these in browser pages |
| `network` | see below | | Timeouts, retries, rate limit, robots.txt |
| `waits.afterAction` | `'navigation' \| 'settle' \| 'none'` | `'navigation'` | What clicks, key presses and selects wait for afterwards |
| `waits.settle` | `{ networkIdleMs, domIdleMs, loaders, timeout }` | `500`, `300`, built-ins, `15000` | Defaults for `waitForSettled()` and `'settle'` |
| `consent` | `false \| 'reject' \| 'accept'` | `false` | [Consent banners](#consent-banners) |
| `handoff` | see below | | [CAPTCHAs and verification codes](#captchas-and-verification-codes) |
| `ai` | [AI options](#ai-options) | | Turns on `page.ai` and `wraith.ai` |
| `seed` | `number` | random | Makes every random choice reproducible |
| `logger` | `boolean \| Logger` | silent | `true` logs to the console; so does setting `WRAITH_DEBUG=1` |

`network`:

| Option | Type | Default | |
| --- | --- | --- | --- |
| `timeout` | `number` | `30000` | Navigation, request and action timeout |
| `retries` | `number` | `2` | For network errors, timeouts and 408/425/429/5xx, with exponential backoff |
| `rateLimit` | `false \| { concurrency, maxRequests, intervalMs }` | `2`, `4`, `1000` | Per host: requests at once, and at most `maxRequests` per `intervalMs` |
| `respectRobotsTxt` | `boolean` | `false` | Throw `RobotsDisallowedError` for disallowed URLs; a Crawl-delay replaces the rate limit |
| `userAgent` | `string` | | For static fetches and robots.txt matching. Browser pages use `context.userAgent` |
| `headers` | `Record<string, string>` | | Extra headers for static fetches |

`handoff`:

| Option | Type | Default | |
| --- | --- | --- | --- |
| `auto` | `boolean` | `false` | Check for a challenge after every navigation and action |
| `onChallenge` | `(challenge: Challenge) => string \| void \| Promise<string \| void>` | the browser window, or a terminal prompt when headless | Return the answer to have it typed in, or nothing once the person has dealt with it |
| `timeout` | `number` | `300000` | How long to wait for the person |
| `submit` | `boolean` | `true` | Press Enter after typing the answer |

### Wraith class

`createWraith()` returns a `Wraith`.

| Member | Returns | |
| --- | --- | --- |
| `open(url, { waitUntil?, timeout?, human? })` | `Promise<WraithPage>` | New tab, then `goto(url)` |
| `newPage({ human? })` | `Promise<WraithPage>` | New blank tab; `human` overrides the setting for this page |
| `fetch(url, { method?, headers?, body?, timeout? })` | `Promise<StaticPage>` | HTTP request without a browser |
| `paginate(url, { next, maxPages = 10 })` | `AsyncGenerator<StaticPage>` | Follows Next links without a browser. `next` is a selector (its href is used), any [field spec](#selector-schemas) that yields a URL, or `(page) => url` |
| `crawl(options)` | `Promise<CrawlResult>` | See below |
| `saveSession(path)` | `Promise<void>` | Saves cookies and localStorage; load with `context: { storageState: path }` |
| `context()` | `Promise<BrowserContext>` | The Playwright context, launching the browser if needed |
| `ai` | `AIClient` | `ai.extract(content, schema, { instruction? })`, `ai.ask(question, content?)`. Needs `ai` |
| `close()` | `Promise<void>` | Closes the browser. Static fetches still work; a new browser page relaunches it |

`crawl()` options:

| Option | Type | Default | |
| --- | --- | --- | --- |
| `start` | `string \| string[]` | required | Always visited, whatever the filters say |
| `handler` | `({ page, url, depth, enqueue }) => T \| Promise<T>` | required | Its return value goes into `results` |
| `mode` | `'browser' \| 'static'` | `'browser'` | `page` is a `WraithPage` or a `StaticPage` |
| `maxPages` | `number` | `50` | |
| `maxDepth` | `number` | `2` | Links away from a start URL |
| `followLinks` | `boolean` | `true` | Off: only URLs you `enqueue()` are visited |
| `sameOrigin` | `boolean` | `true` | Only the start URLs' origins |
| `include`, `exclude` | `RegExp \| (url) => boolean` | | URL filters |
| `concurrency` | `number` | `3` | Pages at once; the per-host rate limit still applies |
| `onError` | `(url, error) => void` | | Failures are also collected in `errors` |

### WraithPage

A target is a selector, a Playwright `Locator`, or a [TargetQuery](#targets). Actions wait for their target to be ready, up to `network.timeout` unless you pass `timeout`.

**Navigation**

| Method | Returns | |
| --- | --- | --- |
| `goto(url, { waitUntil = 'load', timeout? })` | `Promise<Response \| null>` | Rate limit, retries and robots.txt apply. `waitUntil`: `'load' \| 'domcontentloaded' \| 'networkidle' \| 'commit'` |
| `url()` | `string` | |
| `title()` | `Promise<string>` | |
| `close()` | `Promise<void>` | Closes the tab |

**Input**

| Method | Returns | |
| --- | --- | --- |
| `click(target, { button?, clickCount?, timeout? })` | `Promise<void>` | Waits until clickable, moves the mouse, clicks, then waits as `afterAction` says |
| `dblclick(target, { button?, timeout? })` | `Promise<void>` | |
| `hover(target, { timeout? })` | `Promise<void>` | |
| `type(target, text, { clear = true, typos = true, timeout? })` | `Promise<void>` | Clicks the field and types key by key. Turn `typos` off for fields that reformat as you type |
| `fill(target, value, { timeout? })` | `Promise<void>` | Sets the value instantly |
| `press(key, { target?, timeout? })` | `Promise<void>` | `'Enter'`, `'Tab'`, `'ControlOrMeta+A'`… on `target` or whatever has focus |
| `select(target, values, { timeout? })` | `Promise<void>` | `<select>` options by value or label; `values` is a string or array |
| `check(target, checked = true, { timeout? })` | `Promise<void>` | Clicks only if the state needs to change |
| `scroll({ by } \| { to: 'top' \| 'bottom' \| target })` | `Promise<void>` | Wheel scrolling; `by` is in pixels, negative is up |
| `autoScroll({ maxScrolls = 20, idleMs = 2000 })` | `Promise<number>` | Scrolls while the page keeps growing; returns the number of scrolls |
| `read({ maxMs = 20000 })` | `Promise<void>` | Scrolls through at reading speed. Does nothing with `human: 'off'` |
| `paginate({ next \| loadMore \| scroll, maxPages = 10, waitMs = 5000 })` | `AsyncGenerator<number>` | Yields 1, 2, 3… as each page or batch is ready |

**Waiting**

| Method | Returns | |
| --- | --- | --- |
| `wait(ms \| [min, max])` | `Promise<void>` | Fixed or random pause |
| `waitFor(target, { state = 'visible', timeout? })` | `Promise<void>` | `state`: `'visible' \| 'hidden' \| 'attached' \| 'detached'` |
| `waitForSettled({ networkIdleMs?, domIdleMs?, loaders?, timeout? })` | `Promise<boolean>` | `false` if the page didn't go quiet in time |
| `waitForText(text, { within?, timeout? })` | `Promise<void>` | A string matches as a case-insensitive substring; or a RegExp |
| `waitForUrl(url, { timeout? })` | `Promise<void>` | A glob such as `'**/done'`, a RegExp, or `(url: URL) => boolean` |
| `waitUntil(condition, { timeout = 10000, interval = 200, message? })` | `Promise<T>` | Polls until `condition` returns something truthy, and returns it. Throws `WaitTimeoutError` |

**Reading**

| Method | Returns | |
| --- | --- | --- |
| `extract(schema)` | `Promise<InferSchema<S>>` | [Selector schemas](#selector-schemas) |
| `structuredData()` | `Promise<StructuredData>` | JSON-LD, microdata, OpenGraph, meta tags, embedded JSON, app state |
| `captureJson(match)` | `JsonCapture` | Collects matching JSON responses from now on. [JsonCapture](#jsoncapture) |
| `text(selector?)` | `Promise<string>` | Visible text with whitespace collapsed. Throws if `selector` matches nothing |
| `markdown(selector?)` | `Promise<string>` | Clean Markdown, with absolute links |
| `html(selector?)` | `Promise<string>` | The page, or the outer HTML of the first match |
| `links()` | `Promise<string[]>` | Every http(s) link, absolute and de-duplicated |
| `screenshot(options?)` | `Promise<Buffer>` | Playwright screenshot options, such as `{ fullPage: true }` |

**Consent, challenges and AI**

| Member | Returns | |
| --- | --- | --- |
| `waitForConsent({ timeout = 5000 })` | `Promise<ConsentStatus>` | Needs the `consent` option. Timing out is normal on pages without a banner |
| `consentStatus()` | `ConsentStatus` | |
| `detectChallenge()` | `Promise<Challenge \| null>` | Finds a CAPTCHA, browser check or code prompt, with a PNG. Changes nothing |
| `handoff(options?)` | `Promise<Challenge \| null>` | Gets a person through it. Same options as `handoff` above |
| `ai.extract(schema, { instruction?, selector? })` | `Promise<z.infer<S>>` | Needs the `ai` option |
| `ai.ask(question, { selector? })` | `Promise<string>` | |
| `ai.act(instruction, { maxSteps = 5, variables?, timeout = 10000 })` | `Promise<ActResult>` | Browser pages only |
| `raw` | Playwright `Page` | For anything not covered here |
| `human` | `Humanizer` | The page's input driver: `human.click(locator)`, `human.moveTo({ x, y })`… |

### StaticPage

| Member | Type | |
| --- | --- | --- |
| `url` | `string` | The final URL, after redirects |
| `status`, `ok` | `number`, `boolean` | `ok` is true for 2xx |
| `headers` | `Headers` | |
| `body` | `string` | The raw response |
| `$` | cheerio `CheerioAPI` | For anything the helpers don't cover |
| `extract(schema)` | `InferSchema<S>` | Synchronous |
| `structuredData()` | `StructuredData` | |
| `links()`, `text(selector?)`, `markdown(selector?)` | | As on `WraithPage`, but synchronous |
| `json<T>()` | `T` | Parses the body as JSON |
| `ai.extract(schema, options?)`, `ai.ask(question, options?)` | | Needs the `ai` option |

### Targets

Anything that takes a target accepts a CSS or Playwright selector string (`'#save'`, `'text=Save'`), a Playwright `Locator`, or a `TargetQuery`. A query needs exactly one of the first seven keys.

| Key | Finds |
| --- | --- |
| `role` (with `name`) | By ARIA role: `'button'`, `'link'`, `'textbox'`, `'checkbox'`, `'navigation'`… `name` is the accessible name, such as a button's text |
| `label` | A form field by its label |
| `text` | An element by its text |
| `placeholder` | A field by its placeholder |
| `alt` | An image by its alt text |
| `title` | An element by its title attribute |
| `testId` | An element by `data-testid` |
| `exact` | Match strings exactly (case and whole text) instead of as case-insensitive substrings |
| `within` | Only look inside this target |
| `nth` | Which match to use, from 0. Default: the first |

String values can also be RegExps: `{ role: 'button', name: /sign in/i }`.

### Selector schemas

A schema maps result keys to field specs. A field spec is one of:

- **A string:** a selector whose trimmed text is returned. Add `@attr` to read an attribute: `'a.next@href'`.
- **A value field:** an object with these keys.

  | Key | |
  | --- | --- |
  | `selector` | CSS selector inside the parent. Leave out to read the parent itself |
  | `attr` | Read this attribute instead of the text. `href`, `src`, `action` and `poster` become absolute URLs |
  | `html` | Read inner HTML instead of text |
  | `list` | Return every match as an array instead of the first |
  | `transform` | `(value: string) => unknown`, applied to each value |
  | `default` | Returned when nothing matches, instead of `null`. Ignored for lists |
  | `text` | Match elements by their own text: a string matches the whole text, ignoring case and extra spaces; a RegExp is tested against it |
  | `near` | Read the value next to a label: `{ near: 'Price' }` on "Price: ₹499" gives "₹499". Also dt/dd, th/td and label/value pairs |

- **A nested field:** `{ selector, fields, list? }` reads `fields` inside each match, giving an object (or array of objects).

Result types: a string spec gives `string | null`; `list: true` gives an array; `transform` gives its return type; `default` replaces `null` with the default's type; a nested field gives an object, or `null` when nothing matches. `extractHtml(html, schema, baseUrl?)` runs a schema over any HTML string.

### JsonCapture

Returned by `page.captureJson(match)`, where `match` is a URL substring, a RegExp, or `(response) => boolean`. Only successful JSON responses are collected.

| Member | |
| --- | --- |
| `items` | `{ url, method, status, data }[]`, in the order they arrived |
| `data` | Just the parsed bodies |
| `waitFor(count = 1, { timeout = 30000 })` | Resolves once `count` responses have arrived in total. Throws `WaitTimeoutError` |
| `next({ timeout = 30000 })` | The next response after this call |
| `stop()` | Stops capturing; `items` stays |

### AI options

| Provider | Options | Default model | API key |
| --- | --- | --- | --- |
| `'anthropic'` | `model`, `apiKey`, `effort` (`'low'` … `'max'`, default `'medium'`), `fallbacks` (default `true`), `baseURL` | `claude-opus-5-5` | `ANTHROPIC_API_KEY`, or an `ant auth login` profile |
| `'openai'` | `model` (required), `apiKey`, `baseURL`, `jsonMode` (`'json_schema'` default, or `'json_object'`) | | `OPENAI_API_KEY`; local servers usually need none |
| `'ollama'` | `model` (required), `host` (default `OLLAMA_HOST` or `http://localhost:11434`), `numCtx` (default `16384`) | | none |
| `'custom'` | `complete(request) => Promise<string \| { text, data }>`, `model`, `strictJson` | | |

Every provider also takes `maxInputChars`: longer content is refused, not cut. Defaults: anthropic 400,000; openai 200,000; ollama 48,000; custom 100,000.

### Result types

- **`Challenge`**: `{ kind: 'captcha' | 'otp' | 'browser-check', provider, url, message, image: Buffer, answerable }`. `provider` is `'recaptcha' | 'hcaptcha' | 'turnstile' | 'geetest' | 'image' | 'cloudflare' | 'otp'`. `answerable` is true when typing an answer solves it.
- **`ConsentStatus`**: `{ cmp: string | null, done, succeeded: boolean | null, hiddenOnly }`. `hiddenOnly` means the banner was hidden with CSS without recording a choice.
- **`ActResult`**: `{ success, message, steps }`. Each step is `{ action: 'click' | 'type' | 'select' | 'press' | 'scroll', element?, value?, reason, error? }`, with `%variables%` left unfilled.
- **`CrawlResult<T>`**: `{ results: { url, depth, data: T }[], errors: { url, error }[] }`.
- **`StructuredData`**: `{ jsonLd, microdata, openGraph, meta, embedded }`. `jsonLdOfType(data, 'Product')` picks JSON-LD objects by `@type`.

### Errors

Every error wraith throws extends `WraithError`.

| Error | When |
| --- | --- |
| `HttpError` | A response was still 408/425/429/5xx after the retries. Has `status` and `url` |
| `RobotsDisallowedError` | robots.txt disallows the URL (with `respectRobotsTxt`). Has `url` |
| `WaitTimeoutError` | `waitUntil()` or a `JsonCapture` wait ran out of time |
| `ChallengeError` | A challenge couldn't be handed to anyone, or wasn't dealt with in time |
| `AIError` | A provider failed, refused, or replied outside the schema |
| `MissingDependencyError` | An optional package, such as `@anthropic-ai/sdk`, isn't installed. Has `packageName` |

Playwright's own errors, such as its `TimeoutError` when an element never appears, pass through unchanged.

### Other exports

- `z`: the zod instance wraith uses.
- `waitUntil(condition, options)`: the standalone polling helper. `DEFAULT_LOADERS` lists the built-in loader selectors.
- `htmlToMarkdown(html, { selector?, baseUrl? })`, `htmlToText(html, selector?)`, `extractHtml(html, schema, baseUrl?)`, `jsonLdOfType(data, type)`.
- `humanPresets`, `Humanizer`, `humanPath`, `pointInBox`, `createRng`, `sleep`: the human-behaviour building blocks.
- `AIClient`, `createProvider`, `createAnthropicProvider`, `createOpenAIProvider`, `createOllamaProvider`, and the `AIProvider` interface for plugging in your own model.
- `consoleLogger`, `silentLogger` and the `Logger` interface.

## Troubleshooting

**`browserType.launch: Executable doesn't exist`.** The browser isn't downloaded. Run `npx playwright install chromium` (or `firefox`, `webkit`) in your project.

**`ERR_REQUIRE_ESM` or "require() of ES Module".** wraith is ESM only. Use `import` with `"type": "module"` in your `package.json` (or `.mjs` files). From CommonJS, load it with `const { createWraith } = await import('wraithjs')`.

**`headless: false` fails with "Looks like you launched a headed browser without having a XServer running".** There's no screen, as on most servers and in CI. Keep the default `headless: true`, or run under `xvfb-run`.

**"Target page, context or browser has been closed".** The page or browser was closed while still in use: its window was closed by hand, `close()` was called, or the browser crashed. Open a new page.

**A click times out.** wraith waits until the element is visible, enabled, still and uncovered. The usual causes are a cookie banner or overlay on top of it (try `consent: 'reject'`), a button that stays disabled, or a target matching a different element than you expect (`{ role, name }` targets are often more precise than CSS).

**`waitForSettled()` returns `false`.** The page never went quiet: it polls, animates or streams. That's fine to ignore. To settle sooner, lower `networkIdleMs` or set `loaders: false`, or wait for the specific thing you need with `waitForText()` or `waitFor()`.

**The process doesn't exit.** Call `await wraith.close()`, ideally in a `finally` block.

**AI calls fail with "over the limit".** The page is longer than `maxInputChars`. Pass `{ selector }` to send only the relevant part. On CPU-only Ollama, large pages can take minutes; a selector helps there too.

**`MissingDependencyError`.** Install the provider's SDK: `npm install @anthropic-ai/sdk` or `npm install openai`.

Set `WRAITH_DEBUG=1` (or `logger: true`) to see retries, robots.txt decisions, consent handling and other events.

## Use responsibly

Check a site's terms before you scrape it, keep the rate limit on, and consider `respectRobotsTxt: true`. Human-like input is for making automation behave naturally. It doesn't give you permission to access anything, and wraith deliberately doesn't solve CAPTCHAs.

## Changelog

### 0.1.0-beta.0

First public beta:

- Browser pages with human-like mouse, keyboard and scrolling (presets `off`, `fast`, `natural`, `careful`), and static pages without a browser.
- Typed selector extraction, role/label/text targets, `near` and `text` matchers, structured data, and JSON API capture.
- Waits: clickability checks before every click, `waitForSettled()`, `waitForText()`, `waitForUrl()`, `waitUntil()`, and `waits.afterAction`.
- Pagination in the browser and without one, and breadth-first crawling.
- Consent banners through DuckDuckGo's autoconsent.
- CAPTCHA and one-time-code detection, with hand-off to a person.
- AI extraction, questions and plain-language actions with Anthropic, OpenAI-compatible servers, Ollama, or your own provider.
- Per-host rate limiting, retries with backoff, and optional robots.txt checks.

## Development

To work on wraith itself, in a clone of the repository:

```bash
npm install
npx playwright install chromium
npm test             # unit + browser tests against local servers (no internet or API keys needed)
npm run typecheck
npm run build        # emits dist/
npm run example examples/static-scrape.ts   # also: human-login, crawl, pagination, ai
npm run devtools     # the diagnostic UI at http://127.0.0.1:4477
npm run publish:beta # typecheck, test and build, then publish under the npm "beta" tag
```

**Devtools** (`npm run devtools`) is a local page for running wraith one action at a time and seeing what each did: the result, screenshots with the mouse path drawn on, keystroke timing, network requests and their responses, console output, wraith's log, and the step as code. Its `inspect` action shows which element a target matches and why it can't be clicked; `activity` shows what `waitForSettled()` is waiting for. It's only in the repository, not in the npm package. The server listens on 127.0.0.1 and needs a token only its own page has; set `PORT` to change the port.

The source is in `src/`: `human/` (behaviour and input), `extract/` (selectors, Markdown, structured data), `net/` (rate limiting, retries, robots.txt), `ai/` (providers, extraction, `act`), plus `wait.ts`, `target.ts`, `capture.ts`, `paginate.ts`, `consent.ts`, `handoff.ts`, `page.ts`, `static-page.ts`, `crawl.ts` and `wraith.ts`. Code that runs inside the browser is in `in-page.ts`.

## License

MIT
