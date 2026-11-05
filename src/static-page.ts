import { load, type CheerioAPI } from 'cheerio';
import { ContentAI, type AIClient } from './ai/client.js';
import { detectBlock, type Block } from './blocks.js';
import { WraithError } from './errors.js';
import { extractLinks, htmlToMarkdown, htmlToText } from './extract/content.js';
import { documentBaseUrl, extractWithSchema, type InferSchema, type SelectorSchema } from './extract/schema.js';
import { structuredDataFromHtml, type StructuredData } from './extract/structured.js';

/**
 * A page downloaded without a browser (`wraith.fetch()`). Much faster than a browser page, but
 * it only has the HTML the server sent: nothing that JavaScript adds later.
 */
export class StaticPage {
  /** The parsed document, for anything the helpers don't cover. */
  readonly $: CheerioAPI;
  private aiHelper: ContentAI | undefined;
  private blockFound: Block | null | undefined;

  constructor(
    /** Final URL, after redirects. */
    readonly url: string,
    readonly status: number,
    readonly headers: Headers,
    /** The raw response body. */
    readonly body: string,
    private readonly aiClient?: AIClient,
    private readonly options: { avoidHoneypots?: boolean } = {},
  ) {
    this.$ = load(body);
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  /**
   * The bot protection service that answered instead of the site (its block page or challenge),
   * or null for an ordinary page. Only seen with `network.onBlock: 'return'`; otherwise `fetch()`
   * throws `BlockedError` instead.
   */
  get blocked(): Block | null {
    if (this.blockFound === undefined) {
      this.blockFound = detectBlock({ url: this.url, status: this.status, headers: this.headers, body: this.body });
    }
    return this.blockFound;
  }

  /** Pulls values out with CSS selectors. See SelectorSchema for the format. */
  extract<const S extends SelectorSchema>(schema: S): InferSchema<S> {
    return extractWithSchema(this.$, schema, this.baseUrl());
  }

  /**
   * The page's machine-readable data: JSON-LD, microdata, OpenGraph and meta tags, and embedded
   * JSON such as Next.js's __NEXT_DATA__. Survives redesigns and generated class names.
   */
  structuredData(): StructuredData {
    return structuredDataFromHtml(this.$, this.baseUrl());
  }

  /** Every http(s) link on the page, absolute and de-duplicated. */
  links(): string[] {
    return extractLinks(this.$, this.baseUrl(), { skipHidden: this.options.avoidHoneypots });
  }

  /** Visible text, or the text under `selector`. */
  text(selector?: string): string {
    return htmlToText(this.body, selector);
  }

  /** The page (or the part under `selector`) as clean Markdown. */
  markdown(selector?: string): string {
    return htmlToMarkdown(this.body, { selector, baseUrl: this.baseUrl() });
  }

  /** The body parsed as JSON, for API endpoints. */
  json<T = unknown>(): T {
    return JSON.parse(this.body) as T;
  }

  /** AI extraction and questions over this page. Needs the `ai` option. */
  get ai(): ContentAI {
    if (!this.aiClient) throw new WraithError('AI is not configured. Pass { ai: { provider: ... } } to createWraith().');
    this.aiHelper ??= new ContentAI(this.aiClient, async (selector) => ({
      url: this.url,
      markdown: this.markdown(selector),
    }));
    return this.aiHelper;
  }

  private baseUrl(): string {
    return documentBaseUrl(this.$, this.url) ?? this.url;
  }
}
