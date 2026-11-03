import PQueue from 'p-queue';

export type UrlFilter = RegExp | ((url: string) => boolean);

export interface CrawlContext<P> {
  url: string;
  /** 0 for start URLs, 1 for pages they link to, and so on. */
  depth: number;
  page: P;
  /** Adds URLs to the crawl (relative URLs are resolved against this page). Same limits and filters apply. */
  enqueue(urls: string | string[]): void;
}

export interface CrawlOptions<P, T> {
  /** Where to start. Start URLs are always visited, whatever the filters say. */
  start: string | string[];
  /** 'browser' (default) runs JavaScript; 'static' only downloads HTML and is far faster. */
  mode?: 'browser' | 'static';
  /** Stop after this many pages. Default 50. */
  maxPages?: number;
  /** How many links away from a start URL to go. Default 2. */
  maxDepth?: number;
  /** Queue every link found on each page. Turn off to choose links yourself with `enqueue`. Default true. */
  followLinks?: boolean;
  /** Only visit URLs on the start URLs' origins. Default true. */
  sameOrigin?: boolean;
  /** Only visit URLs that match. */
  include?: UrlFilter;
  /** Never visit URLs that match. */
  exclude?: UrlFilter;
  /** Pages open at once. The per-host rate limit still applies. Default 3. */
  concurrency?: number;
  /** Runs for every page. Whatever it returns ends up in `results`. */
  handler: (context: CrawlContext<P>) => T | Promise<T>;
  /** Called when a page fails. Failures are also collected in `errors`. */
  onError?: (url: string, error: Error) => void;
}

export interface CrawlResult<T> {
  results: { url: string; depth: number; data: T }[];
  errors: { url: string; error: Error }[];
}

/** @internal Opens a page of the right kind for the crawl mode. */
export interface PageOpener<P> {
  open(url: string): Promise<P>;
  links(page: P): Promise<string[]>;
  close(page: P): Promise<void>;
}

const matches = (filter: UrlFilter, url: string) => (typeof filter === 'function' ? filter(url) : filter.test(url));

function normalize(url: string, base?: string): string | undefined {
  try {
    const parsed = new URL(url, base);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    parsed.hash = '';
    return parsed.href;
  } catch {
    return undefined;
  }
}

/** @internal Use `wraith.crawl()`. */
export async function runCrawl<P, T>(options: CrawlOptions<P, T>, opener: PageOpener<P>): Promise<CrawlResult<T>> {
  const { maxPages = 50, maxDepth = 2, followLinks = true, sameOrigin = true, concurrency = 3 } = options;
  const startUrls = [options.start]
    .flat()
    .map((url) => normalize(url))
    .filter((url): url is string => url !== undefined);
  const origins = new Set(startUrls.map((url) => new URL(url).origin));
  const seen = new Set<string>();
  const queue = new PQueue({ concurrency });
  const result: CrawlResult<T> = { results: [], errors: [] };

  const allowed = (url: string) =>
    (!sameOrigin || origins.has(new URL(url).origin)) &&
    (!options.include || matches(options.include, url)) &&
    !(options.exclude && matches(options.exclude, url));

  const schedule = (url: string, depth: number, isStart = false) => {
    if (seen.has(url) || seen.size >= maxPages || depth > maxDepth) return;
    if (!isStart && !allowed(url)) return;
    seen.add(url);
    void queue.add(() => visit(url, depth));
  };

  const visit = async (url: string, depth: number) => {
    let page: P | undefined;
    try {
      page = await opener.open(url);
      const enqueue = (urls: string | string[]) => {
        for (const next of [urls].flat()) {
          const normalized = normalize(next, url);
          if (normalized) schedule(normalized, depth + 1);
        }
      };
      const data = await options.handler({ url, depth, page, enqueue });
      result.results.push({ url, depth, data });
      if (followLinks && depth < maxDepth) enqueue(await opener.links(page));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      result.errors.push({ url, error: err });
      options.onError?.(url, err);
    } finally {
      if (page !== undefined) await opener.close(page).catch(() => {});
    }
  };

  for (const url of startUrls) schedule(url, 0, true);
  await queue.onIdle();
  return result;
}
