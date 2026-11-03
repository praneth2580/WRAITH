# Browser options and sessions

wraith uses [Playwright](https://playwright.dev) to drive the browser, and passes its options through, so anything Playwright can configure, wraith can too.

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({
  browser: 'chromium',
  headless: false,
  launch: { slowMo: 50 },
  context: {
    viewport: { width: 1366, height: 768 },
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    geolocation: { latitude: 51.5, longitude: -0.12 },
    permissions: ['geolocation'],
  },
});
```

## Engines

`browser` is `'chromium'` (default), `'firefox'` or `'webkit'` (Safari's engine). Install each one you use:

```bash
npx playwright install chromium firefox webkit
```

To drive an installed Chrome or Edge instead of Playwright's Chromium, pass a channel: `launch: { channel: 'chrome' }`.

## Headless or visible

Pages run headless (no window) by default. `headless: false` opens a real window, which is useful while developing and needed for [solving CAPTCHA widgets by hand](/guide/captchas). A visible browser needs a display: on servers and in CI, keep headless, or run under `xvfb-run`.

## Context options

`context` is passed to Playwright's [`browser.newContext()`](https://playwright.dev/docs/api/class-browser#browser-new-context). The most useful ones:

| Option | |
| --- | --- |
| `viewport` | `{ width, height }`. Default 1280×720 |
| `userAgent` | The browser's user agent string |
| `locale`, `timezoneId` | Language and time zone, such as `'en-IN'` and `'Asia/Kolkata'` |
| `proxy` | `{ server, username?, password? }` |
| `storageState` | A saved session to start from (see below) |
| `extraHTTPHeaders` | Headers sent with every request |
| `geolocation`, `permissions` | A location, and permission to read it |
| `colorScheme` | `'light'` or `'dark'` |
| `deviceScaleFactor`, `isMobile`, `hasTouch` | For emulating phones |

To emulate a specific phone, spread one of Playwright's device descriptors:

```ts
import { devices } from 'playwright';
import { createWraith } from 'wraithjs';

const wraith = createWraith({ context: { ...devices['Pixel 7'] } });
```

## Proxies

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({
  context: { proxy: { server: 'http://proxy.example.com:8080', username: 'user', password: 'pass' } },
});
```

This proxies browser pages. Static `fetch()` uses Node's built-in fetch, which doesn't go through it.

## Sessions

Log in once, save the session, and reuse it in later runs instead of logging in every time:

```ts
import { createWraith } from 'wraithjs';

const first = createWraith();
const page = await first.open('https://example.com/login');
// …log in…
await first.saveSession('session.json');      // cookies and localStorage
await first.close();

const later = createWraith({ context: { storageState: 'session.json' } });
```

`session.json` contains login cookies: keep it out of version control.

All pages from one `Wraith` share one browser context, so they share cookies. For separate sessions side by side (two accounts, say), create two `Wraith`s.

## Going lower level

- `page.raw` is the Playwright `Page`: `page.raw.route()`, `page.raw.on('dialog', …)`, `page.raw.pdf()`…
- `await wraith.context()` is the Playwright `BrowserContext`, launching the browser if needed: `addCookies()`, `grantPermissions()`, `tracing.start()`…

Actions you take through Playwright directly aren't humanized.
