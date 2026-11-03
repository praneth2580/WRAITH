# Honeypots

A honeypot is a link, button or form field that's in a page's code but hidden from people, so that anything using it must be a bot. Common ones:

- a link styled `display: none`, or placed off-screen, that only crawlers follow (often to a URL robots.txt disallows);
- an invisible button, transparent or tucked behind other content;
- a form field placed off-screen, like "Leave this field empty", that only spam bots fill in.

Using one usually gets the visitor flagged or blocked. With `avoidHoneypots`, wraith stays clear of them.

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ avoidHoneypots: true });
```

## What it does

With the option on:

- **Actions refuse honeypots.** `click`, `dblclick`, `hover`, `type`, `fill`, `select`, `check`, `press` (with a target) and pagination clicks first wait for their element to become visible, as usual. If the element is still a honeypot a second later (which lets fade-ins finish), they throw `HoneypotError` instead of acting.
- **`links()` leaves hidden links out**, on browser and static pages, so [crawls](/guide/crawling) don't follow them.
- **`ai.act()` never sees honeypots**, so the model can't choose one.

```ts
import { HoneypotError } from 'wraithjs';

try {
  await page.click({ role: 'link', name: 'Free gift' });
} catch (error) {
  if (!(error instanceof HoneypotError)) throw error;
  console.warn(`Skipped ${error.element}: ${error.reason}`);
}
```

## What counts as a honeypot

An element a person couldn't see or reach:

| Reason | Example |
| --- | --- |
| `hidden (display: none, on it or a parent)` | `<a style="display:none">`, or inside a hidden container |
| `hidden (visibility: hidden)` | `visibility: hidden` |
| `transparent (opacity …)` | Opacity under 0.1, multiplying the opacity of its parents |
| `too small to see (W×H px)` | Smaller than 2×2 pixels, like the `sr-only` pattern |
| `positioned off the page` | `position: absolute; left: -9999px` |
| `clipped out of sight by its container` | Inside a `height: 0; overflow: hidden` box, or off the edge of one |
| `clipped to nothing` | `clip: rect(0 0 0 0)` or `clip-path: inset(50%)` |
| `text the same colour as its background` | White text on a white background |
| `text too small to see (font-size 0)` | `font-size: 0` |

What doesn't count:

- **Controls hidden behind a visible label.** Custom checkboxes, radios and file pickers often make the real `<input>` transparent and style its `<label>`. People click the label, so this is allowed. A field hidden *along with* its label is still a honeypot.
- **Elements below the fold.** They're on the page; wraith scrolls to them.
- **Elements covered by something else**, like a loading overlay. Actions already wait for those to be uncovered, honeypot option or not.

## Listing them

`page.honeypots()` lists the links, buttons and fields a person couldn't see, with the reason for each. It works with the option off too, so you can see what a page has:

```ts
const traps = await page.honeypots();
for (const trap of traps) console.log(trap.element, trap.href ?? '', trap.reason);
// a.promo "Free gift" /trap-1 transparent (opacity 0)
// input[name=website] positioned off the page
```

Each entry is `{ element, href, reason, box }`. In [devtools](/guide/devtools), the `honeypots` action outlines them on the screenshot.

## Static pages

Without a browser there's no CSS to compute, so static pages judge from the markup alone. With the option on, `links()` leaves out links that are, or are inside:

- elements with the `hidden` attribute or `aria-hidden="true"`;
- inline styles with `display: none`, `visibility: hidden`, `opacity: 0`, `font-size: 0`, or a large negative `left` or `top`;
- common hiding classes: `hidden`, `hide`, `d-none`, `invisible`, `sr-only`, `visually-hidden`, `screen-reader-text`. Responsive patterns that show the element on larger screens, such as Tailwind's `hidden md:block` or Bootstrap's `d-none d-lg-block`, are kept.

Links hidden by a stylesheet rule can't be detected this way. For sites that matter, crawl with a browser.

## Trade-offs

- **Hidden menus are skipped too.** A dropdown menu's links are hidden until you hover, and the contents of closed accordions and inactive tabs are hidden until clicked. `links()` leaves them out, because they look the same as traps. Most sites link those pages visibly elsewhere. To click into such content, open it first (`hover` the menu, `click` the tab); its elements then become visible and usable.
- **Carousels.** Slides outside a carousel's window count as clipped. Move the carousel to the slide first.
- **It's off by default**, because of these trade-offs and because it changes what `links()` returns. Turn it on for crawls of sites you don't own, and for form-filling.
