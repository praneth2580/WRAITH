# Changelog

wraith follows [semantic versioning](https://semver.org). While it's in beta (`0.x` pre-releases), any release may change the API; changes will be listed here.

## 0.1.0-beta.0

First public beta.

**Pages**

- Browser pages through Playwright (Chromium, Firefox, WebKit), and static pages without a browser, sharing one extraction API.
- `paginate()` in the browser (Next, Load more, infinite scroll) and without one; breadth-first `crawl()`.

**Human behaviour**

- Curved mouse paths with Fitts's-law timing, overshoot and jitter; key-by-key typing with corrected typos; wheel scrolling; reading pauses.
- Presets `off`, `fast`, `natural` and `careful`, every setting adjustable, and a `seed` for reproducible runs.

**Extraction**

- Typed selector schemas with lists, nested fields, transforms and defaults.
- `near` and `text` matchers; role, label and text targets for sites with generated class names.
- `structuredData()` (JSON-LD, microdata, OpenGraph, meta tags, embedded JSON, app state) and `captureJson()`.

**Waiting**

- Clickability checks before every click: visible, still, enabled and uncovered.
- `waitForSettled()`, `waitForText()`, `waitForUrl()`, `waitUntil()`, and `waits.afterAction`.

**Interruptions**

- Consent banners answered with DuckDuckGo's autoconsent (`consent: 'reject' | 'accept'`).
- CAPTCHA and one-time-code detection with a PNG of the challenge, and hand-off to a person.

**AI**

- `ai.extract()`, `ai.ask()` and `ai.act()` with Anthropic, OpenAI-compatible servers, Ollama, or your own provider; secrets passed as `%variables%`.

**Network**

- Per-host rate limiting, retries with exponential backoff, optional robots.txt checks with Crawl-delay.
- Proxies (HTTP, HTTPS, SOCKS5) for browser pages, static fetches and robots.txt, rotated from a list.

- User agents from a list or a built-in set of current browsers (`userAgent: 'rotate'`), one per instance and per proxy.

**Honeypots**

- `avoidHoneypots`: actions refuse elements hidden from people (`HoneypotError`), `links()` and crawls skip hidden links, and `ai.act()` never sees them. `page.honeypots()` lists them with reasons.

**Instances**

- Several independent browser sessions per `Wraith` (`instances`), as contexts in one browser or as separate browsers. Pages go to the least busy instance, or the one you choose; a crashed instance restarts on next use.
