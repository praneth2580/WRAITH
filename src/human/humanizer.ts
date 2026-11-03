import type { Locator, Page } from 'playwright';
import type { HumanBehavior } from './behavior.js';
import { neighbourKey } from './keyboard.js';
import { clamp, humanPath, overshootPoint, pointInBox, type Box, type Point, type TimedPoint } from './mouse.js';
import { sleep, type Range, type Rng } from './random.js';
import { hitsElement, inTopFrame } from '../in-page.js';

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  /** 2 for a double click. */
  clickCount?: number;
  timeout?: number;
}

export interface TypeOptions {
  /** Replace what's already in the field. Default true. */
  clear?: boolean;
  /** Allow typos (fixed straight away) for this call. Default true; turn off for fields that reformat as you type. */
  typos?: boolean;
  timeout?: number;
}

interface Viewport {
  width: number;
  height: number;
}

/**
 * Drives one Playwright page the way a person would. It tracks where the cursor is, since
 * Playwright doesn't expose that, so use one Humanizer per page.
 */
export class Humanizer {
  private cursor: Point | undefined;

  constructor(
    private readonly page: Page,
    readonly behavior: HumanBehavior,
    readonly rng: Rng,
    /** Used when an action doesn't pass its own timeout. */
    private readonly defaultTimeout = 30_000,
  ) {}

  get enabled(): boolean {
    return this.behavior.enabled;
  }

  /** Waits a random time from `range` (default: the action delay). Does nothing when humanizing is off. */
  async pause(range: Range = this.behavior.actionDelay): Promise<void> {
    if (this.enabled) await sleep(this.rng.inRange(range));
  }

  async click(target: Locator, options: ClickOptions = {}): Promise<void> {
    const { button = 'left', clickCount = 1, timeout } = options;
    if (!this.enabled || !this.behavior.mouse.enabled) {
      await this.pause();
      const delay = this.enabled ? this.rng.inRange(this.behavior.mouse.clickHold) : 0;
      await target.click({ button, clickCount, timeout, delay });
      return;
    }

    const deadline = Date.now() + (timeout ?? this.defaultTimeout);
    await target.waitFor({ state: 'visible', timeout });
    await this.pause();
    const aim = await this.waitUntilClickable(target, deadline, true);
    if (!aim) {
      // Still disabled or covered at the deadline, or in an iframe: Playwright's own click waits a
      // little longer and fails with a precise reason if it has to.
      await target.click({ button, clickCount, timeout: Math.max(deadline - Date.now(), 1000) });
      return;
    }
    await this.moveTo(aim.point, aim.box.width);
    await sleep(this.rng.inRange(this.behavior.mouse.hoverDelay));
    for (let i = 1; i <= clickCount; i++) {
      await this.page.mouse.down({ button, clickCount: i });
      await sleep(this.rng.inRange(this.behavior.mouse.clickHold));
      await this.page.mouse.up({ button, clickCount: i });
      if (i < clickCount) await sleep(this.rng.float(40, 110));
    }
  }

  /** Moves the cursor onto the target without clicking. */
  async hover(target: Locator, options: { timeout?: number } = {}): Promise<void> {
    if (!this.enabled || !this.behavior.mouse.enabled) {
      await target.hover({ timeout: options.timeout });
      return;
    }
    const deadline = Date.now() + (options.timeout ?? this.defaultTimeout);
    await target.waitFor({ state: 'visible', timeout: options.timeout });
    await this.pause();
    const aim = await this.waitUntilClickable(target, deadline, false);
    if (aim) await this.moveTo(aim.point, aim.box.width);
    else await target.hover({ timeout: Math.max(deadline - Date.now(), 1000) });
  }

