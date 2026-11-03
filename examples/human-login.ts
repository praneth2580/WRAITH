// Log in with human-like mouse movement and typing, then scrape behind the login.
// Run: npm run example examples/human-login.ts
// Watch it: HEADLESS=0 npm run example examples/human-login.ts
import { createWraith } from '../src/index.js';

const wraith = createWraith({
  headless: process.env.HEADLESS !== '0',
  human: 'natural', // or 'off' | 'fast' | 'careful', or { preset: 'natural', typing: { typoChance: 0.05 } }
  logger: true,
});

try {
  const page = await wraith.open('https://quotes.toscrape.com/login');
  await page.type('#username', 'demo-user');
  await page.type('#password', 'demo-password', { typos: false });
  await page.click('input[type=submit]');
  await page.waitFor('a[href="/logout"]');
  await page.read({ maxMs: 3000 }); // skim the page like a person would

  const { quotes } = await page.extract({
    quotes: { selector: '.quote', list: true, fields: { text: '.text', author: '.author', goodreads: 'a[href*="goodreads"]@href' } },
  });
  console.log(`Logged in. ${quotes.length} quotes on the first page, e.g.`, quotes[0]);
} finally {
  await wraith.close();
}
