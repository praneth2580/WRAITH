// Paginate with a browser (clicking "Next" like a person) and without one (following links).
// Run: npm run example examples/pagination.ts
import { createWraith } from '../src/index.js';

const wraith = createWraith({ human: 'fast', waits: { afterAction: 'settle' } });
const schema = { quotes: { selector: '.quote', list: true, fields: { text: '.text', author: '.author' } } } as const;

try {
  // Browser: find "Next" by its role and name rather than a CSS class.
  const page = await wraith.open('https://quotes.toscrape.com/');
  const browserQuotes = [];
  for await (const n of page.paginate({ next: { role: 'link', name: /Next/ }, maxPages: 3 })) {
    const { quotes } = await page.extract(schema);
    console.log(`browser page ${n}: ${quotes.length} quotes (${page.url()})`);
    browserQuotes.push(...quotes);
  }

  // No browser: follow the Next link's href. Much faster.
  const staticQuotes = [];
  for await (const p of wraith.paginate('https://quotes.toscrape.com/', { next: 'li.next a', maxPages: 3 })) {
    staticQuotes.push(...p.extract(schema).quotes);
  }

  console.log(`browser: ${browserQuotes.length} quotes, static: ${staticQuotes.length} quotes`);
  console.log('same results:', JSON.stringify(browserQuotes) === JSON.stringify(staticQuotes));
} finally {
  await wraith.close();
}
