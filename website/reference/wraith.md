# Wraith

The object [`createWraith()`](/reference/create-wraith) returns. It holds one browser and one browser context (launched on first use), the per-host rate limiter and the AI client.

## Pages

### open()

```ts sig
open(url: string, options?: GotoOptions & NewPageOptions): Promise<WraithPage>
```

Opens a new tab and navigates to `url`. Options: `waitUntil` (`'load'` default, `'domcontentloaded'`, `'networkidle'`, `'commit'`), `timeout`, and `human` to override the human behaviour for this tab. If the navigation fails, the tab is closed and the error thrown.

### newPage()

```ts sig
newPage(options?: { human?: HumanOption }): Promise<WraithPage>
```

Opens a blank tab. Launches the browser if it isn't running.

### fetch()

```ts sig
fetch(url: string, options?: FetchOptions): Promise<StaticPage>

interface FetchOptions {
  method?: string;                    // default 'GET'
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;                   // default network.timeout
}
```

Downloads a page without a browser and parses it. Redirects are followed. Goes through the same robots.txt check, rate limit and retries as browser pages. Throws `HttpError` if the status is still 408/425/429/5xx after retries; other statuses return a [`StaticPage`](/reference/static-page) with `ok: false`.

### paginate()

```ts sig
paginate(url: string, options: StaticPaginateOptions): AsyncGenerator<StaticPage>

interface StaticPaginateOptions {
  next: FieldSpec | ((page: StaticPage) => string | null | undefined);
  maxPages?: number;                  // default 10, counting the first
}
```

Follows Next links without a browser. `next` is a selector for the link (its `href` is followed), any [field spec](/reference/selector-schemas) that yields a URL, or a function. Stops when `next` gives nothing, when it would revisit a URL, or at `maxPages`. [Guide](/guide/pagination#without-a-browser)

### crawl()

```ts sig
crawl<T>(options: CrawlOptions<StaticPage, T> & { mode: 'static' }): Promise<CrawlResult<T>>
crawl<T>(options: CrawlOptions<WraithPage, T> & { mode?: 'browser' }): Promise<CrawlResult<T>>
```

| Option | Type | Default | |
| --- | --- | --- | --- |
| `start` | `string \| string[]` | required | Always visited |
| `handler` | `(context) => T \| Promise<T>` | required | Gets `{ url, depth, page, enqueue }`; its return value goes into `results` |
| `mode` | `'browser' \| 'static'` | `'browser'` | |
| `maxPages` | `number` | `50` | |
| `maxDepth` | `number` | `2` | |
| `followLinks` | `boolean` | `true` | Queue every link automatically |
| `sameOrigin` | `boolean` | `true` | |
| `include` / `exclude` | `RegExp \| ((url: string) => boolean)` | | |
| `concurrency` | `number` | `3` | |
| `onError` | `(url: string, error: Error) => void` | | |

Returns `{ results: { url, depth, data }[], errors: { url, error }[] }`. [Guide](/guide/crawling)

## Sessions and the browser

### saveSession()

```ts sig
saveSession(path: string): Promise<void>
```

Writes cookies and localStorage to a JSON file. Start a later `Wraith` from it with `context: { storageState: path }`.

### context()

```ts sig
context(): Promise<BrowserContext>
```

The Playwright `BrowserContext`, launching the browser if needed.

### close()

```ts sig
close(): Promise<void>
```

Closes the browser. Static fetches keep working afterwards, and opening a browser page launches a new browser.

## AI

### ai

```ts sig
readonly ai: AIClient
```

AI over content you already have. Throws if the `ai` option isn't set.

| Method | |
| --- | --- |
| `ai.extract(content, schema, { instruction? })` | Data matching a zod schema |
| `ai.ask(question, content?)` | A text answer |
| `ai.generate(schema, { system?, prompt })` | Your own prompt, with a validated structured reply |

## Properties

| Property | Type | |
| --- | --- | --- |
| `options` | `WraithOptions` | What you passed to `createWraith()` |
| `human` | `HumanBehavior` | The resolved human settings |
| `network` | `ResolvedNetwork` | The resolved network settings |
| `logger` | `Logger` | |
