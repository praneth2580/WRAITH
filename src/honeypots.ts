import { honeypotReason } from './in-page.js';

type Check = (el: Element) => string | null;

/**
 * Turns a page function that takes a honeypot check as its second argument into one Playwright
 * can run. Playwright sends a function to the page as source text, so the check has to travel as
 * source too: this builds a function whose source includes both.
 */
export function withHoneypotCheck<A, R>(fn: (arg: A, isHoneypot: Check) => R): (arg: A) => R {
  return new Function('arg', `return (${fn.toString()})(arg, ${honeypotReason.toString()});`) as (arg: A) => R;
}

// Static pages have no styles to compute, so these look for the usual ways of hiding things in
// the markup itself: attributes, inline styles, and common utility classes.
const HIDDEN_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|(?:left|top)\s*:\s*-\d{3,}(?:\.\d+)?px|font-size\s*:\s*0(?:px)?\s*(?:;|$))/i;
const HIDDEN_CLASS = /(?:^|\s)(?:hidden|hide|d-none|invisible|sr-only|visually-hidden|visuallyhidden|screen-reader-text)(?:\s|$)/i;
// Tailwind's `hidden md:block` and Bootstrap's `d-none d-md-block` are shown on larger screens.
const SHOWN_LATER = /(?:^|\s)(?:(?:sm|md|lg|xl|2xl):(?:block|flex|inline|inline-block|inline-flex|grid|table)|d-(?:sm|md|lg|xl|xxl)-(?:block|flex|inline|inline-block|grid|table))(?:\s|$)/i;

interface MarkupNode {
  type: string;
  attribs?: Record<string, string>;
  parent: MarkupNode | null;
}

/** Whether the markup hides this element or one of its ancestors. A best guess, without CSS. */
export function looksHidden(el: MarkupNode): boolean {
  for (let node: MarkupNode | null = el; node && node.type === 'tag'; node = node.parent) {
    const attrs = node.attribs ?? {};
    if ('hidden' in attrs || attrs['aria-hidden'] === 'true') return true;
    if (attrs.style && HIDDEN_STYLE.test(attrs.style)) return true;
    if (attrs.class && HIDDEN_CLASS.test(attrs.class) && !SHOWN_LATER.test(attrs.class)) return true;
  }
  return false;
}
