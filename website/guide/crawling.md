# Crawling

`wraith.crawl()` visits pages breadth-first from one or more start URLs, runs your handler on each, and follows links within the limits you set. A page that fails is recorded and the crawl carries on.

```ts
const { results, errors } = await wraith.crawl({
  start: 'https://books.toscrape.com/',
  mode: 'static',
  maxPages: 100,
  maxDepth: 2,
  include: /\/catalogue\//,
  handler: async ({ page }) => page.extract({ title: 'h1', price: '.price_color' }),
});

for (const { url, depth, data } of results) console.log(depth, url, data.title);
for (const { url, error } of errors) console.warn('failed', url, error.message);
```

## Modes

| `mode` | `page` in the handler | Use for |
| --- | --- | --- |
| `'browser'` (default) | `WraithPage` | Sites that need JavaScript |
| `'static'` | `StaticPage` | Everything else; many times faster |

In browser mode, each page is opened in its own tab and closed after the handler finishes.

## Choosing what to visit

| Option | Default | |
| --- | --- | --- |
| `maxPages` | `50` | Stop after this many pages |
| `maxDepth` | `2` | How many links away from a start URL to go |
| `sameOrigin` | `true` | Only follow links on the start URLs' origins |
| `include` | | Only visit URLs that match (`RegExp` or `(url) => boolean`) |
| `exclude` | | Never visit URLs that match |
| `followLinks` | `true` | Queue every link on each page automatically |

Start URLs are always visited, whatever the filters say. URLs are de-duplicated, and `#fragments` are ignored.

### Picking links yourself

Turn off `followLinks` and call `enqueue()` with the links you want. Relative URLs are resolved against the current page, and the same limits and filters apply:

```ts
await wraith.crawl({
  start: 'https://quotes.toscrape.com/',
  mode: 'static',
  followLinks: false,
  handler: ({ page, enqueue }) => {
    const { next, authors } = page.extract({
      next: 'li.next a@href',
      authors: { selector: '.quote a[href^="/author/"]', attr: 'href', list: true },
    });
    if (next) enqueue(next);
    enqueue(authors);
    return page.extract({ name: '.author-title' });
  },
});
```

## Speed and politeness

`concurrency` (default 3) is how many pages are processed at once. The per-host [rate limit](/guide/network) still applies on top, so by default a crawl of one site loads at most 4 pages per second, however high you set `concurrency`. Turn on `respectRobotsTxt` for crawls of sites you don't own:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ network: { respectRobotsTxt: true, userAgent: 'my-crawler/1.0 (+https://example.com/bot)' } });
```

## Errors

A page that throws, whether in loading or in your handler, goes into `errors` as `{ url, error }` and doesn't stop the crawl. To react as it happens, pass `onError`:

```ts
await wraith.crawl({
  start: 'https://example.com/',
  handler: async ({ page }) => page.title(),
  onError: (url, error) => console.warn(`${url}: ${error.message}`),
});
```
