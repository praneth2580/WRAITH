# Generated class names

Many sites are built with CSS-in-JS or CSS modules, which produce class names like `css-1x2y3z`, `sc-bdfBwQ` or `Button_primary__3xYz`. They change with every deploy, so selectors built on them break constantly.

There are better handles on the data. In order of robustness:

## 1. Capture the site's own API

Most modern sites load their data as JSON from their own API, with proper field names. Capture those responses instead of reading the rendered page at all:

```ts
const page = await wraith.newPage();
const products = page.captureJson('/api/products');   // start before the requests happen

await page.goto('https://shop.example.com/lamps');
await page.autoScroll();                               // trigger more pages of results

console.log(products.data);                             // every matching response body, parsed
```

The matcher can be a URL substring, a RegExp, or a function of the Playwright `Response`:

```ts
const search = page.captureJson(/\/graphql\?op=Search/);
const big = page.captureJson((res) => res.url().includes('/api/') && res.request().method() === 'POST');
```

Waiting for responses:

```ts
const reviews = page.captureJson('/reviews');
await page.click({ role: 'button', name: 'Show reviews' });
const first = await reviews.next();          // the next matching response
await reviews.waitFor(3);                    // at least 3 in total
reviews.stop();                              // stop listening; reviews.items stays
```

Only successful (2xx) JSON responses are collected. Each item is `{ url, method, status, data }`.

**Finding the endpoint:** open your browser's developer tools on the site, go to the Network tab, filter by Fetch/XHR, and use the page. The responses with your data show the URL to match. The wraith [devtools](/guide/devtools) Network tab does the same for an action you run.

::: tip
Once you know the endpoint, you may not need a browser at all: try `wraith.fetch(apiUrl)` and `res.json()`. Some APIs need cookies or headers that only a browser session has; then stay with `captureJson`.
:::

## 2. Read the data the page embeds

Pages carry machine-readable data for search engines and their own scripts. `structuredData()` collects all of it:

```ts
import { jsonLdOfType } from 'wraithjs';

const data = await page.structuredData();

const [product] = jsonLdOfType(data, 'Product');   // JSON-LD objects by @type, @graph unpacked
data.microdata;                                    // schema.org itemscope/itemprop items
data.openGraph['og:title'];                        // OpenGraph and Twitter card tags
data.meta.description;                             // other <meta name> tags
data.embedded.__NEXT_DATA__;                       // <script type="application/json" id> blocks
```

On browser pages, `embedded` also includes app state that frameworks leave on `window`: `__NUXT__`, `__INITIAL_STATE__`, `__APOLLO_STATE__`, `__PRELOADED_STATE__` and similar. Static pages have everything except that.

E-commerce sites in particular usually publish `Product` JSON-LD with name, price, currency, availability and rating, because search engines reward it.

## 3. Describe elements the way a person would

For clicking and typing, describe the element by its role, label or text instead of its class:

```ts
await page.click({ role: 'button', name: 'Add to cart' });
await page.type({ label: 'Email' }, 'me@example.com');
await page.click({ text: 'Next', within: { role: 'navigation' } });
```

See [Finding elements](/guide/targets) for every option.

## 4. Match values by their labels

In `extract()`, read a value by the label next to it, or find an element by its text:

```ts
const details = await page.extract({
  price: { near: 'Price' },                  // "Price: ₹499", <dt>/<dd>, <th>/<td>, …
  specs: { near: /^(SKU|Brand)$/, list: true },
  next: { text: 'Next', attr: 'href' },
  rating: '[itemprop="ratingValue"]@content',
});
```

See [Matching by text and labels](/guide/extracting#matching-by-text-and-labels).

## 5. Use the stable part of a class

CSS modules keep the component and element name, and only the hash changes:

```ts
const { title } = await page.extract({ title: '[class*="ProductCard_title__"]' });
```

Attribute selectors on `data-*`, `aria-*`, `name`, `href` and `itemprop` are usually stable too.

## 6. Let the AI read it

`page.ai.extract(schema)` reads the page as Markdown and ignores markup entirely. It's the slowest and most expensive option, so keep it for when the others don't work. See [AI](/guide/ai).
