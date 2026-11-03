import { load, type Cheerio, type CheerioAPI } from 'cheerio';

/** cheerio's node type (from domhandler), which cheerio itself doesn't re-export. */
type AnyNode = Exclude<Parameters<typeof load>[0], string | Buffer | readonly unknown[]>;

/** Read a value from the matched element: its text by default, or an attribute, or its HTML. */
export interface ValueField {
  /** CSS selector inside the parent. Leave out to read the parent element itself. */
  selector?: string;
  /**
   * Match elements by their own text: a string matches the whole text, ignoring case and extra
   * spaces; a RegExp is tested against it. Combine with `selector` to narrow the candidates and
   * `attr` to read, e.g. `{ text: 'Next', attr: 'href' }`. For pages with generated class names.
   */
  text?: string | RegExp;
  /**
   * Read the value written next to a label: `{ near: 'Price' }` on "Price: ₹499" gives "₹499".
   * Looks after the label in the same element, then the next sibling (dt/dd, th/td, label/span),
   * then the element after the label's parent. Returns text; `attr` and `html` don't apply.
   */
  near?: string | RegExp;
  /** Read this attribute instead of the text. href, src, action and poster become absolute URLs. */
  attr?: string;
  /** Read inner HTML instead of text. */
  html?: boolean;
  /** Return every match as an array instead of just the first. */
  list?: boolean;
  /** Turn the string into something else, such as a number. Applied to each item of a list. */
  transform?: (value: string) => unknown;
  /** Returned when nothing matches. Default null. Ignored for lists, which are just empty. */
  default?: unknown;
}

/** Read an object (or a list of objects) whose fields are looked up inside each match. */
export interface NestedField {
  selector: string;
  list?: boolean;
  fields: SelectorSchema;
}

/**
 * A plain string is a selector whose trimmed text is returned. Add `@attr` to read an attribute
 * instead: `'a.next@href'`.
 */
export type FieldSpec = string | ValueField | NestedField;

export interface SelectorSchema {
  readonly [key: string]: FieldSpec;
}

type InferValue<F, Base> = F extends { list: true } ? Base[] : F extends { default: infer D } ? Base | D : Base | null;

export type InferField<F> = F extends string
  ? string | null
  : F extends { fields: infer S }
    ? F extends { list: true }
      ? InferSchema<S>[]
      : InferSchema<S> | null
    : F extends { transform: (value: string) => infer R }
      ? InferValue<F, R>
      : InferValue<F, string>;

/** The result type of extracting `S`. */
export type InferSchema<S> = { -readonly [K in keyof S]: InferField<S[K]> };

const URL_ATTRS = new Set(['href', 'src', 'action', 'poster']);

/** Extracts `schema` from a loaded document. `baseUrl` is used to make links absolute. */
export function extractWithSchema<const S extends SelectorSchema>(
  $: CheerioAPI,
  schema: S,
  baseUrl?: string,
): InferSchema<S> {
  return extractFields($, $.root(), schema, baseUrl) as InferSchema<S>;
}

/** Extracts `schema` from an HTML string. */
export function extractHtml<const S extends SelectorSchema>(html: string, schema: S, baseUrl?: string): InferSchema<S> {
  const $ = load(html);
  return extractWithSchema($, schema, documentBaseUrl($, baseUrl));
}

/** The document's base URL: its <base href> if it has one, resolved against the page URL. */
export function documentBaseUrl($: CheerioAPI, pageUrl: string | undefined): string | undefined {
  const base = $('base[href]').attr('href');
  if (!base) return pageUrl;
  try {
    return new URL(base, pageUrl).href;
  } catch {
    return pageUrl;
  }
}

function extractFields(
  $: CheerioAPI,
  root: Cheerio<AnyNode>,
  schema: SelectorSchema,
  baseUrl: string | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    out[key] = extractField($, root, normalize(spec), baseUrl);
  }
  return out;
}

