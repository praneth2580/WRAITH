# Getting started

wraith is a Node.js library for web scraping and browser automation. It drives a real browser with input that looks like a person's: curved mouse paths, typing with corrected typos, wheel scrolling, pauses between actions. When you don't need a browser, it can also fetch and parse plain HTML much faster. Optional AI helpers can extract data or carry out instructions using a local model or an API key.

Everything runs inside your own process. There's no wraith server to deploy and no hosted service to sign up for.

## Requirements

- Node.js **20.18.1** or later.
- An ESM project (`"type": "module"` in `package.json`, or `.mjs` files). From CommonJS, see [Troubleshooting](/guide/troubleshooting#err-require-esm-or-require-of-es-module).
- TypeScript is optional; types are included.

## Install

::: code-group

```bash [npm]
npm install wraithjs@beta --save-exact
npx playwright install chromium
```

```bash [pnpm]
pnpm add wraithjs@beta --save-exact
pnpm exec playwright install chromium
```

```bash [yarn]
yarn add wraithjs@beta --exact
yarn playwright install chromium
```

:::

The second command downloads the browser that wraith drives (once per machine). You only need it for browser pages; [static fetches](/guide/pages) work without it.

::: tip Pin the version while wraith is in beta
`--save-exact` records the exact version, so an update can't change behaviour under you. Read the [changelog](/changelog) before upgrading.
:::

AI providers are optional peer dependencies. Install only the one you use:

```bash
npm install @anthropic-ai/sdk   # provider: 'anthropic'
npm install openai              # provider: 'openai' (also LM Studio, vLLM, OpenRouter…)
# provider: 'ollama' needs no package, just a running Ollama
```

## Your first scrape

Start without a browser. `wraith.fetch()` downloads a page and `extract()` pulls values out with CSS selectors:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith();
const page = await wraith.fetch('https://quotes.toscrape.com/');

const { quotes, next } = page.extract({
  quotes: {
    selector: '.quote',
    list: true,
    fields: {
      text: '.text',
      author: '.author',
      tags: { selector: '.tag', list: true },
    },
  },
  next: 'li.next a@href',
});

console.log(quotes.length, 'quotes; next page:', next);
```

`quotes` is typed as `{ text: string | null; author: string | null; tags: string[] }[]`, inferred from the schema. `next` is an absolute URL, or `null` on the last page. See [Extracting data](/guide/extracting) for the whole format.

## Your first browser automation

For pages that need JavaScript, logging in, or clicking around, open a browser page:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ human: 'natural' });

try {
  const page = await wraith.open('https://quotes.toscrape.com/login');
  await page.type('#username', 'me');                      // key by key, with the odd corrected typo
  await page.type('#password', 'secret', { typos: false }); // no typos in passwords
  await page.click('input[type=submit]');                   // curved mouse path, press, release

  console.log('Logged in:', await page.text('.header-box'));
} finally {
  await wraith.close();
}
```

A few things happen without you asking:

- The browser launches on the first browser page, not when you call `createWraith()`.
- Each action waits until its element is visible, enabled, still and uncovered before acting.
- After the click, wraith waits for the page load it started before your next line runs.
- Navigations go through a per-host rate limit, and failures are retried.

::: warning Always close
`wraith.close()` shuts the browser down. Without it, the browser keeps your Node.js process alive. Put it in a `finally` block.
:::

## Watch it work

While developing, show the browser window and slow things down:

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ headless: false, human: 'careful' });
```

Set `WRAITH_DEBUG=1` (or pass `logger: true`) to log retries, robots.txt decisions, consent handling and other events.

## Where next

- [Browser pages and static pages](/guide/pages): which one to use, and how they fit together.
- [Extracting data](/guide/extracting) and [Finding elements](/guide/targets): the two things you'll do most.
- [Human behaviour](/guide/human-behaviour): presets and every setting.
- [Waiting](/guide/waiting): for pages that load in stages.
- [API reference](/reference/create-wraith): every option and method.
