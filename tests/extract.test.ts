import { load } from 'cheerio';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { findJson } from '../src/ai/client.js';
import { extractLinks, htmlToMarkdown, htmlToText } from '../src/extract/content.js';
import { extractHtml } from '../src/extract/schema.js';

const SHOP = `<!doctype html><html><head><base href="/shop/"><style>.x{}</style></head><body>
  <h1>  Store
     Name </h1>
  <a class="next" href="page/2">Next</a>
  <ul id="products">
    <li class="product"><a href="p/1">Widget</a><span class="price">$9.99</span><span class="tag">new</span><span class="tag">sale</span></li>
    <li class="product"><a href="p/2">Gadget</a><span class="price">$19.50</span></li>
  </ul>
  <a href="mailto:me@x.com">mail</a>
  <a href="p/1#reviews">Widget reviews</a>
  <a href="javascript:void(0)">nothing</a>
  <script>secret()</script>
  <p hidden>hidden text</p>
</body></html>`;

describe('extractHtml', () => {
  const data = extractHtml(
    SHOP,
    {
      title: 'h1',
      next: 'a.next@href',
      missing: '.nope',
      fallback: { selector: '.nope', default: 'n/a' },
      mail: 'a[href^="mailto:me@x.com"]',
      products: {
        selector: '.product',
        list: true,
        fields: {
          name: 'a',
          url: 'a@href',
          price: { selector: '.price', transform: (v) => Number(v.replace('$', '')) },
          tags: { selector: '.tag', list: true },
        },
      },
      firstProduct: { selector: '.product', fields: { name: 'a' } },
      prices: { selector: '.price', list: true, transform: (v) => Number.parseFloat(v.slice(1)) },
    },
    'https://example.com/index.html',
  );

  it('reads text, attributes, defaults and nested lists', () => {
    expect(data).toEqual({
      title: 'Store Name',
      next: 'https://example.com/shop/page/2',
      missing: null,
      fallback: 'n/a',
      mail: 'mail',
      products: [
        { name: 'Widget', url: 'https://example.com/shop/p/1', price: 9.99, tags: ['new', 'sale'] },
        { name: 'Gadget', url: 'https://example.com/shop/p/2', price: 19.5, tags: [] },
      ],
      firstProduct: { name: 'Widget' },
      prices: [9.99, 19.5],
    });
  });

  it('infers result types from the schema', () => {
    expectTypeOf(data.title).toEqualTypeOf<string | null>();
    expectTypeOf(data.fallback).toEqualTypeOf<string>();
    expectTypeOf(data.prices).toEqualTypeOf<number[]>();
    expectTypeOf(data.products).toEqualTypeOf<
      { name: string | null; url: string | null; price: number | null; tags: string[] }[]
    >();
    expectTypeOf(data.firstProduct).toEqualTypeOf<{ name: string | null } | null>();
  });
});

describe('page content', () => {
  it('converts to Markdown without scripts, styles or hidden elements, with absolute links', () => {
    const md = htmlToMarkdown(SHOP, { baseUrl: 'https://example.com/shop/' });
    expect(md).toContain('# Store Name');
    expect(md).toContain('[Widget](https://example.com/shop/p/1)');
    expect(md).not.toContain('secret()');
    expect(md).not.toContain('hidden text');
    expect(md).not.toContain('javascript:');
    expect(md.split('\n').every((line) => line === line.trimEnd())).toBe(true);
  });

  it('scopes to a selector, and says so when it matches nothing', () => {
    expect(htmlToText(SHOP, '#products')).toBe('Widget$9.99newsale Gadget$19.50');
    expect(() => htmlToMarkdown(SHOP, { selector: '#nope' })).toThrow(/No element matches/);
  });

  it('lists http links once each, without fragments', () => {
    const links = extractLinks(load(SHOP), 'https://example.com/shop/');
    expect(links).toEqual([
      'https://example.com/shop/page/2',
      'https://example.com/shop/p/1',
      'https://example.com/shop/p/2',
    ]);
  });
});

describe('findJson', () => {
  it('finds JSON in plain, fenced and chatty replies', () => {
    expect(findJson('{"a":1}')).toEqual({ a: 1 });
    expect(findJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(findJson('Sure! Here it is: [1, 2] Hope that helps.')).toEqual([1, 2]);
    expect(findJson('no json here')).toBeUndefined();
  });
});
