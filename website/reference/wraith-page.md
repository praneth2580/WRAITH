# WraithPage

A browser tab, from `wraith.open()` or `wraith.newPage()`. Input goes through the page's human behaviour. Methods that take a `target` accept a selector, a Playwright `Locator` or a [TargetQuery](/reference/targets), and wait for it to be [ready](/guide/targets#what-ready-means) for up to `network.timeout` unless you pass `timeout`.

With [`avoidHoneypots`](/reference/create-wraith#avoidhoneypots), actions on a target a person couldn't see throw `HoneypotError` instead.

## Navigation

### goto()

```ts sig
goto(url: string, options?: {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  timeout?: number;
}): Promise<Response | null>
```

Navigates, through the robots.txt check, the rate limit and retries. `waitUntil` defaults to `'load'`. With `waits.afterAction: 'settle'`, it then waits for the page to settle; with `handoff.auto`, it then checks for a challenge. Then it checks for a [bot protection](/guide/bot-protection) block or challenge page: a block throws `BlockedError` at once, and a challenge gets up to 15 seconds to clear by itself first (with `network.onBlock: 'return'`, neither throws). Returns Playwright's `Response`: the final page's, if a challenge cleared. Throws `HttpError` if the status is still 408/425/429/5xx after retries; block and challenge pages aren't retried.

### url(), title(), close()

```ts sig
url(): string
title(): Promise<string>
close(): Promise<void>
```

## Input

### click(), dblclick()

```ts sig
click(target: Target, options?: {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  timeout?: number;
}): Promise<void>
dblclick(target: Target, options?: {
  button?: 'left' | 'right' | 'middle';
  timeout?: number;
}): Promise<void>
```

Waits until the target is clickable, moves the mouse to it and clicks, then waits as `waits.afterAction` says.

### hover()

```ts sig
hover(target: Target, options?: { timeout?: number }): Promise<void>
```

### type()

```ts sig
type(target: Target, text: string, options?: {
  clear?: boolean;
  typos?: boolean;
  timeout?: number;
}): Promise<void>
```

Clicks the field and types key by key. `clear` (default `true`) replaces the current value. `typos` (default `true`) allows corrected typos when the human settings have a `typoChance`. With humanizing on, a `\n` in `text` presses Enter. With `human: 'off'` the field is filled instantly (or, with `clear: false`, typed without delays).

### fill()

```ts sig
fill(target: Target, value: string, options?: { timeout?: number }): Promise<void>
```

Sets the value instantly, without typing.

### press()

```ts sig
press(key: string, options?: { target?: Target; timeout?: number }): Promise<void>
```

Presses a key or chord, such as `'Enter'`, `'Tab'`, `'Escape'`, `'ArrowDown'` or `'ControlOrMeta+A'`, on `target` or whatever has focus. Waits as `afterAction` says.

### select()

```ts sig
select(target: Target, values: string | string[], options?: {
  timeout?: number;
}): Promise<void>
```

Chooses options in a `<select>` by value or visible label.

### check()

```ts sig
check(target: Target, checked?: boolean, options?: { timeout?: number }): Promise<void>
```

Ticks a checkbox or radio (or unticks it with `checked: false`), clicking only if its state needs to change.

### scroll()

```ts sig
scroll(options: { by: number } | { to: 'top' | 'bottom' | Target }): Promise<void>
```

Scrolls with wheel ticks: by a number of pixels (negative is up), to the top or bottom, or until an element is in view.

### autoScroll()

```ts sig
autoScroll(options?: { maxScrolls?: number; idleMs?: number }): Promise<number>
```

Keeps scrolling to the bottom while the page keeps growing, for infinite feeds. Stops after two scrolls in a row add nothing, or at `maxScrolls` (default 20). `idleMs` (default 2000) is how long to wait for new content after each scroll. Returns the number of scrolls.

### read()

```ts sig
read(options?: { maxMs?: number }): Promise<void>
```

Scrolls through the page at reading speed, pausing and drifting the mouse. Takes as long as the text would take to read, up to `maxMs` (default 20000). Does nothing with humanizing off.

### paginate()

```ts sig
paginate(options: PaginateOptions): AsyncGenerator<number>

interface PaginateOptions {
  next?: Target;        // a Next link or button
  loadMore?: Target;    // a Load more button
  scroll?: boolean;     // infinite scroll
  maxPages?: number;    // default 10, counting the first
  waitMs?: number;      // how long to wait for a change after each step; default 5000
}
```

Give exactly one of `next`, `loadMore` or `scroll`. Yields 1, 2, 3… as each page or batch is ready. [Guide](/guide/pagination)

## Waiting

| Method | Returns | |
| --- | --- | --- |
| `wait(time: number \| [min, max])` | `Promise<void>` | A fixed or random pause |
| `waitFor(target, { state?, timeout? })` | `Promise<void>` | `state`: `'visible'` (default), `'hidden'`, `'attached'`, `'detached'` |
| `waitForSettled(options?: SettleOptions)` | `Promise<boolean>` | `false` if the page didn't go quiet in time. Options as [`waits.settle`](/reference/create-wraith#waits) |
| `waitForText(text: string \| RegExp, { within?, timeout? })` | `Promise<void>` | Strings match as case-insensitive substrings |
| `waitForUrl(url: string \| RegExp \| ((url: URL) => boolean), { timeout? })` | `Promise<void>` | Strings are globs, such as `'**/done'` |
| `waitUntil(condition, { timeout?, interval?, message? })` | `Promise<T>` | Polls until `condition()` returns something truthy, and returns it. Defaults 10000 and 200 ms. Throws `WaitTimeoutError` |

[Guide](/guide/waiting)

## Reading

| Method | Returns | |
| --- | --- | --- |
| `extract(schema)` | `Promise<InferSchema<S>>` | [Selector schemas](/reference/selector-schemas) |
| `structuredData()` | `Promise<StructuredData>` | JSON-LD, microdata, OpenGraph, meta tags, embedded JSON and app state on `window`. [Type](/reference/types#structureddata) |
| `captureJson<T>(match)` | `JsonCapture<T>` | Starts collecting matching JSON responses. [JsonCapture](/reference/json-capture) |
| `text(selector?)` | `Promise<string>` | Visible text, whitespace collapsed; several matches are joined with spaces. Throws `WraithError` if `selector` matches nothing |
| `markdown(selector?)` | `Promise<string>` | Clean Markdown with absolute links |
| `html(selector?)` | `Promise<string>` | The page's HTML, or the first match's outer HTML |
| `links()` | `Promise<string[]>` | Every http(s) link: absolute, no fragments, de-duplicated, in page order. With `avoidHoneypots`, only links a person can see |
| `honeypots()` | `Promise<Honeypot[]>` | Links, buttons and fields a person couldn't see: `{ element, href, reason, box }` each. Works with the option off too. [Guide](/guide/honeypots) |
| `screenshot(options?)` | `Promise<Buffer>` | Playwright's screenshot options, such as `{ fullPage: true, path: 'page.png' }` |

## Consent

| Method | Returns | |
| --- | --- | --- |
| `waitForConsent({ timeout? })` | `Promise<ConsentStatus>` | Waits until the banner is dealt with, or `timeout` (default 5000) passes |
| `consentStatus()` | `ConsentStatus` | The status now |

Both throw `WraithError` if the `consent` option isn't set. [Guide](/guide/consent)

## CAPTCHAs and codes

| Method | Returns | |
| --- | --- | --- |
| `detectChallenge()` | `Promise<Challenge \| null>` | Finds a CAPTCHA, browser check or code prompt, with a PNG. Changes nothing |
| `handoff(options?: HandoffOptions)` | `Promise<Challenge \| null>` | Gets a person through it. Options override the `handoff` option |
| `blocked()` | `Promise<Block \| null>` | The bot protection block or challenge page showing, if any. `goto()` checks by itself. [Guide](/guide/bot-protection) |

[Guide](/guide/captchas)

## AI

`page.ai` throws `WraithError` if the `ai` option isn't set.

| Method | Returns | |
| --- | --- | --- |
| `ai.extract(schema, { instruction?, selector? })` | `Promise<z.infer<S>>` | Data matching a zod schema |
| `ai.ask(question, { selector? })` | `Promise<string>` | |
| `ai.act(instruction, { maxSteps?, variables?, timeout? })` | `Promise<ActResult>` | Defaults: 5 steps, 10000 ms per action. [ActResult](/reference/types#actresult) |

[Guide](/guide/ai)

## Properties

| Property | Type | |
| --- | --- | --- |
| `instance` | `number` | Which of the Wraith's [instances](/guide/proxies#instances) this page is in, from 0 |
| `raw` | Playwright `Page` | Everything Playwright offers. Input through `raw` isn't humanized |
| `human` | `Humanizer` | The page's input driver: `click(locator)`, `type(locator, text)`, `moveTo({ x, y })`, `scrollBy(dy)`, `fidget()`, `pause()` |
