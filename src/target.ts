import type { Locator, Page } from 'playwright';
import { WraithError } from './errors.js';

type AriaRole = Parameters<Page['getByRole']>[0];

/**
 * Find an element the way a person would describe it, instead of by CSS class. Useful on sites
 * whose class names are generated (`css-1x2y3z`, `Button_primary__3xYz`) and change every deploy.
 * Give exactly one of role, label, text, placeholder, alt, title or testId.
 *
 * ```ts
 * page.click({ role: 'button', name: 'Sign in' });
 * page.type({ label: 'Email' }, 'me@example.com');
 * page.click({ text: 'Next', within: { role: 'navigation' } });
 * ```
 */
export interface TargetQuery {
  /** ARIA role, such as 'button', 'link', 'textbox', 'checkbox' or 'navigation'. Use with `name`. */
  role?: AriaRole;
  /** The accessible name for `role`: a button's text, a link's text, a field's label. */
  name?: string | RegExp;
  /** A form field by its label text. */
  label?: string | RegExp;
  /** An element by its text. */
  text?: string | RegExp;
  /** A field by its placeholder. */
  placeholder?: string | RegExp;
  /** An image by its alt text. */
  alt?: string | RegExp;
  /** An element by its title attribute. */
  title?: string | RegExp;
  /** An element by its data-testid attribute. */
  testId?: string | RegExp;
  /** Match strings exactly (case and whole text) instead of as case-insensitive substrings. */
  exact?: boolean;
  /** Only look inside this element. */
  within?: Target;
  /** Which match to use when there are several, from 0. Default: the first. */
  nth?: number;
}

/** A CSS or Playwright selector string, a Playwright Locator, or a TargetQuery. */
export type Target = string | Locator | TargetQuery;

const KEYS = ['role', 'label', 'text', 'placeholder', 'alt', 'title', 'testId'] as const;

function isLocator(target: Locator | TargetQuery): target is Locator {
  return typeof (target as Locator).click === 'function';
}

/** Turns any Target into a Locator for one element. */
export function resolveTarget(page: Page, target: Target): Locator {
  if (typeof target === 'string') return page.locator(target).first();
  if (isLocator(target)) return target;

  const keys = KEYS.filter((key) => target[key] !== undefined);
  if (keys.length !== 1) {
    throw new WraithError(
      `A target needs exactly one of ${KEYS.join(', ')}; got ${keys.length > 0 ? keys.join(' and ') : 'none'}`,
    );
  }
  const scope: Page | Locator = target.within ? resolveTarget(page, target.within) : page;
  const exact = target.exact;
  let locator: Locator;
  switch (keys[0]) {
    case 'role':
      locator = scope.getByRole(target.role!, { name: target.name, exact });
      break;
    case 'label':
      locator = scope.getByLabel(target.label!, { exact });
      break;
    case 'text':
      locator = scope.getByText(target.text!, { exact });
      break;
    case 'placeholder':
      locator = scope.getByPlaceholder(target.placeholder!, { exact });
      break;
    case 'alt':
      locator = scope.getByAltText(target.alt!, { exact });
      break;
    case 'title':
      locator = scope.getByTitle(target.title!, { exact });
      break;
    default:
      locator = scope.getByTestId(target.testId!);
  }
  return target.nth !== undefined ? locator.nth(target.nth) : locator.first();
}
