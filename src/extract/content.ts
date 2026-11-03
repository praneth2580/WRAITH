import { load, type CheerioAPI } from 'cheerio';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { WraithError } from '../errors.js';

/** Elements that never carry readable content. */
const NOISE = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  '[hidden]',
  '[aria-hidden="true"]',
  '[style*="display:none"]',
  '[style*="display: none"]',
].join(', ');

export interface ContentOptions {
  /** Only this part of the page (all matches). Default: the whole body. */
  selector?: string;
  /** Page URL, for making links absolute. */
  baseUrl?: string;
}

/**
 * The page as Markdown, with scripts, styles and hidden elements removed and links made
 * absolute. Compact and readable, which makes it good input for an LLM.
 */
export function htmlToMarkdown(html: string, options: ContentOptions = {}): string {
  const $ = load(html);
  $(NOISE).remove();
  if (options.baseUrl) absolutize($, options.baseUrl);
  const scope = select($, options.selector);
  const fragment = scope
    .toArray()
    .map((el) => $.html(el))
    .join('\n');
  return tidyMarkdown(NodeHtmlMarkdown.translate(fragment));
}

/** Drops whitespace that HTML indentation leaves behind, which only costs tokens. */
function tidyMarkdown(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => line.replace(/^(#{1,6})\s+/, '$1 ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Visible text with whitespace collapsed. */
export function htmlToText(html: string, selector?: string): string {
  const $ = load(html);
  $(NOISE).remove();
  return select($, selector).text().replace(/\s+/g, ' ').trim();
}

/** Every http(s) link on the page: absolute, without #fragments, de-duplicated, in page order. */
export function extractLinks($: CheerioAPI, baseUrl: string): string[] {
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      url.hash = '';
      links.add(url.href);
    } catch {
      // Malformed href; skip it.
    }
  });
  return [...links];
}

function select($: CheerioAPI, selector: string | undefined) {
  if (!selector) return $('body').length > 0 ? $('body') : $.root();
  const scope = $(selector);
  if (scope.length === 0) throw new WraithError(`No element matches selector "${selector}"`);
  return scope;
}

function absolutize($: CheerioAPI, baseUrl: string): void {
  // javascript: links lead nowhere a reader (or model) can follow; keep just their text.
  $('a[href^="javascript:" i]').removeAttr('href');
  for (const [selector, attr] of [
    ['a[href]', 'href'],
    ['img[src]', 'src'],
  ] as const) {
    $(selector).each((_, el) => {
      const value = $(el).attr(attr);
      if (!value) return;
      try {
        $(el).attr(attr, new URL(value, baseUrl).href);
      } catch {
        // Leave malformed URLs as they are.
      }
    });
  }
}
