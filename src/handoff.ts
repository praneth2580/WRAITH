import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Page } from 'playwright';
import { ChallengeError } from './errors.js';
import { sleep } from './human/random.js';
import { detectChallenge, type ChallengeProvider, type RawChallenge } from './in-page.js';

export type { ChallengeProvider };

/** A CAPTCHA, browser check or one-time-code request that needs a person. */
export interface Challenge {
  kind: 'captcha' | 'otp' | 'browser-check';
  provider: ChallengeProvider;
  url: string;
  /** A one-line explanation to show whoever handles it. For codes, includes the page's own wording. */
  message: string;
  /** PNG of the challenge: the CAPTCHA image or widget, or the form asking for the code. */
  image: Buffer;
  /**
   * True when typing an answer solves it (image CAPTCHAs, one-time codes). False for widgets
   * such as reCAPTCHA that need clicks in a browser window.
   */
  answerable: boolean;
}

/**
 * Hands a challenge to a person. Return their answer to have it typed in (and submitted), or
 * return nothing once they've dealt with it some other way, for example in the browser window.
 */
export type ChallengeHandler = (challenge: Challenge) => string | void | Promise<string | void>;

export interface HandoffOptions {
  /** Check for challenges after every navigation and action, and hand them off. Default false. */
  auto?: boolean;
  /**
   * Who answers. Default: in a visible browser, the person at the window; when headless, a prompt
   * in this terminal showing where the image was saved.
   */
  onChallenge?: ChallengeHandler;
  /** How long to wait for a person, in ms. Default 300000 (5 minutes). */
  timeout?: number;
  /** Press Enter after typing an answer. Default true. */
  submit?: boolean;
}

export interface ResolvedHandoff {
  auto: boolean;
  onChallenge: ChallengeHandler | undefined;
  timeout: number;
  submit: boolean;
}

export function resolveHandoff(options: HandoffOptions = {}): ResolvedHandoff {
  return {
    auto: options.auto ?? false,
    onChallenge: options.onChallenge,
    timeout: options.timeout ?? 300_000,
    submit: options.submit ?? true,
  };
}

/** @internal What the hand-off needs from a WraithPage. */
export interface HandoffDriver {
  raw: Page;
  headless: boolean;
  /** Types the answer into the marked field, presses Enter if `submit`, and waits for the page. */
  typeAnswer(answer: string, submit: boolean): Promise<void>;
}

const NAMES: Record<ChallengeProvider, string> = {
  recaptcha: 'reCAPTCHA',
  hcaptcha: 'hCaptcha',
  turnstile: 'Cloudflare Turnstile',
  geetest: 'GeeTest',
  image: 'image',
  cloudflare: 'Cloudflare',
  otp: 'one-time code',
};

function describe(found: RawChallenge, url: string): string {
  if (found.kind === 'otp') return `${url} is asking for a one-time code${found.hint ? `: "${found.hint}"` : '.'}`;
  if (found.kind === 'browser-check') return `A ${NAMES[found.provider]} browser check on ${url} didn't clear by itself.`;
  if (found.provider === 'image') return `An image CAPTCHA appeared on ${url}. Type the characters it shows.`;
  return `A ${NAMES[found.provider]} CAPTCHA appeared on ${url}.`;
}

/** @internal */
export async function findChallenge(page: Page): Promise<RawChallenge | null> {
  // Mid-navigation there's no document to look at; the next check will see the new one.
  return page.evaluate(detectChallenge).catch(() => null);
}

/** @internal Screenshots the marked challenge element (or the whole page for full-page checks). */
export async function captureChallenge(page: Page, found: RawChallenge): Promise<Challenge> {
  let image: Buffer;
  try {
    image =
      found.kind === 'browser-check'
        ? await page.screenshot()
        : await page.locator('[data-wraith-challenge]').first().screenshot({ timeout: 5000 });
  } catch {
    image = await page.screenshot();
  }
  const url = page.url();
  return { kind: found.kind, provider: found.provider, url, message: describe(found, url), image, answerable: found.answerable };
}

/** Polls until the challenge is gone. Returns what's still there when time runs out, or null. */
async function waitWhilePresent(page: Page, ms: number): Promise<RawChallenge | null> {
  const deadline = Date.now() + ms;
  let found = await findChallenge(page);
  while (found && Date.now() < deadline) {
    await sleep(1000);
    found = await findChallenge(page);
  }
  return found;
}

/** The default handler: the browser window if there is one, otherwise this terminal. */
async function askPerson(challenge: Challenge, headless: boolean, timeoutMs: number): Promise<string | void> {
  // Printed directly, not through the logger: someone has to see this to act on it.
  if (!headless) {
    process.stderr.write(`\n[wraith] ${challenge.message}\n[wraith] Deal with it in the browser window; wraith carries on once it's gone.\n`);
    return;
  }
  if (!challenge.answerable) {
    throw new ChallengeError(
      `${challenge.message} It needs clicks in a browser window, and this browser is headless. ` +
        'Run with headless: false to solve it yourself, or pass handoff.onChallenge.',
    );
  }
  if (!process.stdin.isTTY) {
    throw new ChallengeError(`${challenge.message} There's no terminal to ask in. Pass handoff.onChallenge to answer it another way.`);
  }
  let where = '';
  if (challenge.kind === 'captcha') {
    const file = join(tmpdir(), `wraith-challenge-${Date.now()}.png`);
    await writeFile(file, challenge.image);
    where = `\n[wraith] Image: ${file}`;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`\n[wraith] ${challenge.message}${where}\n[wraith] Answer: `, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return answer.trim();
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new ChallengeError(`No answer within ${Math.round(timeoutMs / 1000)} s.`);
    throw error;
  } finally {
    rl.close();
  }
}

async function withTimeout<T>(value: T | Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ChallengeError(`No answer within ${Math.round(ms / 1000)} s.`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @internal Use `page.handoff()`. Finds a challenge and gets a person through it: their answer is
 * typed in (up to 3 tries if the site rejects it), or wraith waits while they solve it in the window.
 */
export async function runHandoff(driver: HandoffDriver, options: ResolvedHandoff): Promise<Challenge | null> {
  const { raw } = driver;
  let found = await findChallenge(raw);
  if (found?.kind === 'browser-check') {
    // These usually clear by themselves within a few seconds.
    found = await waitWhilePresent(raw, 15_000);
  }
  if (!found) return null;

  const deadline = Date.now() + options.timeout;
  let challenge: Challenge | undefined;
  for (let attempt = 1; found; attempt++) {
    if (attempt > 3) throw new ChallengeError(`${describe(found, raw.url())} It was still there after 3 answers.`);
    challenge = await captureChallenge(raw, found);
    const remaining = Math.max(deadline - Date.now(), 1000);
    const answer = options.onChallenge
      ? await withTimeout(options.onChallenge(challenge), remaining)
      : await askPerson(challenge, driver.headless, remaining);

    if (typeof answer === 'string' && answer.trim() !== '') {
      if (!found.hasAnswerField) {
        throw new ChallengeError(
          `${challenge.message} An answer was given, but there's no field to type it into. ` +
            'Return nothing from onChallenge and solve it in the browser instead.',
        );
      }
      await driver.typeAnswer(answer.trim(), options.submit);
      found = await findChallenge(raw);
    } else {
      found = await waitWhilePresent(raw, Math.max(deadline - Date.now(), 0));
      if (found) throw new ChallengeError(`${challenge.message} It wasn't dealt with within ${Math.round(options.timeout / 1000)} s.`);
    }
  }
  return challenge ?? null;
}
