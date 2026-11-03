import { load, type Cheerio, type CheerioAPI } from 'cheerio';

/** cheerio's node type (from domhandler), which cheerio itself doesn't re-export. */
type AnyNode = Exclude<Parameters<typeof load>[0], string | Buffer | readonly unknown[]>;

/** Read a value from the matched element: its text by default, or an attribute, or its HTML. */
export interface ValueField {
  /** CSS selector inside the parent. Leave out to read the parent element itself. */
  selector?: string;
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
  const matches: Cheerio<AnyNode> = spec.selector ? root.find(spec.selector) : root;

  if ('fields' in spec) {
    if (spec.list) return matches.toArray().map((el) => extractFields($, $(el), spec.fields, baseUrl));
    return matches.length > 0 ? extractFields($, matches.first(), spec.fields, baseUrl) : null;
  }

  const read = (el: Cheerio<AnyNode>): string | null => {
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
