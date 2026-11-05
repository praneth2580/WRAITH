# StaticPage

A page downloaded without a browser, from `wraith.fetch()`, `wraith.paginate()` or a static `wraith.crawl()`. Everything except `ai` is synchronous: the HTML is already parsed.

## Properties

| Property | Type | |
| --- | --- | --- |
| `url` | `string` | The final URL, after redirects |
| `status` | `number` | HTTP status |
| `ok` | `boolean` | `true` for 2xx |
| `headers` | `Headers` | Response headers (`headers.get('content-type')`) |
| `body` | `string` | The raw response body |
| `$` | `CheerioAPI` | The parsed document, for [cheerio](https://cheerio.js.org) queries |
| `blocked` | `Block \| null` | The bot protection service that answered instead of the site. Only seen with `network.onBlock: 'return'`; otherwise `fetch()` throws `BlockedError`. [Guide](/guide/bot-protection) |

## Methods

| Method | Returns | |
| --- | --- | --- |
| `extract(schema)` | `InferSchema<S>` | [Selector schemas](/reference/selector-schemas) |
| `structuredData()` | `StructuredData` | JSON-LD, microdata, OpenGraph, meta tags and embedded JSON |
| `links()` | `string[]` | Every http(s) link: absolute, no fragments, de-duplicated. With `avoidHoneypots`, leaves out links the markup hides ([how](/guide/honeypots#static-pages)) |
| `text(selector?)` | `string` | Visible text. Throws if `selector` matches nothing |
| `markdown(selector?)` | `string` | Clean Markdown with absolute links |
| `json<T>()` | `T` | Parses the body as JSON |
| `ai.extract(schema, { instruction?, selector? })` | `Promise<z.infer<S>>` | Needs the `ai` option |
| `ai.ask(question, { selector? })` | `Promise<string>` | Needs the `ai` option |

Links and URL attributes are resolved against the final URL, or the page's `<base href>` if it has one.

```ts
const res = await wraith.fetch('https://example.com/products.json');
if (res.ok && res.headers.get('content-type')?.includes('json')) {
  const products = res.json<{ id: string }[]>();
  console.log(products.length);
}
```
