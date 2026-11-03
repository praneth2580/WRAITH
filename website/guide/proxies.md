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

For browser pages, the user agent changes the `User-Agent` header and `navigator.userAgent`, not the browser underneath. `navigator.platform`, client hints such as `Sec-CH-UA`, and other properties still describe the real browser and machine, so a site that cross-checks them can tell. For the most consistent identity in a browser, leave `userAgent` unset or pick agents matching the machine wraith runs on.

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
