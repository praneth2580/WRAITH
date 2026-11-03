// Scrape without a browser: fast, for pages that don't need JavaScript.
// Run: npm run example examples/static-scrape.ts
// (In your own project, import from 'wraithjs' instead of '../src/index.js'.)
import { createWraith } from '../src/index.js';

const wraith = createWraith();

let url: string | null = 'https://quotes.toscrape.com/';
const quotes: { text: string | null; author: string | null; tags: string[] }[] = [];

// Follow "Next" for three pages.
for (let i = 0; i < 3 && url; i++) {
  const page = await wraith.fetch(url);
  const data = page.extract({
    quotes: {
      selector: '.quote',
      list: true,
      fields: { text: '.text', author: '.author', tags: { selector: '.tag', list: true } },
    },
    next: 'li.next a@href',
  });
  quotes.push(...data.quotes);
  url = data.next;
}

console.log(`${quotes.length} quotes. First two:`);
console.log(quotes.slice(0, 2));
