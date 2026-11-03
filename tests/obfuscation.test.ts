import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractHtml } from '../src/extract/schema.js';
import { jsonLdOfType } from '../src/extract/structured.js';
import { createWraith, type Wraith } from '../src/wraith.js';
import { json, startServer, type TestServer } from './helpers/server.js';

const PRODUCT = `<!doctype html><html><head>
<title>Lamp</title>
<meta name="description" content="A warm desk lamp">
<meta property="og:title" content="Lamp – Shop">
<meta property="og:image" content="https://cdn.test/lamp.jpg">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"Organization","name":"Shop Inc"},
  {"@type":"Product","name":"Lamp","sku":"AB-12","offers":{"@type":"Offer","price":"12.00","priceCurrency":"USD"}}
]}</script>
<script type="application/ld+json">{ this is not json }</script>
<script type="application/json" id="__NEXT_DATA__">{"props":{"pageProps":{"stock":7}}}</script>
</head><body>
<div itemscope itemtype="https://schema.org/Product">
  <h1 class="css-1q2w3e" itemprop="name">Lamp</h1>
  <img itemprop="image" src="/img/lamp.png">
  <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
    <meta itemprop="priceCurrency" content="USD"><span itemprop="price" content="12.00">$12</span>
  </div>
</div>
<script>window.__INITIAL_STATE__ = { cart: { count: 2 } };</script>
</body></html>`;

const API_PAGE = `<!doctype html><body><button id="more">More</button><div id="list"></div><script>
  let page = 1;
  async function load() {
    const data = await (await fetch('/api/items?page=' + page++)).json();
    list.insertAdjacentHTML('beforeend', data.items.map((i) => '<p>' + i + '</p>').join(''));
  }
  fetch('/api/other');
  load();
  more.onclick = load;
</script></body>`;

let server: TestServer;
let wraith: Wraith;

beforeAll(async () => {
  server = await startServer({
    '/product': PRODUCT,
    '/api-page': API_PAGE,
    '/api/items': (req, res) => {
      const page = Number(new URL(req.url!, 'http://x').searchParams.get('page'));
      json(res, 200, { page, items: [`item ${page}a`, `item ${page}b`] });
    },
    '/api/other': (_req, res) => json(res, 200, { other: true }),
  });
  wraith = createWraith({ human: 'fast', network: { rateLimit: false } });
});

afterAll(async () => {
  await wraith?.close();
  await server?.close();
});

describe('structured data', () => {
  it('reads JSON-LD, microdata, OpenGraph, meta and embedded JSON from static pages', async () => {
    const data = (await wraith.fetch(`${server.url}/product`)).structuredData();
    expect(jsonLdOfType(data, 'Product')).toEqual([
      expect.objectContaining({ name: 'Lamp', sku: 'AB-12', offers: expect.objectContaining({ price: '12.00' }) }),
    ]);
    expect(data.jsonLd).toHaveLength(2); // @graph unpacked; the broken block skipped
    expect(data.microdata).toEqual([
      {
        type: 'https://schema.org/Product',
        properties: {
          name: ['Lamp'],
          image: [`${server.url}/img/lamp.png`],
          offers: [{ type: 'https://schema.org/Offer', properties: { priceCurrency: ['USD'], price: ['12.00'] } }],
        },
      },
    ]);
    expect(data.openGraph).toEqual({ 'og:title': 'Lamp – Shop', 'og:image': 'https://cdn.test/lamp.jpg', 'twitter:card': 'summary' });
    expect(data.meta.description).toBe('A warm desk lamp');
    expect(data.embedded.__NEXT_DATA__).toEqual({ props: { pageProps: { stock: 7 } } });
  });

  it('also reads app state left on window, in the browser', async () => {
    const page = await wraith.open(`${server.url}/product`);
    const data = await page.structuredData();
    expect(data.embedded.__INITIAL_STATE__).toEqual({ cart: { count: 2 } });
    expect(jsonLdOfType(data, 'Product')[0]?.name).toBe('Lamp');
    await page.close();
  });
});

describe('captureJson', () => {
  it("collects the page's own API responses as it loads and as you click", async () => {
    const page = await wraith.newPage();
    const items = page.captureJson<{ page: number; items: string[] }>('/api/items');
    await page.goto(`${server.url}/api-page`);
    await items.waitFor(1);
    await page.click('#more');
    await items.waitFor(2);
    expect(items.data).toEqual([
      { page: 1, items: ['item 1a', 'item 1b'] },
      { page: 2, items: ['item 2a', 'item 2b'] },
    ]);
    expect(items.items[0]).toMatchObject({ method: 'GET', status: 200, url: `${server.url}/api/items?page=1` });

    items.stop();
    await page.click('#more');
    await page.waitForText('item 3a');
    expect(items.data).toHaveLength(2);
    await page.close();
  });

  it('matches with a RegExp or a function too', async () => {
    const page = await wraith.newPage();
    const other = page.captureJson((response) => response.url().endsWith('/api/other'));
    const all = page.captureJson(/\/api\//);
    await page.goto(`${server.url}/api-page`);
    expect((await other.next()).data).toEqual({ other: true });
    await all.waitFor(2);
    await page.close();
  });
});

describe('text and label matching', () => {
  const html = `
    <div class="css-1x2y3z"><span class="sc-a1">Price:</span> ₹499</div>
    <dl class="Specs_list__9fK2"><dt>SKU</dt><dd>AB-12</dd><dt>Brand</dt><dd>Acme</dd></dl>
    <table><tr><th>Weight</th><td>2 kg</td></tr></table>
    <ul><li>Colour: Blue</li><li>Size - Large</li></ul>
    <div><label>Stock</label></div><div>In stock</div>
    <nav><a class="x9f" href="/p/2">Next</a><a class="x9g" href="/p/0">Previous</a></nav>
    <section class="tw-mt-4 tw-flex"><div><div>Reviews</div><div>128</div></div></section>`;

  it('reads values next to their labels, whatever the markup', () => {
    expect(
      extractHtml(
        html,
        {
          price: { near: 'Price' },
          sku: { near: 'sku' },
          brand: { near: 'Brand' },
          weight: { near: 'Weight' },
          colour: { near: 'Colour' },
          size: { near: 'Size' },
          stock: { near: 'Stock' },
          reviews: { near: 'Reviews', transform: Number },
          missing: { near: 'Discount' },
          specs: { near: /^(SKU|Brand)$/, list: true },
        },
        'https://shop.test/p/1',
      ),
    ).toEqual({
      price: '₹499',
      sku: 'AB-12',
      brand: 'Acme',
      weight: '2 kg',
      colour: 'Blue',
      size: 'Large',
      stock: 'In stock',
      reviews: 128,
      missing: null,
      specs: ['AB-12', 'Acme'],
    });
  });

  it('finds elements by their text', () => {
    expect(
      extractHtml(
        html,
        {
          next: { text: 'next', attr: 'href' },
          prev: { text: /^prev/i, selector: 'a', attr: 'href' },
          stableClassPrefix: '[class^="Specs_list__"] dd',
        },
        'https://shop.test/p/1',
      ),
    ).toEqual({ next: 'https://shop.test/p/2', prev: 'https://shop.test/p/0', stableClassPrefix: 'AB-12' });
  });
});
