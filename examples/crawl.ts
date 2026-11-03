// Crawl a site, collecting data from every product page.
// Run: npm run example examples/crawl.ts
import { createWraith } from '../src/index.js';

const wraith = createWraith({
  network: { rateLimit: { maxRequests: 5, intervalMs: 1000 }, respectRobotsTxt: true },
});

const { results, errors } = await wraith.crawl({
  mode: 'static', // no JavaScript needed on this site; use 'browser' for sites that need it
  start: 'https://books.toscrape.com/catalogue/category/books/mystery_3/index.html',
  maxPages: 25,
  maxDepth: 2,
  // Only follow book pages and the category's own pagination.
  include: (url) => /\/catalogue\/[^/]+_\d+\/index\.html$/.test(url) || /mystery_3\/page-\d+\.html$/.test(url),
  handler: ({ page }) =>
    page.extract({
      title: '.product_main h1',
      price: { selector: '.product_main .price_color', transform: (v) => Number(v.replace(/[^\d.]/g, '')) },
      stock: '.product_main .availability',
    }),
});

const books = results.filter((r) => r.data.title);
console.log(`Visited ${results.length} pages, found ${books.length} books, ${errors.length} errors.`);
console.table(books.slice(0, 5).map((r) => r.data));
