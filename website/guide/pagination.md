# Pagination

Listings come in three shapes: numbered pages with a **Next** control, a **Load more** button that adds results to the same page, and **infinite scroll**. `page.paginate()` handles all three, and `wraith.paginate()` follows Next links without a browser.

## In the browser

`paginate()` is an async generator. It yields `1` for the page you're on, then `2`, `3`… once each new page or batch has loaded and settled:

```ts
const schema = {
  rows: { selector: '.result', list: true, fields: { name: 'h3', url: 'a@href' } },
} as const;

const page = await wraith.open('https://example.com/search?q=lamp');
const rows = [];

for await (const n of page.paginate({ next: { role: 'link', name: 'Next' }, maxPages: 20 })) {
  const { rows: onThisPage } = await page.extract(schema);
  rows.push(...onThisPage);
  console.log(`page ${n}: ${onThisPage.length} results`);
}
```

Give exactly one of:

| Option | For | Each step |
| --- | --- | --- |
| `next: target` | Numbered pages | Clicks the Next control (humanized), waits for the page to change and settle |
| `loadMore: target` | "Load more" / "Show more" buttons | Clicks it; results pile up on the same page |
| `scroll: true` | Infinite scroll | Scrolls to the bottom and waits for more content |

It stops when:

- the control is missing, hidden or disabled (there's no next page);
- a step changed nothing within `waitMs` (default 5000 ms);
- `maxPages` is reached (default 10, counting the first page).

::: tip Load more and scroll
Results accumulate on one page, so extract once at the end, or keep only what's new each time:

```ts
let seen = 0;
const items: (string | null)[] = [];
for await (const _ of page.paginate({ loadMore: { role: 'button', name: /load more/i } })) {
  const { all } = await page.extract({ all: { selector: '.card h3', list: true } });
  items.push(...all.slice(seen));
  seen = all.length;
}
```
:::

`page.autoScroll()` is a simpler alternative for infinite feeds when you only want everything at the end: it scrolls while the page keeps growing and returns how many scrolls it made.

## Without a browser

`wraith.paginate(url, { next })` fetches each page statically and follows the Next link. It yields `StaticPage`s:

```ts
const quotes = [];
for await (const p of wraith.paginate('https://quotes.toscrape.com/', { next: 'li.next a', maxPages: 5 })) {
  quotes.push(...p.extract({ q: { selector: '.quote .text', list: true } }).q);
}
```

`next` can be:

- a **selector** for the Next link; its `href` is followed: `'li.next a'`, `'a[rel=next]'`;
- any **[field spec](/reference/selector-schemas)** that yields a URL: `'link[rel=next]@href'`, `{ text: 'Next', attr: 'href' }`;
- a **function** of the page, returning the next URL or `null`.

```ts
const pages = wraith.paginate('https://example.com/items?page=1', {
  next: (p) => {
    const current = Number(new URL(p.url).searchParams.get('page'));
    return p.extract({ any: '.item' }).any ? `https://example.com/items?page=${current + 1}` : null;
  },
  maxPages: 50,
});
for await (const p of pages) console.log(p.url);
```

It stops when `next` gives nothing, when it would revisit a URL, or at `maxPages`. Every request goes through the [rate limit](/guide/network).

## Which to use

If the Next link is a real link with an `href` in the HTML, static pagination is far faster. Use the browser when pages are rendered by JavaScript, when "Next" is a button without a URL, or for Load more and infinite scroll.
