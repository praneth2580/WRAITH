# Other exports

Everything here is exported from `wraithjs` alongside `createWraith`.

## Extraction helpers

| Export | |
| --- | --- |
| `extractHtml(html, schema, baseUrl?)` | Runs a [selector schema](/reference/selector-schemas) over an HTML string |
| `htmlToMarkdown(html, { selector?, baseUrl? })` | Clean Markdown: scripts, styles and hidden elements removed, links absolute |
| `htmlToText(html, selector?)` | Visible text with whitespace collapsed |
| `jsonLdOfType(data, type)` | JSON-LD objects of one `@type` from `structuredData()` |

```ts
import { htmlToMarkdown } from 'wraithjs';

const md = htmlToMarkdown('<h1>Hi</h1><script>x()</script><a href="/a">A</a>', { baseUrl: 'https://example.com' });
// '# Hi\n\n[A](https://example.com/a)'
```

## Waiting

| Export | |
| --- | --- |
| `waitUntil(condition, { timeout?, interval?, message? })` | Polls until `condition` returns something truthy. Defaults 10000 and 200 ms |
| `DEFAULT_LOADERS` | The loading-indicator selectors `waitForSettled()` recognises |

## Human behaviour

| Export | |
| --- | --- |
| `humanPresets` | The `off`, `fast`, `natural` and `careful` settings |
| `Humanizer` | The class behind `page.human` |
| `humanPath(from, to, rng, options)` | The timed points of a humanized mouse path |
| `pointInBox(box, rng)` | A natural aim point inside a box |
| `createRng(seed?)` | The seeded random generator wraith uses |
| `sleep(ms)` | A promise that resolves after `ms` |
| `builtInUserAgents(engine?)` | The user agents `userAgent: 'rotate'` uses, for one engine or all |

## AI

| Export | |
| --- | --- |
| `AIClient` | The class behind `wraith.ai` |
| `createProvider(options)` | Builds a provider from [AI options](/reference/ai-options) |
| `createAnthropicProvider`, `createOpenAIProvider`, `createOllamaProvider` | Build one provider directly |
| `AIProvider`, `AIRequest`, `AIResponse` | Types for implementing your own |
| `z` | The zod instance wraith uses. Build schemas with it |

## Logging

| Export | |
| --- | --- |
| `consoleLogger` | Logs to the console with a `[wraith]` prefix |
| `silentLogger` | Logs nothing |
| `Logger` | `{ debug, info, warn, error }`, each `(message, ...meta) => void` |

```ts
import { createWraith, type Logger } from 'wraithjs';

const logger: Logger = {
  debug: () => {},
  info: (message) => console.log(`[scraper] ${message}`),
  warn: (message, ...meta) => console.warn(`[scraper] ${message}`, ...meta),
  error: (message, ...meta) => console.error(`[scraper] ${message}`, ...meta),
};
const wraith = createWraith({ logger });
```

## Bot protection

| Export | |
| --- | --- |
| `detectBlock({ url, status, headers, body })` | Recognises a bot protection block or challenge page in any response. Returns a [`Block`](/reference/types#block) or `null`. [Guide](/guide/bot-protection#handling-them-yourself) |

## Types

All option and result types are exported for TypeScript: `WraithOptions`, `NetworkOptions`, `RateLimitOptions`, `ProxyOption`, `ProxySettings`, `InstanceOptions`, `UserAgentOption`, `Honeypot`, `WaitOptions`, `SettleOptions`, `HandoffOptions`, `HumanOption`, `HumanBehavior`, `HumanPreset`, `Range`, `Target`, `TargetQuery`, `SelectorSchema`, `FieldSpec`, `ValueField`, `NestedField`, `InferSchema`, `GotoOptions`, `FetchOptions`, `PaginateOptions`, `StaticPaginateOptions`, `CrawlOptions`, `CrawlResult`, `Challenge`, `Block`, `BotProtection`, `ConsentStatus`, `ActOptions`, `ActResult`, `AIOptions` and more.
