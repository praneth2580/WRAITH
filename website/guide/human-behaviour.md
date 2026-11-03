# Human behaviour

By default, wraith's browser input looks like a person's: the mouse travels to each element on a curved path, keys are typed one at a time with natural gaps and the occasional corrected typo, scrolling happens in wheel ticks, and there's a pause before each action. All of it is controlled by one option.

## Presets

Set it for every page on `createWraith({ human })`, or for one page with `wraith.newPage({ human })`:

| Value | Effect |
| --- | --- |
| `'natural'` (default) or `true` | Paced like an average person |
| `'fast'` | Still human-shaped (mouse paths, key-by-key typing), with short delays and no typos |
| `'careful'` | Slower and more deliberate, with more typos and overshoots |
| `'off'` or `false` | Plain Playwright: instant fills and clicks, no delays |
| `{ preset, ...overrides }` | Any preset with your own changes |

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ human: 'fast' });
const slowTab = await wraith.newPage({ human: 'careful' });
```

## Adjusting settings

Start from a preset and override only what you need. Times are in milliseconds; `[min, max]` ranges are sampled anew for every action, key or tick.

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({
  human: {
    preset: 'natural',
    actionDelay: [400, 1500],
    typing: { keyDelay: [80, 200], typoChance: 0.04 },
    mouse: { speed: 0.8, overshootChance: 0.3 },
  },
});
```

Every setting, with each preset's values:

| Setting | What it controls | natural | fast | careful |
| --- | --- | --- | --- | --- |
| `actionDelay` | Pause before each click, type, select or press | 250–900 | 60–220 | 600–2200 |
| `mouse.enabled` | Move along a path before clicking; `false` clicks without moving | true | true | true |
| `mouse.speed` | 1 is an average person; 2 is twice as fast | 1 | 2.5 | 0.7 |
| `mouse.overshootChance` | Chance of overshooting a distant target, then correcting | 0.15 | 0.05 | 0.25 |
| `mouse.jitter` | Pixels of wobble along the path | 2 | 1 | 3 |
| `mouse.hoverDelay` | Pause between arriving and pressing | 60–220 | 20–70 | 150–450 |
| `mouse.clickHold` | How long the button stays down | 50–130 | 25–60 | 70–180 |
| `typing.keyDelay` | Time per key | 55–170 | 15–55 | 90–260 |
| `typing.wordPause` | Extra pause after a space | 60–250 | 0–40 | 120–500 |
| `typing.typoChance` | Chance per letter of hitting a neighbouring key and fixing it | 0.02 | 0 | 0.035 |
| `scroll.step` | Pixels per wheel tick | 80–180 | 220–420 | 60–140 |
| `scroll.stepDelay` | Pause between wheel ticks | 30–110 | 10–40 | 60–200 |
| `reading.wordsPerMinute` | Pace for `page.read()` | 200–300 | 600–900 | 150–230 |

The presets are exported as `humanPresets` if you want to read them in code.

## Reproducible runs

Randomness comes from a seeded generator. Pass `seed` and every delay, path and typo repeats exactly, which helps when debugging a flaky flow:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ seed: 1234 });
```

Each page gets its own stream derived from the seed, so runs with several tabs stay reproducible too.

## What a click does

With humanizing on, `page.click(target)`:

1. waits the `actionDelay`;
2. waits until the element is visible, still, enabled and uncovered ([details](/guide/targets#what-ready-means));
3. scrolls it into view with wheel ticks if needed;
4. picks a point near the centre (never the edges), and checks nothing covers that exact point;
5. moves the cursor there along a Bézier curve. Speed follows a minimum-jerk profile (accelerate, cruise, decelerate), and Fitts's law sets the duration from the distance and the element's size. Long moves sometimes overshoot and correct;
6. pauses (`hoverDelay`), presses, holds (`clickHold`) and releases;
7. waits as [`waits.afterAction`](/guide/waiting#after-each-action) says.

Elements inside iframes are clicked with Playwright's own click, since their position can't be checked the same way.

## Typing

`page.type(target, text)` clicks the field, selects and deletes what's there (unless `clear: false`), then types key by key. With `typoChance` above zero it sometimes hits a neighbouring key on the keyboard, pauses, presses Backspace and types the right one.

Turn typos off for fields that react to each key, such as card numbers, masked inputs or autocomplete boxes, and for passwords:

```ts
await page.type({ label: 'Card number' }, '4242424242424242', { typos: false });
```

`page.fill(target, value)` sets a value instantly with no typing, when speed matters more than looking human.

## Scrolling and reading

```ts
await page.scroll({ by: 600 });              // wheel ticks down; negative goes up
await page.scroll({ to: 'bottom' });
await page.scroll({ to: { text: 'Reviews' } });
await page.read({ maxMs: 15_000 });          // scroll through at reading speed, with idle mouse drift
```

`read()` estimates how long the page's text would take to read at `reading.wordsPerMinute`, and spends up to `maxMs` scrolling through it. It does nothing with humanizing off.

## When to turn it off

Humanizing costs time: a natural click takes a second or more. Use `'fast'` or `'off'` for:

- pages you only read, where no input is needed,
- internal tools and test environments,
- bulk jobs where throughput matters more than appearance.

You can mix: `createWraith({ human: 'off' })` for most work, and `wraith.newPage({ human: 'natural' })` for the one flow that needs it.

## Lower-level control

`page.human` is the page's `Humanizer`, for movements wraith doesn't expose as page methods:

```ts
await page.human.moveTo({ x: 400, y: 300 });   // humanized cursor move to a point
await page.human.fidget();                      // a small idle drift
await page.human.pause();                       // one actionDelay
```

`humanPath()` and `pointInBox()` are also exported if you want the path maths without a browser.
