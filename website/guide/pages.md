# Browser pages and static pages

wraith loads pages in two ways. Both have the same extraction methods, so you can switch between them without rewriting your selectors.

| | Browser page (`WraithPage`) | Static page (`StaticPage`) |
| --- | --- | --- |
| Created with | `wraith.open(url)` or `wraith.newPage()` | `wraith.fetch(url)` |
| Runs JavaScript | Yes | No |
| Clicks, typing, scrolling | Yes, humanized | No |
| Speed | Seconds per page | Milliseconds per page |
| Needs a browser installed | Yes | No |
| Extraction methods | `extract`, `structuredData`, `links`, `text`, `markdown`, `html`, `ai` | `extract`, `structuredData`, `links`, `text`, `markdown`, `json`, `ai` |
| Methods are | async | synchronous (except `ai`) |

**Use a static page** whenever the data is in the HTML the server sends. Check by viewing the page source in your browser: if the text you want is there, `fetch()` will see it.

**Use a browser page** when the content is rendered by JavaScript, when you need to log in or click, or when the site checks that it's talking to a real browser.

## Browser pages

```ts
const page = await wraith.open('https://example.com');   // new tab, then goto

const blank = await wraith.newPage();                    // new tab, nothing loaded
await blank.goto('https://example.com', { waitUntil: 'domcontentloaded' });
```

All tabs from one `Wraith` share a browser and a context, so they share cookies and logins. Close tabs you're done with using `page.close()`, and the browser with `wraith.close()`.

Each page can override the human behaviour:

```ts
const quick = await wraith.newPage({ human: 'off' });   // this tab only
```

`page.raw` is the underlying Playwright `Page`, for anything wraith doesn't wrap:

```ts
await page.raw.setExtraHTTPHeaders({ 'x-debug': '1' });
const cookies = await page.raw.context().cookies();
```

## Static pages

```ts
const res = await wraith.fetch('https://example.com/api/items?page=2', {
  headers: { accept: 'application/json' },
  timeout: 10_000,
});

if (res.ok) {
  const items = res.json<{ id: number; name: string }[]>();
  console.log(items.length);
}
```

A `StaticPage` holds the final `url` (after redirects), the `status`, `headers` and raw `body`, and `$`, a [cheerio](https://cheerio.js.org) instance for anything the helpers don't cover:

```ts
const res = await wraith.fetch('https://example.com');
const headings = res.$('h2').map((_, el) => res.$(el).text()).get();
```

`fetch()` throws `HttpError` only when the response is still 408, 425, 429 or 5xx after the retries. Other statuses, such as 404, come back as a normal page with `ok: false`.

## Mixing them

A common pattern: fetch listing pages statically (fast), and open a browser only for the pages that need it.

```ts
const listing = await wraith.fetch('https://books.toscrape.com/');
const { links } = listing.extract({ links: { selector: 'h3 a', attr: 'href', list: true } });

for (const link of links.slice(0, 3)) {
  const page = await wraith.open(link);
  console.log(await page.title());
  await page.close();
}
```

Both kinds of request go through the same per-host [rate limit, retries and robots.txt check](/guide/network).