  /** Clicks into the field, clears it if asked, then types one key at a time with occasional corrected typos. */
  async type(target: Locator, text: string, options: TypeOptions = {}): Promise<void> {
    const { clear = true, typos = true, timeout } = options;
    if (!this.enabled) {
      if (clear) await target.fill(text, { timeout });
      else await target.pressSequentially(text, { timeout });
      return;
    }

    await this.click(target, { timeout });
    const typing = this.behavior.typing;
    if (clear && (await currentValue(target))) {
      await this.page.keyboard.press('ControlOrMeta+A');
      await sleep(this.rng.inRange(typing.keyDelay));
      await this.page.keyboard.press('Backspace');
      await sleep(this.rng.inRange(typing.keyDelay));
    }

    for (const char of text) {
      if (typos && /^[a-z]$/i.test(char) && this.rng.chance(typing.typoChance)) {
        const wrong = neighbourKey(char, this.rng);
        if (wrong) {
          await this.page.keyboard.type(wrong);
          // A beat to notice the mistake before fixing it.
          await sleep(this.rng.inRange(typing.keyDelay) + this.rng.float(80, 300));
          await this.page.keyboard.press('Backspace');
          await sleep(this.rng.inRange(typing.keyDelay));
        }
      }
      if (char === '\n') await this.page.keyboard.press('Enter');
      else await this.page.keyboard.type(char);
      await sleep(this.rng.inRange(typing.keyDelay));
      if (char === ' ') await sleep(this.rng.inRange(typing.wordPause));
    }
  }

  /** Presses a key or chord such as "Enter" or "ControlOrMeta+A" on whatever has focus. */
  async press(key: string): Promise<void> {
    await this.pause();
    await this.page.keyboard.press(key, { delay: this.enabled ? this.rng.inRange(this.behavior.mouse.clickHold) : 0 });
  }

  /** Points at a <select> like a person reaching for it, then picks options by value or label. */
  async select(target: Locator, values: string | string[], options: { timeout?: number } = {}): Promise<void> {
    if (this.enabled) await this.hover(target, options);
    await target.selectOption(values, { timeout: options.timeout });
  }

  /** Scrolls vertically by `dy` pixels (positive is down) in uneven wheel ticks. */
  async scrollBy(dy: number): Promise<void> {
    if (!this.enabled) {
      await this.page.evaluate((delta) => window.scrollBy(0, delta), dy);
      return;
    }
    await this.ensureCursor();
    const { step, stepDelay } = this.behavior.scroll;
    const direction = Math.sign(dy);
    let remaining = Math.abs(dy);
    while (remaining >= 1) {
      const tick = Math.min(remaining, this.rng.inRange(step));
      await this.page.mouse.wheel(0, direction * tick);
      remaining -= tick;
      await sleep(this.rng.inRange(stepDelay));
    }
  }

  /** Wheel-scrolls until the target sits comfortably in view, the way a person would find it. */
  async scrollIntoView(target: Locator): Promise<void> {
    if (!this.enabled) {
      await target.scrollIntoViewIfNeeded();
      return;
    }
    const viewport = await this.viewport();
    for (let attempt = 0; attempt < 25; attempt++) {
      const box = await target.boundingBox();
      if (!box) break;
      // In view if its top, and enough of it to click, are on screen.
      const needed = Math.min(box.height, viewport.height * 0.5);
      if (box.y >= 0 && box.y + needed <= viewport.height) return;

      // Aim to bring it to roughly a third of the way down the screen.
      const delta = box.y - viewport.height * this.rng.float(0.25, 0.45);
      await this.scrollBy(delta);
      await sleep(this.rng.float(80, 200));
      const after = await target.boundingBox();
      // Didn't move: it's in a nested scroller the wheel isn't over, or the page can't scroll further.
      if (!after || Math.abs(after.y - box.y) < 1) break;
    }
    await target.scrollIntoViewIfNeeded().catch(() => {});
  }

