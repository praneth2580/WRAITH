# Errors

Every error wraith throws extends `WraithError`, so one `instanceof` check catches them all:

```ts
import { WraithError, HttpError } from 'wraithjs';

try {
  await wraith.fetch('https://example.com/flaky');
} catch (error) {
  if (error instanceof HttpError) console.warn(`gave up: HTTP ${error.status} for ${error.url}`);
  else if (error instanceof WraithError) console.warn(error.message);
  else throw error;
}
```

| Error | Thrown when | Extra fields |
| --- | --- | --- |
| `WraithError` | The base class; also invalid options and targets, missing `ai`/`consent` configuration, `text()` selectors that match nothing | |
| `HttpError` | A response was still 408/425/429/5xx after the retries | `status`, `url` |
| `RobotsDisallowedError` | robots.txt disallows the URL, with `respectRobotsTxt` | `url` |
| `WaitTimeoutError` | `waitUntil()`, or a `JsonCapture` wait, ran out of time | |
| `ChallengeError` | A challenge couldn't be handed to anyone, wasn't dealt with in time, or the answer had nowhere to go | |
| `AIError` | A provider failed, refused, replied outside the schema, or the content was over `maxInputChars` | |
| `MissingDependencyError` | An optional package, such as `@anthropic-ai/sdk`, isn't installed | `packageName` |

Errors from Playwright pass through unchanged. The common one is its `TimeoutError`, when an element never becomes ready within the timeout. Its message names the step that timed out.

Network failures (DNS errors, refused connections, timeouts) are retried, then thrown as they came: from `fetch()`, Node's `TypeError: fetch failed` with the reason in `cause`; from browser pages, Playwright's error, such as `net::ERR_NAME_NOT_RESOLVED`.
