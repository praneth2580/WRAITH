# Consent banners

Cookie and consent banners cover content and intercept clicks. wraith can answer them automatically on every page, using DuckDuckGo's [autoconsent](https://github.com/duckduckgo/autoconsent): rules for hundreds of consent platforms (OneTrust, Cookiebot, Didomi, Quantcast and many more), in pages and in iframes, plus a heuristic for custom banners.

It's off by default. Turn it on with your choice:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ consent: 'reject' });   // or 'accept'
const page = await wraith.open('https://example.com');
await page.waitForConsent();                             // optional
```

## Reject or accept

| Choice | What happens |
| --- | --- |
| `'reject'` | Refuses non-essential cookies, using the platform's own reject or settings flow. A banner that only offers Accept is left alone, but a plain "OK" / "Got it" acknowledgement is clicked |
| `'accept'` | Accepts. For custom banners that no rule knows, wraith finds the accept button with autoconsent's button classifier and clicks it |

The answer is a DOM click, not a humanized one: banners are answered as the page loads, often before your own code runs.

## Checking what happened

`waitForConsent()` waits until the page's banner has been dealt with, or the timeout (5 seconds by default) passes, and returns the status. Timing out is normal on pages without a banner.

```ts
const status = await page.waitForConsent({ timeout: 8000 });
// { cmp: 'onetrust', done: true, succeeded: true, hiddenOnly: false }
```

| Field | |
| --- | --- |
| `cmp` | The consent platform found, such as `'onetrust'`, or `null` if none yet |
| `done` | True once the banner has been dealt with |
| `succeeded` | Whether the reject or accept steps worked, once they've run |
| `hiddenOnly` | True if the banner was only hidden with CSS, without recording a choice |

`page.consentStatus()` returns the same status immediately, without waiting. Both throw if `consent` isn't set.

## Good to know

- **Banners depend on where you are.** Many sites only show a banner to visitors from the EU or UK. A proxy or `context: { locale, timezoneId }` changes what you see.
- **A saved session remembers the choice.** With [`saveSession()`](/guide/browser-options#sessions) and `storageState`, the consent cookie is stored, so the banner usually doesn't come back.
- **Status is per page and per document.** Navigating to a new page starts a fresh status.
