# Waiting

Modern pages load in stages: the HTML arrives, then scripts fetch data, show spinners, render results, and enable buttons. wraith waits at the right moments so you rarely need fixed sleeps.

## Before each action

Every click, type, select and check waits for its element to be [ready](/guide/targets#what-ready-means): visible, still, enabled and uncovered. A button that's disabled until a form is valid, or hidden behind a loading overlay, is simply waited for, up to the timeout.

## After each action

What wraith waits for after a click, key press or select is set by `waits.afterAction`:

| Mode | Waits for | Use it when |
| --- | --- | --- |
| `'navigation'` (default) | Any page load the action started | Most sites |
| `'settle'` | A page load, then the page going quiet (see below) | Single-page apps that update without navigating |
| `'none'` | Nothing | You'll wait explicitly yourself |

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ waits: { afterAction: 'settle' } });
```

With `'navigation'`, wraith watches for about 300 ms after the action. If a navigation starts, it waits for the new page to load; if not, it carries on.

## Waiting for the page to settle

`waitForSettled()` waits until the page has finished what it's doing:

```ts
await page.click('#search');
const settled = await page.waitForSettled();
```

The page counts as settled when, at the same time:

- **the network is quiet**: none of the page's own document, XHR, fetch or script requests have been in flight for `networkIdleMs` (500). Requests from iframes, and requests running longer than 5 seconds (long polling, streams), don't count;
- **the content has stopped changing**: no elements or text added or removed for `domIdleMs` (300). Style and class changes don't count, so animations don't keep the page busy;
- **no loading indicator is visible**.

It returns `true` once settled, or `false` if `timeout` (15 seconds) passes first. It doesn't throw, because some pages never go fully quiet: a ticking clock, a carousel, a chat widget.

### Loading indicators

These are recognised out of the box (exported as `DEFAULT_LOADERS`):

```text
[aria-busy="true"]
[role="progressbar"]:not([aria-valuenow])
[class*="spinner" i]   [id*="spinner" i]
[class*="loader" i]    [id*="loader" i]
[class*="loading" i]   [id*="loading" i]
[class*="skeleton" i]
```

Add the site's own, or turn the check off:

```ts
await page.waitForSettled({ loaders: ['.my-overlay', '[data-pending]'] });
await page.waitForSettled({ loaders: false });
```

### Defaults for every call

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({
  waits: {
    afterAction: 'settle',
    settle: { networkIdleMs: 800, domIdleMs: 400, timeout: 20_000, loaders: ['.app-busy'] },
  },
});
```

## Waiting for something specific

When you know what you're waiting for, wait for exactly that. It's faster and clearer than waiting for everything:

```ts
await page.waitForText('results');                    // case-insensitive substring
await page.waitForText(/\d+ items? found/);
await page.waitForText('Saved', { within: '#toast' });

await page.waitForUrl('**/checkout');                 // glob
await page.waitForUrl(/\/orders\/\d+$/);
await page.waitForUrl((url) => url.searchParams.has('session'));

await page.waitFor('.results');                       // visible (default)
await page.waitFor('.overlay', { state: 'hidden' });  // a loader going away
await page.waitFor('#temp-row', { state: 'detached' });
```

## Polling your own condition

`waitUntil()` calls a function until it returns something truthy, and gives you that value:

```ts
const count = await page.waitUntil(async () => {
  const n = Number(await page.text('.result-count'));
  return n > 0 ? n : null;
}, { timeout: 20_000, interval: 500, message: 'results never appeared' });
```

It throws `WaitTimeoutError` (with your `message`) if the time runs out. The same helper is exported as `waitUntil` for use outside a page.

## Fixed pauses

Sometimes a pause is the honest answer, for example to space out actions:

```ts
await page.wait(2000);            // exactly 2 s
await page.wait([1000, 3000]);    // somewhere between 1 and 3 s
```

## Recipes

**A spinner after clicking "Search":**

```ts
await page.click({ role: 'button', name: 'Search' });
await page.waitFor('.spinner', { state: 'hidden' });
```

**Results that load as you scroll:** use [`autoScroll()` or `paginate({ scroll: true })`](/guide/pagination).

**Diagnosing a page that never settles:** the [devtools](/guide/devtools) `activity` action shows which requests are in flight, which loader is visible, and when the content last changed.
