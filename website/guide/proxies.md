# Proxies, user agents and instances

Three related options:

- **`proxy`** sends traffic through one or more proxy servers: browser pages, static fetches and robots.txt alike.
- **`userAgent`** sets the user agent, or rotates through several.
- **`instances`** runs several independent browser sessions in one `Wraith`, each with its own cookies, storage, cache, proxy and user agent.

## One proxy

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ proxy: 'http://user:pass@proxy.example.com:8080' });
```

A proxy can be written as:

| Form | Example |
| --- | --- |
| HTTP or HTTPS URL | `'http://proxy.example.com:8080'`, `'https://proxy.example.com:443'` |
| SOCKS5 URL | `'socks5://127.0.0.1:1080'` |
| `host:port` | `'proxy.example.com:3128'` (HTTP) |
| With a login | `'http://user:pass@proxy.example.com:8080'`. Encode special characters: `p%40ss` for `p@ss` |
| Settings | `{ server, username?, password?, bypass? }` |

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({
  proxy: {
    server: 'http://proxy.example.com:8080',
    username: process.env.PROXY_USER,
    password: process.env.PROXY_PASS,
    bypass: 'localhost, .internal.example.com',
  },
});
```

`bypass` lists hosts that skip the proxy, separated by commas. A plain host matches exactly, a leading `.` or `*.` matches subdomains, and `<local>` matches hosts without a dot. Keep credentials in environment variables rather than in code.

## Several proxies

Give a list to spread work across proxies:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({
  proxy: [
    'http://user:pass@p1.example.com:8000',
    'http://user:pass@p2.example.com:8000',
    'socks5://p3.example.com:1080',
  ],
});
```

How the list is used:

- **Browser pages:** each [instance](#instances) gets one proxy: instance 0 the first, instance 1 the second, and so on, wrapping round. Unless you set `instances`, there's **one instance per proxy**, so the three proxies above give three sessions.
- **Static fetches and robots.txt:** each request takes the next proxy in turn.

A browser session keeps its proxy for its whole life, because a site would see a session that changes IP address mid-visit as suspicious, and logins often break. For a different proxy, use a different instance.

## User agents

```ts
import { createWraith } from 'wraithjs';

createWraith({ userAgent: 'my-bot/1.0 (+https://example.com/bot)' });   // one for everything
createWraith({ userAgent: ['Mozilla/5.0 (…) Chrome/…', 'Mozilla/5.0 (…) Firefox/…'] });
createWraith({ userAgent: 'rotate' });                                   // a built-in list
```

How a list is used:

- **Static fetches and robots.txt** take the user agents in turn. With proxies, each proxy keeps one user agent, so an address doesn't change browsers between requests.
- **Browser pages:** each instance gets one, the way proxies are assigned: instance 0 the first, instance 1 the second, wrapping round. A list doesn't add instances; set `instances` (or give several proxies) for more.
- A `user-agent` header you pass to `fetch()` yourself always wins.

### The built-in list

`'rotate'` uses current desktop browsers in the formats they send today: Chrome on Windows, macOS and Linux, Edge on Windows, Firefox on Windows, macOS and Linux, and Safari on macOS. The version numbers come from the browsers Playwright installs, so the list stays current when you update Playwright. For browser pages, only agents of the engine you run are used: Chrome for `chromium`, Firefox for `firefox`, Safari for `webkit`.

```ts
import { builtInUserAgents } from 'wraithjs';