  /** Moves the cursor to `to` along a human-looking path, sometimes overshooting and correcting. */
  async moveTo(to: Point, targetWidth = 40): Promise<void> {
    if (!this.enabled || !this.behavior.mouse.enabled) {
      await this.page.mouse.move(to.x, to.y);
      this.cursor = to;
      return;
    }
    const mouse = this.behavior.mouse;
    let from = await this.ensureCursor();
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance > 120 && this.rng.chance(mouse.overshootChance)) {
      const viewport = await this.viewport();
      const past = overshootPoint(from, to, this.rng);
      past.x = clamp(past.x, 0, viewport.width - 1);
      past.y = clamp(past.y, 0, viewport.height - 1);
      await this.follow(humanPath(from, past, this.rng, { ...mouse, targetWidth }));
      await sleep(this.rng.float(40, 140));
      from = past;
    }
    await this.follow(humanPath(from, to, this.rng, { ...mouse, targetWidth }));
  }

  /** A small idle drift of the cursor, like a hand resting on the mouse. */
  async fidget(): Promise<void> {
    if (!this.enabled || !this.behavior.mouse.enabled) return;
    const viewport = await this.viewport();
    const from = await this.ensureCursor();
    const to = {
      x: clamp(from.x + this.rng.gaussian(0, 60), 0, viewport.width - 1),
      y: clamp(from.y + this.rng.gaussian(0, 40), 0, viewport.height - 1),
    };
    await this.follow(humanPath(from, to, this.rng, { ...this.behavior.mouse, targetWidth: 100 }));
  }

  /**
   * Waits until the target can be clicked the way a person would: in view, enabled (when
   * `needEnabled`), no longer moving, and not covered where we aim. Returns where to aim, or
   * undefined if that didn't happen before the deadline or the target is inside an iframe.
   */
  private async waitUntilClickable(
    target: Locator,
    deadline: number,
    needEnabled: boolean,
  ): Promise<{ point: Point; box: Box } | undefined> {
    // Box coordinates are relative to the top page, so hit-testing inside an iframe can't work.
    if (!(await target.evaluate(inTopFrame).catch(() => true))) return undefined;
    await this.scrollIntoView(target);
    const viewport = await this.viewport();
    let previous: Box | null = null;
    while (Date.now() < deadline) {
      const box = await target.boundingBox().catch(() => null);
      const stable = box !== null && previous !== null && sameBox(box, previous);
      previous = box;
      if (!box || !stable) {
        await sleep(50);
        continue;
      }
      if (box.y + box.height <= 0 || box.y >= viewport.height) {
        // A layout change pushed it off screen.
        await this.scrollIntoView(target);
        previous = null;
        continue;
      }
      if (needEnabled && !(await target.isEnabled().catch(() => false))) {
        await sleep(100);
        continue;
      }
      const aim = await this.aimAt(target, box, viewport);
      if (aim) return aim;
      await sleep(100); // Covered, for example by a loading overlay.
    }
    return undefined;
  }

  /** Picks a point on the on-screen part of the target, trying a few until one isn't covered. */
  private async aimAt(target: Locator, box: Box, viewport: Viewport): Promise<{ point: Point; box: Box } | undefined> {
    const top = Math.max(box.y, 0);
    const bottom = Math.min(box.y + box.height, viewport.height);
    const visible = { x: box.x, y: top, width: box.width, height: bottom - top };
    if (visible.width < 1 || visible.height < 1) return undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const point = pointInBox(visible, this.rng);
      if (await target.evaluate(hitsElement, point).catch(() => false)) return { point, box: visible };
    }
    return undefined;
  }

  private async follow(path: TimedPoint[]): Promise<void> {
    for (const point of path) {
      await sleep(point.delay);
      await this.page.mouse.move(point.x, point.y);
      this.cursor = { x: point.x, y: point.y };
    }
  }

  /** The cursor position, placing it somewhere natural on first use rather than at (0, 0). */
  private async ensureCursor(): Promise<Point> {
    if (this.cursor) return this.cursor;
    const viewport = await this.viewport();
    const start = {
      x: this.rng.float(viewport.width * 0.3, viewport.width * 0.7),
      y: this.rng.float(viewport.height * 0.3, viewport.height * 0.7),
    };
    await this.page.mouse.move(start.x, start.y);
    this.cursor = start;
    return start;
  }

  private async viewport(): Promise<Viewport> {
    return (
      this.page.viewportSize() ??
      (await this.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
    );
  }
}

async function currentValue(target: Locator): Promise<string> {
  try {
    return await target.inputValue();
  } catch {
    return (await target.textContent().catch(() => null)) ?? '';
  }
}

const sameBox = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
