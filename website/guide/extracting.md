# Extracting data

`extract(schema)` turns a page into plain data. The schema is an object whose values describe where each piece of data lives; the result has the same keys, with types inferred from the schema.

It works the same on browser pages (`await page.extract(schema)`) and static pages (`page.extract(schema)`, synchronous).

## The basics

```ts
const data = await page.extract({
  title: 'h1',                                    // text of the first match, or null
  image: 'img.cover@src',                         // an attribute, after @
  tags: { selector: '.tag', list: true },         // every match: string[]
  price: { selector: '.price', transform: (v) => Number(v.replace(/[^\d.]/g, '')) },
  stock: { selector: '.stock', default: 'unknown' },
});
// data: {
//   title: string | null;
//   image: string | null;
//   tags: string[];
//   price: number | null;
//   stock: string;
// }
```

- **A string** is a CSS selector. You get the trimmed text of the first match, or `null` if nothing matches.
- **`selector@attr`** reads an attribute instead. `href`, `src`, `action` and `poster` are made absolute, using the page URL (and any `<base href>`).
- **`list: true`** returns every match as an array. An empty array means nothing matched.
- **`transform`** converts each value. Its return type becomes the field's type.
- **`default`** replaces `null` when nothing matches.

## Lists of objects

Add `fields` to read several values inside each match:

```ts
const { products } = await page.extract({
  products: {
    selector: '.product',
    list: true,
    fields: {
      name: 'h2',
      url: 'a@href',
      price: { selector: '.price', transform: Number },
      badges: { selector: '.badge', list: true },
    },
  },
});
// products: { name: string | null; url: string | null; price: number | null; badges: string[] }[]
```

Selectors inside `fields` are relative to each match. Without `list`, a nested field gives one object, or `null` when its selector matches nothing.

To read the matched element itself inside `fields`, leave `selector` out:

```ts
const { links } = await page.extract({
  links: {
    selector: 'nav a',
    list: true,
    fields: { label: {}, href: { attr: 'href' } },
  },
});
```

## Matching by text and labels

Pages with [generated class names](/guide/generated-class-names) often have no stable selectors at all. Two matchers help:

```ts
const data = await page.extract({
  price: { near: 'Price' },                  // the value written next to the label
  sku: { near: /^SKU:?$/i },
  next: { text: 'Next', attr: 'href' },      // the element whose text is "Next"
  shipping: { selector: 'li', text: /ships in/i },
});
```

**`near`** finds an element whose text is the label, then reads the value beside it. It handles the common layouts:

| Layout | Example | `near: 'Price'` gives |
| --- | --- | --- |
| Same element | `<p>Price: ₹499</p>` | `₹499` |
| Text right after | `<b>Price</b> ₹499` | `₹499` |
| Next sibling | `<dt>Price</dt><dd>₹499</dd>`, `<th>Price</th><td>₹499</td>` | `₹499` |
| Parent's next sibling | `<div><span>Price</span></div><div>₹499</div>` | `₹499` |

**`text`** matches elements by their own text. A string matches the whole text, ignoring case and extra spaces; a RegExp is tested against it. Combine it with `selector` to narrow the candidates and `attr` to read something else.

## Other ways to read a page

| Method | Gives |
| --- | --- |
| `text(selector?)` | Visible text, whitespace collapsed. Throws if `selector` matches nothing |
| `markdown(selector?)` | Clean Markdown with absolute links; scripts, styles and hidden elements removed |
| `html(selector?)` | Browser pages: the page HTML, or the first match's outer HTML |
| `links()` | Every http(s) link: absolute, without `#fragments`, de-duplicated |
| `structuredData()` | JSON-LD, microdata, OpenGraph, meta tags and embedded JSON ([more](/guide/generated-class-names#_2-read-the-data-the-page-embeds)) |
| `captureJson(match)` | Browser pages: the JSON the site loads from its API ([more](/guide/generated-class-names#_1-capture-the-site-s-own-api)) |

## Extracting from any HTML

`extractHtml()` runs a schema over an HTML string you already have, such as a saved file or an email:

```ts
import { extractHtml } from 'wraithjs';

const html = '<h1>Hello</h1><a href="/about">About</a>';
const data = extractHtml(html, { title: 'h1', about: 'a@href' }, 'https://example.com');
// { title: 'Hello', about: 'https://example.com/about' }
```

## Tips

- **Declare schemas with `as const`** when you define them separately, so the types stay precise:

  ```ts
  const schema = { title: 'h1', tags: { selector: '.tag', list: true } } as const;
  const result = await page.extract(schema);
  ```

- **Expect `null`.** Pages change; a missing field gives `null` rather than an exception, so check before using it, or set a `default`.
- **Wait first on dynamic pages.** `extract()` reads the page as it is right now. If content loads after the page does, wait for it first: see [Waiting](/guide/waiting).
- **Test selectors quickly** in your browser's console with `document.querySelectorAll('...')`, or with [devtools](/guide/devtools).

Full format: [Selector schemas](/reference/selector-schemas).