console.log(builtInUserAgents('chromium'));
// [ 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', … ]
```

### robots.txt

A single user agent string also names you when matching robots.txt rules, so `userAgent: 'my-bot/1.0'` obeys a `User-agent: my-bot` group. With a list or `'rotate'`, the `*` rules apply.

### What a user agent changes

A browser describes itself in several places besides `User-Agent`, and sites compare them. When they disagree, for example a Windows Chrome user agent with client hints naming HeadlessChrome on Linux, the mismatch alone marks the visitor as automated. So with a Chrome or Edge user agent on Chromium, wraith makes the rest agree:

| | Matches the user agent |
| --- | --- |
| `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` headers | Brand, version and system, with brand lists that follow Chrome's own rules for each version |
| `navigator.userAgentData` | The same, including high-entropy values such as `fullVersionList` and `platformVersion` |
| `navigator.platform` | `Win32`, `MacIntel`, `Linux x86_64`… |
| `Accept-Language`, `navigator.languages` | `context.locale`, which defaults to `en-US` once you set a user agent: `en-US,en;q=0.9` |

This applies to every page in the instance, iframes and popups included, and to `context.userAgent` as well as `userAgent`. Set `context.locale` (and `context.timezoneId`) to match where your proxy is.

**Static fetches** with a browser user agent send the other headers that browser sends: `Accept`, `Accept-Language`, `Upgrade-Insecure-Requests`, client hints and `Sec-Fetch-*`. Client hints and `Sec-Fetch-*` go over HTTPS only, as browsers send them. Headers you pass yourself win, and `network.browserHeaders: false` turns this off.

A user agent that isn't a browser, such as `my-bot/1.0 (+https://example.com/bot)`, changes nothing else. That's the honest choice when you're a crawler and want sites to know it.

What stays the same:

- **Firefox and WebKit** pages get the new `User-Agent` and `navigator.userAgent` only.
- **Static fetches use Node's TLS connection.** Its fingerprint differs from a browser's, and some services check it. For those sites, use a browser page.
- **A popup's first request** goes out with Chromium's own client hints, before wraith can adjust the new tab. Everything after it matches.
- **`navigator.webdriver` stays `true`.** wraith doesn't hide that the browser is automated.

`userAgent` replaces `context.userAgent` and `network.userAgent`; set only one of them.

## Instances

An instance is an independent browser session: its own cookies, localStorage, cache and proxy. Use several for parallel work, or to stay logged in to several accounts at once.

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ instances: 4 });

const urls = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'];
const pages = await Promise.all(urls.map((u) => wraith.open(u)));
console.log(pages.map((p) => p.instance));   // [0, 1, 2]
```

New pages go to the instance with the **fewest open pages**, taking turns between equally busy ones. To choose, pass `instance` (counting from 0):

```ts
const admin = await wraith.open('https://example.com/admin', { instance: 0 });
const customer = await wraith.open('https://example.com/shop', { instance: 1 });
```

Instances are created when first used, so unused ones cost nothing. Each page's `page.instance` says which one it's in. `wraith.instanceCount` is the total.

### Shared or separate browsers

By default, instances are separate contexts in one browser process: light, and as isolated as separate browser profiles for cookies and storage. To give each its own browser process:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ instances: { count: 4, separateBrowsers: true } });
```

Separate browsers use more memory, but a crash only takes down one instance. Either way, if an instance's browser crashes or its context is closed, the next page opened in it starts a fresh one.

### Per-instance sessions

`saveSession()` and `context()` take an instance number:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ instances: 2 });
// …log in to a different account in each instance…
await wraith.saveSession('account-a.json', 0);
await wraith.saveSession('account-b.json', 1);

const cookies = await (await wraith.context(1)).cookies();
```

To restore several saved sessions, create one `Wraith` per session with `context: { storageState }`, since `context` options apply to every instance.

## Crawling with instances

A browser-mode [crawl](/guide/crawling) opens each page with `open()`, so its pages spread across instances automatically. Match `concurrency` to the number of instances:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ proxy: ['http://p1:8000', 'http://p2:8000', 'http://p3:8000'] });
const { results } = await wraith.crawl({
  start: 'https://example.com/',
  concurrency: 3,
  handler: async ({ page }) => page.title(),
});
```

## Rate limits still apply

The per-host [rate limit](/guide/network#rate-limit) is shared by all instances and proxies. Adding instances or proxies makes work run in parallel across different sites, and makes you more resilient, but it doesn't increase the load on any one site. Raise the rate limit deliberately, and only for sites that allow it.

## Limitations

- **SOCKS proxies with a login don't work in browsers.** Chromium, Firefox and WebKit can't log in to SOCKS proxies, so wraith refuses to start a browser instance with one. Use an HTTP proxy for browser pages; SOCKS5 with a login works for static fetches.
- **SOCKS5 for static fetches** uses undici's SOCKS support, which Node marks experimental: it prints a one-time `ExperimentalWarning`.
- **Set the proxy in one place.** `proxy` and `context.proxy` can't both be set.
- **Proxies don't change your browser's location.** The timezone and language come from `context.timezoneId` and `context.locale`; set them to match the proxy.
