# JsonCapture

Returned by `page.captureJson(match)`. Collects JSON responses from the page's own requests, from the moment it's created until `stop()`.

```ts sig
captureJson<T = unknown>(match: ResponseMatcher): JsonCapture<T>

type ResponseMatcher = string | RegExp | ((response: Response) => boolean);
```

- A **string** matches if the response URL contains it.
- A **RegExp** is tested against the URL.
- A **function** gets Playwright's `Response`, so you can check the method, headers or status too.

Only 2xx responses whose body parses as JSON are collected (204 No Content is skipped, and so are images and other non-text types).

## Members

| Member | Type | |
| --- | --- | --- |
| `items` | `CapturedJson<T>[]` | Every matching response so far, in the order their bodies arrived |
| `data` | `T[]` | Just the parsed bodies |
| `waitFor(count?, { timeout? })` | `Promise<CapturedJson<T>[]>` | Resolves once at least `count` (default 1) have arrived in total. Default timeout 30000; throws `WaitTimeoutError` |
| `next({ timeout? })` | `Promise<CapturedJson<T>>` | The next response captured after this call |
| `stop()` | `void` | Stops listening. `items` stays |

```ts sig
interface CapturedJson<T> {
  url: string;
  method: string;
  status: number;
  data: T;
}
```

## Example

```ts
interface Product { id: string; name: string; price: number }

const page = await wraith.newPage();
const capture = page.captureJson<{ products: Product[] }>(/\/api\/products\?page=\d+/);

await page.goto('https://shop.example.com/lamps');
await capture.waitFor(1);
await page.autoScroll();
capture.stop();

const products = capture.data.flatMap((d) => d.products);
```

[Guide](/guide/generated-class-names#_1-capture-the-site-s-own-api)