function extractField(
  $: CheerioAPI,
  root: Cheerio<AnyNode>,
  spec: ValueField | NestedField,
  baseUrl: string | undefined,
): unknown {
  let matches: Cheerio<AnyNode> = spec.selector ? root.find(spec.selector) : root;

  if ('fields' in spec) {
    if (spec.list) return matches.toArray().map((el) => extractFields($, $(el), spec.fields, baseUrl));
    return matches.length > 0 ? extractFields($, matches.first(), spec.fields, baseUrl) : null;
  }

  const pattern = spec.near ?? spec.text;
  if (pattern !== undefined) {
    const candidates = spec.selector ? matches : root.find('*');
    matches = $(innermostMatching($, candidates, pattern, spec.near !== undefined));
  }

  const read = (el: Cheerio<AnyNode>): string | null => {
    if (spec.near !== undefined) return valueNear(el, spec.near);
    if (spec.attr) {
      const value = el.attr(spec.attr);
      if (value === undefined) return null;
      return URL_ATTRS.has(spec.attr) ? absolute(value.trim(), baseUrl) : value.trim();
    }
    if (spec.html) return el.html()?.trim() ?? null;
    return el.text().replace(/\s+/g, ' ').trim();
  };

  if (spec.list) {
    const values = matches
      .toArray()
      .map((el) => read($(el)))
      .filter((v): v is string => v !== null);
    return spec.transform ? values.map((v) => spec.transform!(v)) : values;
  }

  const value = matches.length > 0 ? read(matches.first()) : null;
  if (value === null) return spec.default ?? null;
  return spec.transform ? spec.transform(value) : value;
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

function textMatches(text: string, pattern: string | RegExp, asLabel: boolean): boolean {
  if (pattern instanceof RegExp) return pattern.test(text);
  const wanted = collapse(pattern).toLowerCase();
  const own = text.toLowerCase();
  return asLabel ? own.startsWith(wanted) : own === wanted;
}

/**
 * Elements whose text matches, keeping only the innermost: when a <div> and the <span> inside it
 * both match, the span is the one that holds the text.
 */
function innermostMatching(
  $: CheerioAPI,
  candidates: Cheerio<AnyNode>,
  pattern: string | RegExp,
  asLabel: boolean,
): AnyNode[] {
  const matched = candidates.toArray().filter((el) => textMatches(collapse($(el).text()), pattern, asLabel));
  return matched.filter((el) => !matched.some((other) => other !== el && $.contains(el as never, other as never)));
}

/** Removes the label from the start of `text`, along with the colon or dash after it. */
function afterLabel(text: string, label: string | RegExp): string {
  let rest: string;
  if (label instanceof RegExp) {
    const match = label.exec(text);
    rest = match ? text.slice(match.index + match[0].length) : '';
  } else {
    rest = text.slice(collapse(label).length);
  }
  return rest.replace(/^[\s:：\-–—|=]+/, '').trim();
}

/** The value that goes with a label element. See ValueField.near. */
function valueNear(label: Cheerio<AnyNode>, pattern: string | RegExp): string | null {
  // "Price: ₹499" in one element.
  const inline = afterLabel(collapse(label.text()), pattern);
  if (inline) return inline;
  // <li><b>Price:</b> ₹499</li>: the text right after the label.
  const node = label[0] as { next?: { type?: string; data?: string } | null } | undefined;
  const following = node?.next?.type === 'text' ? collapse(node.next.data ?? '') : '';
  if (following) return following;
  // <dt>Price</dt><dd>₹499</dd>, <th>…</th><td>…</td>, <span>Price</span><span>₹499</span>.
  const sibling = collapse(label.next().text());
  if (sibling) return sibling;
  // <div><label>Price</label></div><div>₹499</div>.
  const cousin = collapse(label.parent().next().text());
  return cousin || null;
}

/** Turns `'a.next@href'` into `{ selector: 'a.next', attr: 'href' }`. */
function normalize(spec: FieldSpec): ValueField | NestedField {
  if (typeof spec !== 'string') return spec;
  // The attribute is whatever follows the last "@", as long as it looks like an attribute name.
  // That leaves selectors like a[href^="mailto:me@x.com"] alone.
  const match = /^(.*)@([\w:-]+)$/.exec(spec);
  if (!match) return { selector: spec };
  return { selector: match[1]!.trim() || undefined, attr: match[2]! };
}

function absolute(value: string, baseUrl: string | undefined): string {
  if (!baseUrl) return value;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}
