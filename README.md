# wraith

Web scraping and browser automation for Node.js, with human-like input you can tune or switch off, and optional AI from a local model or an API key. Everything runs in your own process: there's no server and no hosted service.

- **Human behaviour, one option away.** Curved mouse paths with Fitts's-law timing and occasional overshoot, typing with corrected typos, wheel scrolling, reading pauses, and random delays between actions. Pick a preset or adjust any knob.
- **Two ways to load a page.** A real browser (Playwright) for JavaScript-heavy sites, or a plain HTTP fetch, which is much faster, for pages that don't need JavaScript. Both use the same extraction API.
- **Selector extraction with inferred types.** Describe the data with CSS selectors and get typed results back.
- **Polite by default.** A per-host rate limit, retries with backoff, and optional robots.txt checks (including Crawl-delay).
- **Waits that understand the page.** Clicks wait until a button is enabled and uncovered. `waitForSettled()` waits for requests, spinners and skeletons to finish.
- **Robust to generated class names.** Find elements by role, label or text; read values next to their labels; pull JSON-LD, embedded app state, or the site's own API responses.
- **Consent banners, pagination and hand-off.** Reject (or accept) cookie banners automatically, page through "Next", "Load more" and infinite scroll, and hand CAPTCHAs and one-time codes to a person.
- **Optional AI.** Extract into a zod schema, ask questions about a page, or give plain-language instructions ("log in with %user%"). Works with Ollama (local), Claude, OpenAI, and any OpenAI-compatible server such as LM Studio, vLLM or OpenRouter.

It builds on existing libraries rather than reinventing them: [Playwright](https://playwright.dev), [cheerio](https://cheerio.js.org), [zod](https://zod.dev), [p-queue](https://github.com/sindresorhus/p-queue), [p-retry](https://github.com/sindresorhus/p-retry), [robots-parser](https://github.com/samclarke/robots-parser), [node-html-markdown](https://github.com/crosstype/node-html-markdown) and DuckDuckGo's [autoconsent](https://github.com/duckduckgo/autoconsent).

## Install

```bash
npm install wraithjs
npx playwright install chromium   # once, for browser pages
```

Requires Node.js 20.18.1 or later. The package is ESM-only.

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

await wraith.close();
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

All the settings (times in ms, ranges are `[min, max]`):

| Setting | What it controls |
| --- | --- |
| `actionDelay` | Pause before each click, type, select or press |
| `mouse.enabled` | Move along a path before clicking; `false` clicks without moving |
| `mouse.speed` | 1 is an average person; 2 is twice as fast |
| `mouse.overshootChance` | Chance of overshooting a distant target, then correcting |
| `mouse.jitter` | Pixels of wobble along the path |
| `mouse.hoverDelay`, `mouse.clickHold` | Pause before pressing; how long the button stays down |
| `typing.keyDelay`, `typing.wordPause` | Time per key; extra pause after a space |
| `typing.typoChance` | Chance per letter of hitting a neighbouring key and fixing it with Backspace |
| `scroll.step`, `scroll.stepDelay` | Pixels per wheel tick; pause between ticks |
| `reading.wordsPerMinute` | Pace for `page.read()` |

How it works: before clicking, wraith waits until the element is visible, enabled, no longer moving, and not covered by anything (a loading overlay, say), up to the timeout. It aims at a point near the element's centre, never its edges. The cursor follows a Bézier curve with a minimum-jerk speed profile, and Fitts's law sets how long each move takes. Elements below the fold are reached with wheel ticks, not a scroll jump. Elements inside iframes use Playwright's own click.

## Pages

`wraith.open(url)` and `wraith.newPage()` give you a `WraithPage`:

| Method | |
| --- | --- |
| `goto(url)` | Navigate, with rate limiting, retries and optional robots.txt checks |
| `click(target)`, `dblclick`, `hover` | Humanized mouse |
| `type(target, text, { clear, typos })` | Humanized typing. `fill()` sets a value instantly instead |
| `press(key, { target })`, `select(target, values)`, `check(target, checked?)` | |
| `scroll({ by } \| { to: 'top' \| 'bottom' \| target })` | Wheel scrolling |
| `autoScroll({ maxScrolls, idleMs })` | Keep scrolling while an infinite feed loads more |
| `read({ maxMs })` | Skim the page at reading speed |
| `paginate({ next \| loadMore \| scroll })` | Go through a paginated listing (see Pagination) |
| `wait(ms \| [min, max])`, `waitFor(target, { state })` | |
| `waitForSettled()`, `waitForText()`, `waitForUrl()`, `waitUntil()` | See Waiting |
| `extract(schema)`, `structuredData()`, `captureJson(match)` | See below |
| `links()`, `text()`, `markdown()`, `html()`, `screenshot()` | |
| `waitForConsent()`, `consentStatus()` | See Consent banners |
| `detectChallenge()`, `handoff()` | See CAPTCHAs and verification codes |
| `ai` | AI helpers (below) |
| `raw` | The underlying Playwright `Page`, for anything else |

A `target` is a selector string, a Playwright `Locator`, or a description such as `{ role: 'button', name: 'Sign in' }` (see below). `wraith.fetch(url)` returns a `StaticPage` with `extract`, `structuredData`, `links`, `text`, `markdown`, `json`, `status`, `headers`, `$` (cheerio) and `ai`.

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

The result type is inferred from the schema. For example, `price` is `number | null` and `items` is `{ name: string | null; url: string | null }[]`.

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
createWraith({ consent: 'reject' });   // or 'accept'
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

Pages longer than `ai.maxInputChars` are rejected with an error rather than silently cut short. The defaults are 400k characters for anthropic, 200k for openai and 48k for ollama. Pass `selector` to send part of a page. Page content is always marked to the model as untrusted, so instructions hidden in a page are ignored.

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

## Browser options

```ts
createWraith({
  browser: 'chromium',               // or 'firefox' | 'webkit'
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

## Errors

Every error extends `WraithError`: `HttpError` (retries ran out), `RobotsDisallowedError`, `AIError` (a provider failed, refused, or replied outside the schema), `WaitTimeoutError`, `ChallengeError` (a CAPTCHA or code couldn't be handed off, or wasn't dealt with in time), and `MissingDependencyError` (an optional package isn't installed).

Set `WRAITH_DEBUG=1`, or pass `logger: true`, to see retries and other events.

## Use responsibly

Check a site's terms before you scrape it, keep the rate limit on, and consider `respectRobotsTxt: true`. Human-like input is for making automation behave naturally. It doesn't give you permission to access anything.

## Development

```bash
npm install
npx playwright install chromium
npm test             # unit + browser tests against local servers (no internet or API keys needed)
npm run typecheck
npm run build        # emits dist/
npm run example examples/static-scrape.ts   # also: human-login, crawl, pagination, ai
```

The source lives in `src/`: `human/` (behaviour and input), `extract/` (selectors, Markdown, structured data), `net/` (rate limiting, retries, robots.txt), `ai/` (providers, extraction, `act`), plus `wait.ts`, `target.ts`, `capture.ts`, `paginate.ts`, `consent.ts`, `handoff.ts`, `page.ts`, `static-page.ts`, `crawl.ts` and `wraith.ts`. Code that runs inside the browser lives in `in-page.ts`.
