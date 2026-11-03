# createWraith options

```ts sig
function createWraith(options?: WraithOptions): Wraith
```

Creates a [`Wraith`](/reference/wraith). Nothing launches until the first browser page is opened, so creating one is cheap. Times are in milliseconds.

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({
  human: 'natural',
  headless: true,
  network: { respectRobotsTxt: true },
  waits: { afterAction: 'navigation' },
  consent: 'reject',
});
```

## Options

| Option | Type | Default | |
| --- | --- | --- | --- |
| `human` | `HumanOption` | `'natural'` | How human browser input looks. See [below](#human) |
| `browser` | `'chromium' \| 'firefox' \| 'webkit'` | `'chromium'` | Browser engine |
| `headless` | `boolean` | `true` | `false` opens a visible window |
| `launch` | Playwright `LaunchOptions` | | Passed to `browserType.launch()`: `channel`, `slowMo`, `args`, `executablePath`… |
| `context` | Playwright `BrowserContextOptions` | | Passed to `browser.newContext()`: viewport, user agent, locale, timezone, proxy, `storageState`… |
| `blockResources` | `('image' \| 'media' \| 'font' \| 'stylesheet')[]` | `[]` | Resource types browser pages don't download |
| `network` | `NetworkOptions` | | [Below](#network) |
| `waits` | `WaitOptions` | | [Below](#waits) |
| `consent` | `false \| 'reject' \| 'accept'` | `false` | Answer cookie banners automatically. [Guide](/guide/consent) |
| `handoff` | `HandoffOptions` | | [Below](#handoff) |
| `ai` | `AIOptions` | | Turns on `page.ai` and `wraith.ai`. [AI options](/reference/ai-options) |
| `seed` | `number` | random | Seeds every random choice, so runs are reproducible |
| `logger` | `boolean \| Logger` | silent | `true` logs to the console, as does the `WRAITH_DEBUG` environment variable. Or pass `{ debug, info, warn, error }` |

## human

```ts sig
type HumanOption =
  | boolean                               // true = 'natural', false = 'off'
  | 'off' | 'fast' | 'natural' | 'careful'
  | ({ preset?: HumanPreset } & DeepPartial<HumanBehavior>);
```

`HumanBehavior` has these settings. Ranges are `[min, max]` and sampled each time.

| Setting | Type | |
| --- | --- | --- |
| `enabled` | `boolean` | Master switch. `false` is the same as `'off'` |
| `actionDelay` | `Range` | Pause before each click, type, select or press |
| `mouse.enabled` | `boolean` | Move along a path before clicking |
| `mouse.speed` | `number` | 1 is an average person |
| `mouse.overshootChance` | `number` | 0–1, for distant targets |
| `mouse.jitter` | `number` | Pixels of wobble on the path |
| `mouse.hoverDelay` | `Range` | Pause between arriving and pressing |
| `mouse.clickHold` | `Range` | How long the button stays down |
| `typing.keyDelay` | `Range` | Time per key |
| `typing.typoChance` | `number` | 0–1, per letter |
| `typing.wordPause` | `Range` | Extra pause after a space |
| `scroll.step` | `Range` | Pixels per wheel tick |
| `scroll.stepDelay` | `Range` | Pause between ticks |
| `reading.wordsPerMinute` | `Range` | Pace for `page.read()` |

Each preset's values are listed in the [Human behaviour guide](/guide/human-behaviour#adjusting-settings).

## network

| Option | Type | Default | |
| --- | --- | --- | --- |
| `timeout` | `number` | `30000` | Navigations, static fetches, and waiting for an element before an action |
| `retries` | `number` | `2` | For network errors, timeouts and 408/425/429/5xx, with exponential backoff from 1 s |
| `rateLimit` | `false \| RateLimitOptions` | see below | Per-host limit. `false` turns it off |
| `rateLimit.concurrency` | `number` | `2` | Requests in flight to one host at once |
| `rateLimit.maxRequests` | `number` | `4` | At most this many per `intervalMs`, per host |
| `rateLimit.intervalMs` | `number` | `1000` | |
| `respectRobotsTxt` | `boolean` | `false` | Throw `RobotsDisallowedError` for disallowed URLs; a Crawl-delay replaces the rate limit |
| `userAgent` | `string` | | For static fetches and robots.txt matching |
| `headers` | `Record<string, string>` | | Extra headers for static fetches |

[Guide](/guide/network)

## waits

| Option | Type | Default | |
| --- | --- | --- | --- |
| `afterAction` | `'navigation' \| 'settle' \| 'none'` | `'navigation'` | What clicks, key presses and selects wait for afterwards |
| `settle.networkIdleMs` | `number` | `500` | The page's requests must have stopped for this long |
| `settle.domIdleMs` | `number` | `300` | Its content must have stopped changing for this long |
| `settle.loaders` | `string[] \| false` | built-ins | Extra loading-indicator selectors (added to `DEFAULT_LOADERS`), or `false` to skip the check |
| `settle.timeout` | `number` | `15000` | `waitForSettled()` gives up and returns `false` |

[Guide](/guide/waiting)

## handoff

| Option | Type | Default | |
| --- | --- | --- | --- |
| `auto` | `boolean` | `false` | Check for a challenge after every navigation and action |
| `onChallenge` | `ChallengeHandler` | the window, or a terminal prompt when headless | Who answers |
| `timeout` | `number` | `300000` | How long to wait for the person |
| `submit` | `boolean` | `true` | Press Enter after typing the answer |

```ts sig
type ChallengeHandler = (challenge: Challenge) => string | void | Promise<string | void>;
```

Return the answer to have it typed in, or nothing once the person has dealt with it. [Guide](/guide/captchas)
