import robotsParserModule from 'robots-parser';
import type { Fetcher } from './proxy.js';

// robots-parser is CommonJS, but its types describe an ES module with a default export. Under
// Node the default import is the function itself; accept either shape.
type ParseRobots = typeof robotsParserModule.default;
const robotsParser: ParseRobots =
  typeof robotsParserModule === 'function' ? (robotsParserModule as ParseRobots) : robotsParserModule.default;

type Robots = ReturnType<ParseRobots>;

/**
 * Fetches and caches robots.txt once per origin. A missing, unreadable or unreachable file is
 * treated as allowing everything.
 */
export class RobotsCache {
  private readonly cache = new Map<string, Promise<Robots | null>>();

  constructor(
    private readonly userAgent: string | undefined,
    private readonly timeout: number,
    private readonly fetcher: Fetcher,
  ) {}

  async isAllowed(url: string): Promise<boolean> {
    const robots = await this.forUrl(url);
    return robots?.isAllowed(url, this.agentToken()) ?? true;
  }

  /** The Crawl-delay for this agent in seconds, if the site sets one. */
  async crawlDelay(url: string): Promise<number | undefined> {
    const robots = await this.forUrl(url);
    return robots?.getCrawlDelay(this.agentToken());
  }

  private agentToken(): string {
    return this.userAgent ?? '*';
  }

  private forUrl(url: string): Promise<Robots | null> {
    const origin = new URL(url).origin;
    let entry = this.cache.get(origin);
    if (!entry) {
      entry = this.load(origin);
      this.cache.set(origin, entry);
    }
    return entry;
  }

  private async load(origin: string): Promise<Robots | null> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const response = await this.fetcher.fetch(robotsUrl, {
        headers: this.userAgent ? { 'user-agent': this.userAgent } : {},
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!response.ok) return null;
      return robotsParser(robotsUrl, await response.text());
    } catch {
      return null;
    }
  }
}
