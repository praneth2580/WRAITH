---
layout: home

hero:
  name: wraith
  text: Web automation that behaves like a person
  tagline: Scraping and browser automation for Node.js with human-like input, typed extraction, polite networking and optional AI. All in your own process, with no server and no hosted service.
  image:
    src: /logo.svg
    alt: wraith
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: API reference
      link: /reference/create-wraith
    - theme: alt
      text: GitHub
      link: https://github.com/praneth2580/WRAITH

features:
  - icon: 🖱️
    title: Human behaviour, one option away
    details: Curved mouse paths with Fitts's-law timing and overshoot, typing with corrected typos, wheel scrolling and reading pauses. Pick a preset or tune any setting.
    link: /guide/human-behaviour
  - icon: ⚡
    title: Browser or plain HTTP
    details: A real browser for JavaScript-heavy sites, or a fast HTTP fetch for pages that don't need it. Both share one extraction API.
    link: /guide/pages
  - icon: 🧩
    title: Typed extraction
    details: Describe your data with CSS selectors and get typed results back, inferred from the schema itself.
    link: /guide/extracting
  - icon: ⏳
    title: Waits that understand the page
    details: Clicks wait until a button is enabled and uncovered. waitForSettled() waits for requests, spinners and skeletons to finish.
    link: /guide/waiting
  - icon: 🎭
    title: Robust to generated class names
    details: Find elements by role, label or text, read values next to their labels, or take the JSON the site loads from its own API.
    link: /guide/generated-class-names
  - icon: 🤝
    title: Polite by default
    details: A per-host rate limit, retries with backoff, and optional robots.txt checks including Crawl-delay.
    link: /guide/network
  - icon: 🍪
    title: Banners, pages and people
    details: Reject or accept cookie banners automatically, page through Next, Load more and infinite scroll, and hand CAPTCHAs to a person.
    link: /guide/pagination
  - icon: 🤖
    title: Optional AI
    details: Extract into a zod schema, ask questions, or give plain-language instructions. Ollama, Claude, OpenAI or any compatible server.
    link: /guide/ai
---

::: warning Beta
wraith is a pre-release. The API may still change before 1.0, so pin the exact version and read the [changelog](/changelog) before upgrading.
:::

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

Node.js 20.18.1 or later. ESM only, with TypeScript types included.

## See it work

<div class="home-split">
<div>

**In a browser, like a person.** The mouse travels a curved path to each element, keys are typed one at a time, and every action waits until its target is ready.

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith({ human: 'natural' });
try {
  const page = await wraith.open('https://quotes.toscrape.com/login');
  await page.type({ label: 'Username' }, 'me');
  await page.type({ label: 'Password' }, 'secret', { typos: false });
  await page.click({ role: 'button', name: 'Login' });
  console.log(await page.text('.header-box'));
} finally {
  await wraith.close();
}
```

</div>
<div>

**Without a browser, much faster.** Download the HTML and extract typed data with selectors. The result type comes from the schema.

```ts
import { createWraith } from 'wraithjs';

const wraith = createWraith();
const page = await wraith.fetch('https://books.toscrape.com/');

const { books } = page.extract({
  books: {
    selector: 'article.product_pod',
    list: true,
    fields: {
      title: 'h3 a@title',
      price: { selector: '.price_color', transform: (v) => Number(v.slice(1)) },
      link: 'h3 a@href', // made absolute for you
    },
  },
});
// books: { title: string | null; price: number | null; link: string | null }[]
```

</div>
</div>

## Built for real sites

- **Dynamic pages:** [wait for them to settle](/guide/waiting), [capture their JSON API](/guide/generated-class-names#_1-capture-the-site-s-own-api), [read embedded structured data](/guide/generated-class-names#_2-read-the-data-the-page-embeds).
- **Listings:** [Next buttons, Load more and infinite scroll](/guide/pagination), or [crawl a whole site](/guide/crawling) breadth-first.
- **Interruptions:** [cookie banners](/guide/consent), and [CAPTCHAs and one-time codes handed to a person](/guide/captchas).
- **Hard cases:** [AI extraction and plain-language actions](/guide/ai) with a local model or an API key.

## Built on solid libraries

wraith doesn't reinvent what already works: [Playwright](https://playwright.dev) drives the browser, [cheerio](https://cheerio.js.org) parses HTML, [zod](https://zod.dev) validates AI output, [p-queue](https://github.com/sindresorhus/p-queue) and [p-retry](https://github.com/sindresorhus/p-retry) handle rate limits and retries, [robots-parser](https://github.com/samclarke/robots-parser) reads robots.txt, [node-html-markdown](https://github.com/crosstype/node-html-markdown) produces Markdown, and DuckDuckGo's [autoconsent](https://github.com/duckduckgo/autoconsent) answers consent banners.
