import type { CheerioAPI } from 'cheerio';

type Json = Record<string, unknown>;

export interface MicrodataItem {
  /** The itemtype, such as "https://schema.org/Product". An array if there are several; null if none. */
  type: string | string[] | null;
  /** Each itemprop's values. Nested items appear as MicrodataItem. */
  properties: Record<string, unknown[]>;
}

/**
 * Data a page carries for search engines, link previews and its own JavaScript. Unlike the visible
 * HTML, it rarely changes when the site's design or class names do, so it's the most robust thing
 * to scrape when it has what you need.
 */
export interface StructuredData {
  /** Every JSON-LD object, with arrays and `@graph` unpacked. Products, articles, breadcrumbs… */
  jsonLd: Json[];
  /** schema.org microdata (`itemscope` / `itemprop`). */
  microdata: MicrodataItem[];
  /** OpenGraph and Twitter card tags, such as `og:title` and `twitter:image`. */
  openGraph: Record<string, string>;
  /** Other `<meta name>` tags, such as `description`. */
  meta: Record<string, string>;
  /**
   * JSON the page embeds for its own scripts: `<script type="application/json" id>` blocks such as
   * Next.js's `__NEXT_DATA__`, and on browser pages app state left on `window` (`__NUXT__`,
   * `__INITIAL_STATE__`, `__APOLLO_STATE__`…).
   */
  embedded: Record<string, unknown>;
}

/** window globals where common frameworks and stores leave their state. */
export const APP_STATE_GLOBALS = [
  '__NEXT_DATA__',
  '__NUXT__',
  '__INITIAL_STATE__',
  '__PRELOADED_STATE__',
  '__APOLLO_STATE__',
  '__REDUX_STATE__',
  '__APP_STATE__',
  '__INITIAL_DATA__',
  '__remixContext',
  '__staticRouterHydrationData',
];

export function structuredDataFromHtml($: CheerioAPI, baseUrl?: string): StructuredData {
  return {
    jsonLd: readJsonLd($),
    microdata: readMicrodata($, baseUrl),
    ...readMeta($),
    embedded: readEmbeddedJson($),
  };
}

/** JSON-LD objects whose `@type` is (or includes) `type`, e.g. `jsonLdOfType(data, 'Product')`. */
export function jsonLdOfType(data: StructuredData, type: string): Json[] {
  return data.jsonLd.filter((item) => {
    const types = [item['@type']].flat();
    return types.some((t) => typeof t === 'string' && (t === type || t.endsWith(`/${type}`)));
  });
}

function readJsonLd($: CheerioAPI): Json[] {
  const items: Json[] = [];
  const add = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(add);
    else if (value && typeof value === 'object') {
      const graph = (value as Json)['@graph'];
      if (Array.isArray(graph)) graph.forEach(add);
      else items.push(value as Json);
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    // Some sites wrap the JSON in HTML comments or CDATA markers.
    const raw = $(el)
      .text()
      .replace(/^\s*(<!--|\/\/\s*<!\[CDATA\[)/, '')
      .replace(/(-->|\/\/\s*\]\]>)\s*$/, '')
      .trim();
    try {
      add(JSON.parse(raw));
    } catch {
      // Invalid JSON-LD is common; skip the block.
    }
  });
  return items;
}

function readMeta($: CheerioAPI): Pick<StructuredData, 'openGraph' | 'meta'> {
  const openGraph: Record<string, string> = {};
  const meta: Record<string, string> = {};
  $('meta[content]').each((_, el) => {
    const key = ($(el).attr('property') ?? $(el).attr('name') ?? '').trim();
    const content = $(el).attr('content')!.trim();
    if (!key) return;
    const target = /^(og|twitter|article|product|book|profile|music|video):/i.test(key) ? openGraph : meta;
    target[key] ??= content;
  });
  return { openGraph, meta };
}

function readEmbeddedJson($: CheerioAPI): Record<string, unknown> {
  const embedded: Record<string, unknown> = {};
  $('script[type="application/json"][id]').each((_, el) => {
    try {
      embedded[$(el).attr('id')!] = JSON.parse($(el).text());
    } catch {
      // Not valid JSON; skip it.
    }
  });
  return embedded;
}

function readMicrodata($: CheerioAPI, baseUrl: string | undefined): MicrodataItem[] {
  type Node = Parameters<CheerioAPI['contains']>[0];

  const absolute = (value: string) => {
    try {
      return baseUrl ? new URL(value, baseUrl).href : value;
    } catch {
      return value;
    }
  };

  const propertyValue = (el: Node): unknown => {
    const node = $(el);
    const tag = (node.prop('tagName') ?? '').toLowerCase();
    if (tag === 'meta') return node.attr('content') ?? '';
    if (['a', 'link', 'area'].includes(tag)) return absolute(node.attr('href') ?? '');
    if (['img', 'audio', 'video', 'source', 'iframe', 'embed', 'track'].includes(tag)) {
      return absolute(node.attr('src') ?? '');
    }
    if (tag === 'object') return absolute(node.attr('data') ?? '');
    if (tag === 'time') return node.attr('datetime') ?? node.text().trim();
    if (tag === 'data' || tag === 'meter') return node.attr('value') ?? node.text().trim();
    return node.attr('content') ?? node.text().replace(/\s+/g, ' ').trim();
  };

  const readItem = (scope: Node): MicrodataItem => {
    const properties: Record<string, unknown[]> = {};
    $(scope)
      .find('[itemprop]')
      .each((_, prop) => {
        // Only properties that belong to this item, not to an item nested inside it.
        if ($(prop).parent().closest('[itemscope]')[0] !== scope) return;
        const value = $(prop).is('[itemscope]') ? readItem(prop) : propertyValue(prop);
        for (const name of ($(prop).attr('itemprop') ?? '').split(/\s+/).filter(Boolean)) {
          (properties[name] ??= []).push(value);
        }
      });
    const types = ($(scope).attr('itemtype') ?? '').split(/\s+/).filter(Boolean);
    return { type: types.length === 0 ? null : types.length === 1 ? types[0]! : types, properties };
  };

  return $('[itemscope]')
    .toArray()
    .filter((el) => !$(el).is('[itemprop]'))
    .map((el) => readItem(el));
}
