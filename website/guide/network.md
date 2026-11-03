# Network and politeness

Every navigation (`goto`, `open`) and every static `fetch` goes through wraith's scheduler: an optional robots.txt check, a per-host rate limit, and retries. The defaults keep you from hammering a site by accident.

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({
  network: {
    timeout: 30_000,
    retries: 2,
    rateLimit: { concurrency: 2, maxRequests: 4, intervalMs: 1000 },
    respectRobotsTxt: true,
    userAgent: 'my-bot/1.0 (+https://example.com/bot)',
    headers: { 'accept-language': 'en' },
  },
});
```

## Rate limit

Requests are queued **per host**. By default, at most 2 run at once and at most 4 start in any second for each host. Different hosts don't wait for each other.

```ts
import { createWraith } from 'wraithjs';

const gentle = createWraith({ network: { rateLimit: { concurrency: 1, maxRequests: 1, intervalMs: 2000 } } });
const unlimited = createWraith({ network: { rateLimit: false } });   // for your own servers and tests
```

The limit applies to wraith's own requests (page loads and fetches), not to the images, scripts and API calls a browser page makes by itself.

## Retries

Network errors, timeouts and responses with status **408, 425, 429 or 5xx** are retried, `retries` times (default 2), with exponential backoff: about 1 second, then 2, then 4, with some randomness. Other statuses, such as 404, aren't retried. Retries happen outside the queue, so a failing host doesn't block other requests.

When retries run out on a bad status, `goto` and `fetch` throw `HttpError`, which has `status` and `url`. Set `WRAITH_DEBUG=1` to see each retry as it happens.

## robots.txt

With `respectRobotsTxt: true`, wraith fetches each origin's robots.txt once, checks every URL against it, and throws `RobotsDisallowedError` for disallowed ones. Matching uses `userAgent` if you set one, otherwise the `*` rules. A missing or unreachable robots.txt allows everything.

If robots.txt has a `Crawl-delay`, it replaces the rate limit for that host: one request at a time, that many seconds apart. (With `rateLimit: false` there's no queue, so Crawl-delay isn't applied either.)

## Timeouts

`timeout` (default 30 seconds) applies to navigations, static fetches, and to waiting for an element before an action. Individual methods accept their own `timeout` to override it.

## Headers and user agent

The top-level `userAgent` option sets the user agent everywhere: browser pages, static fetches and robots.txt. It can also rotate through a list; see [User agents](/guide/proxies#user-agents). `network.headers` adds headers to static fetches; for browser pages, use `context.extraHTTPHeaders`:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({
  userAgent: 'my-bot/1.0 (+https://example.com/bot)',
  network: { headers: { 'accept-language': 'en' } },          // static fetches
  context: { extraHTTPHeaders: { 'accept-language': 'en' } },  // browser pages
});
```

`network.userAgent` still works, for static fetches and robots.txt only.

## Proxies

`proxy` sends page loads, static fetches and robots.txt requests through one or more proxy servers. With a list, each browser instance gets its own proxy and static fetches take turns. See [Proxies and instances](/guide/proxies).

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ proxy: ['http://p1.example.com:8000', 'socks5://p2.example.com:1080'] });
```

## Blocking heavy resources

For scraping, browser pages don't need images, fonts or video. Blocking them saves time and bandwidth:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ blockResources: ['image', 'media', 'font'] });
```

`'stylesheet'` can be blocked too, but some sites hide content until their CSS loads, and visibility checks depend on styles, so test before relying on it.
