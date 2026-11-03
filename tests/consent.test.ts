import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WraithError } from '../src/errors.js';
import { createWraith } from '../src/wraith.js';
import { startServer, type TestServer } from './helpers/server.js';

// A custom banner, not from any consent platform, so autoconsent's heuristic has to find it.
const BANNER = `<!doctype html><html lang="en"><head><title>Shop</title></head><body>
<h1>Shop</h1><p>Welcome to the shop.</p>
<div id="cookie-banner" role="dialog" aria-label="Cookie consent"
     style="position:fixed;bottom:0;left:0;right:0;padding:24px;background:#fff;border-top:1px solid #ccc;z-index:1000">
  <p>We use cookies to improve your experience and for analytics. You can accept all cookies or reject non-essential cookies.</p>
  <button id="reject" onclick="choose('reject')">Reject all</button>
  <button id="accept" onclick="choose('accept')">Accept all</button>
</div>
<script>
  function choose(choice) {
    window.consentChoice = choice;
    document.getElementById('cookie-banner').remove();
  }
</script></body></html>`;

let server: TestServer;

beforeAll(async () => {
  server = await startServer({ '/': BANNER, '/plain': '<h1>No banner here</h1>' });
});

afterAll(() => server?.close());

async function visit(consent: 'reject' | 'accept' | false) {
  const wraith = createWraith({ human: 'fast', network: { rateLimit: false }, consent });
  const page = await wraith.open(`${server.url}/`);
  return { wraith, page };
}

describe('consent banners', () => {
  it("rejects non-essential cookies with consent: 'reject'", async () => {
    const { wraith, page } = await visit('reject');
    try {
      const status = await page.waitForConsent({ timeout: 10_000 });
      expect(status).toMatchObject({ done: true, succeeded: true });
      expect(await page.raw.evaluate(() => (window as { consentChoice?: string }).consentChoice)).toBe('reject');
      expect(await page.raw.locator('#cookie-banner').count()).toBe(0);
    } finally {
      await wraith.close();
    }
  });

  it("accepts with consent: 'accept'", async () => {
    const { wraith, page } = await visit('accept');
    try {
      await page.waitForConsent({ timeout: 10_000 });
      expect(await page.raw.evaluate(() => (window as { consentChoice?: string }).consentChoice)).toBe('accept');
    } finally {
      await wraith.close();
    }
  });

  it('leaves banners alone by default', async () => {
    const { wraith, page } = await visit(false);
    try {
      await page.wait(1500);
      expect(await page.raw.locator('#cookie-banner').isVisible()).toBe(true);
      expect(() => page.consentStatus()).toThrow(WraithError);
    } finally {
      await wraith.close();
    }
  });

  it('reports nothing done on pages without a banner, without failing', async () => {
    const wraith = createWraith({ human: 'fast', network: { rateLimit: false }, consent: 'reject' });
    try {
      const page = await wraith.open(`${server.url}/plain`);
      expect(await page.waitForConsent({ timeout: 1500 })).toMatchObject({ done: false });
    } finally {
      await wraith.close();
    }
  });
});
