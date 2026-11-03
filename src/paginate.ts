import type { Locator, Page } from 'playwright';
import { WraithError } from './errors.js';
import { sleep } from './human/random.js';
import { controlUsable, pageSignature } from './in-page.js';
import type { Target } from './target.js';

export interface PaginateOptions {
  /** A "Next" link or button. Clicked until it's missing, disabled, or stops changing the page. */
  next?: Target;
  /** A "Load more" button. Clicked until it's missing or disabled; results pile up on one page. */
  loadMore?: Target;
  /** Infinite scroll: scroll to the bottom for each new batch. */
  scroll?: boolean;
  /** Most pages (or batches) to go through, counting the first. Default 10. */
  maxPages?: number;
  /** How long to wait for new content after each step before deciding there's no more, in ms. Default 5000. */
  waitMs?: number;
}

/** @internal What pagination needs from a WraithPage. */
export interface PaginationDriver {
  raw: Page;
  locate(target: Target): Locator;
  click(target: Locator): Promise<void>;
  scrollToBottom(): Promise<void>;
  settle(): Promise<void>;
}

async function signature(page: Page): Promise<string | undefined> {
  // Undefined while the page is between documents.
  return page.evaluate(pageSignature).catch(() => undefined);
}

/** Waits for the page's URL or text to differ from `before`. */
async function changed(page: Page, before: string | undefined, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const now = await signature(page);
    if (now !== undefined && now !== before) return true;
    await sleep(150);
  }
  return false;
}

/** @internal Use `page.paginate()`. */
export async function* paginate(driver: PaginationDriver, options: PaginateOptions): AsyncGenerator<number> {
  const control = options.next ?? options.loadMore;
  const modes = [options.next, options.loadMore, options.scroll ? true : undefined].filter((m) => m !== undefined);
  if (modes.length !== 1) throw new WraithError('paginate() needs exactly one of next, loadMore or scroll');
  const { maxPages = 10, waitMs = 5000 } = options;

  yield 1;
  for (let page = 2; page <= maxPages; page++) {
    const before = await signature(driver.raw);
    if (control !== undefined) {
      const button = driver.locate(control);
      if ((await button.count()) === 0) return;
      if (!(await button.evaluate(controlUsable).catch(() => false))) return;
      await driver.click(button);
    } else {
      await driver.scrollToBottom();
    }
    if (!(await changed(driver.raw, before, waitMs))) return;
    await driver.settle();
    yield page;
  }
}
