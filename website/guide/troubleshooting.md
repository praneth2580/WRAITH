# Troubleshooting

Start by turning on logging: set `WRAITH_DEBUG=1` in the environment, or pass `logger: true` to `createWraith()`. wraith then reports retries, robots.txt decisions, consent handling and other events. To watch what the browser is doing, add `headless: false`.

## Installing and running

### `browserType.launch: Executable doesn't exist`

The browser isn't downloaded. In your project, run:

```bash
npx playwright install chromium     # or firefox / webkit, for those engines
```

Playwright stores browsers per version, so run it again after upgrading wraith or Playwright.

### `ERR_REQUIRE_ESM` or "require() of ES Module"

wraith is ESM only. Either make your project ESM (`"type": "module"` in `package.json`, or `.mjs` files) and use `import`, or load it dynamically from CommonJS:

```js
async function main() {
  const { createWraith } = await import('wraithjs');
  const wraith = createWraith();
  // …
}
```

In TypeScript, use `"module": "NodeNext"` (or `"Node16"`) and `"moduleResolution": "NodeNext"`.

### "Looks like you launched a headed browser without having a XServer running"

`headless: false` needs a screen, and servers and CI machines usually don't have one. Keep the default `headless: true`, or run under a virtual display: `xvfb-run node script.js`.

### The process doesn't exit

The browser is still open. Call `await wraith.close()`, ideally in a `finally` block.

## Pages and actions

### "Target page, context or browser has been closed"

The page or browser was closed while still in use: its window was closed by hand, `page.close()` or `wraith.close()` was called earlier, or the browser crashed. Open a new page with `wraith.open()` or `wraith.newPage()`.

### A click or type times out

wraith waits until the element is visible, enabled, still and uncovered. Usual causes:

- **Something covers it**: a cookie banner (try `consent: 'reject'`), a modal, a sticky header, a loading overlay.
- **It stays disabled**: the form isn't valid yet, or a previous step didn't do what you thought.
- **The target matches a different element** than you expect, often a hidden duplicate (mobile and desktop menus). Prefer `{ role, name }` targets, add `within`, or use `nth`.
- **It's inside an iframe**: build a Playwright locator with `page.raw.frameLocator('iframe#x').locator('button')` and pass that as the target.

The [devtools](/guide/devtools) `inspect` action shows every match, which one wraith uses, and why it isn't clickable.

### `extract()` returns `null` for everything

- The content is rendered by JavaScript, and you used `wraith.fetch()`. Use a browser page.
- The content loads after the page: wait for it first (`waitForSettled()`, `waitFor('.results')`).
- The selector doesn't match. Check it in the browser's console: `document.querySelectorAll('.your-selector')`.

### `waitForSettled()` returns `false`

The page never went quiet within the timeout: it polls, animates or streams. This is often harmless; continue anyway. To settle sooner, lower `networkIdleMs`, pass `loaders: false` if a decorative element matches a loader selector, or wait for the specific thing you need with `waitForText()` or `waitFor()`. The devtools `activity` action shows what was still busy.

### Navigation fails with `HttpError: HTTP 429`

The site is rate limiting you, and the retries didn't help. Slow down: `network: { rateLimit: { concurrency: 1, maxRequests: 1, intervalMs: 3000 } }`.

### "Browsers can't log in to SOCKS proxies"

A browser instance was given a SOCKS5 proxy with a username and password, which browsers don't support. Use an HTTP proxy with that login for browser pages. The SOCKS proxy still works for static fetches.

### Pages fail with `net::ERR_PROXY_CONNECTION_FAILED` or HTTP 407

The proxy is unreachable, or rejected the login (407 Proxy Authentication Required). Check the host, port and credentials, and encode special characters in a URL login (`p%40ss` for `p@ss`), or pass `username` and `password` separately.

### `HoneypotError`

`avoidHoneypots` is on, and the element is one a person couldn't see; the message says why (transparent, off the page, clipped…). If it's content that appears after a hover, click or scroll, do that first. If it's legitimate and always hidden, turn the option off for that page's work. `page.honeypots()` lists what the page has.

### `RobotsDisallowedError`

`respectRobotsTxt` is on and the site's robots.txt disallows that URL for your user agent. Respect it, or ask the site's owner.

## AI

### "The content is … characters, over the limit"

The page is longer than the provider's `maxInputChars`. Pass `{ selector }` to send only the relevant part, or raise `ai.maxInputChars` if your model's context allows.

### Ollama calls take minutes

On a machine without a GPU, a 7B model processes a full page slowly. Narrow the input with `selector`, use a smaller model, or use a hosted provider for large pages.

### `MissingDependencyError`

The provider's SDK isn't installed: `npm install @anthropic-ai/sdk` or `npm install openai`.

### `AIError`

The provider failed, refused, or replied with something that didn't match your schema even after a correction round. The message says which. Simpler schemas, `.describe()` hints on fields, and a narrower `selector` all help.

## Still stuck?

Open an issue on [GitHub](https://github.com/praneth2580/WRAITH/issues) with the wraith version, a minimal script, and the output with `WRAITH_DEBUG=1`.
