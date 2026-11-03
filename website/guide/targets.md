# Finding elements

Every action that works on an element (`click`, `type`, `hover`, `select`, `check`, `waitFor`, `paginate`…) takes a **target**. A target can be:

- a **selector string**: CSS such as `'#login'` or `'button.primary'`, or any Playwright selector such as `'text=Sign in'`;
- a **description** of the element, the way a person would describe it: `{ role: 'button', name: 'Sign in' }`;
- a Playwright **`Locator`**, if you've built one yourself.

When a selector matches several elements, wraith uses the first.

## Describing elements

Descriptions survive redesigns and generated class names, because they rely on what the user sees, not on markup details:

```ts
await page.click({ role: 'button', name: 'Add to cart' });
await page.type({ label: 'Email' }, 'me@example.com');
await page.type({ placeholder: 'Search products' }, 'lamp');
await page.click({ text: 'Accept all' });
await page.click({ alt: 'Company logo' });
await page.click({ title: 'Close dialog' });
await page.click({ testId: 'checkout-button' });
```

A description needs exactly one of these keys:

| Key | Finds | Example |
| --- | --- | --- |
| `role` | By ARIA role, with `name` for its accessible name | `{ role: 'link', name: 'Pricing' }` |
| `label` | A form field by its `<label>` (or `aria-label`) | `{ label: 'Password' }` |
| `text` | An element by its text | `{ text: 'Load more' }` |
| `placeholder` | A field by its placeholder | `{ placeholder: 'you@example.com' }` |
| `alt` | An image by its alt text | `{ alt: 'Product photo' }` |
| `title` | An element by its `title` attribute | `{ title: 'Settings' }` |
| `testId` | An element by `data-testid` | `{ testId: 'submit' }` |

Common roles: `button`, `link`, `textbox`, `checkbox`, `radio`, `combobox` (a `<select>`), `heading`, `listitem`, `navigation`, `dialog`, `tab`, `menuitem`.

### Matching rules

Strings match **case-insensitively, as substrings**: `{ text: 'next' }` matches "Next page". For an exact match, add `exact: true`. For anything more precise, use a RegExp:

```ts
await page.click({ role: 'button', name: 'Save', exact: true });  // not "Save draft"
await page.click({ role: 'link', name: /^next/i });
```

### Narrowing down

```ts
// Only inside another element:
await page.click({ text: 'Next', within: { role: 'navigation' } });
await page.click({ role: 'button', name: 'Delete', within: '#row-42' });

// The third match (counting from 0):
await page.click({ role: 'link', name: 'Details', nth: 2 });
```

## What "ready" means

Before acting, wraith waits for the element to be:

1. attached to the page and visible,
2. scrolled into view (with the mouse wheel, when humanized),
3. no longer moving (animations finished),
4. enabled, for clicks on buttons and fields,
5. not covered by anything else at the point it will click, such as a modal backdrop or a loading overlay.

It keeps checking until all five hold or the timeout passes (`network.timeout`, 30 seconds by default, or the action's `timeout` option). So you rarely need explicit waits before an action. See [Waiting](/guide/waiting) for what happens after.

## Choosing a target

In rough order of robustness:

1. **`testId`**, if the site has test IDs. They exist to stay stable.
2. **`role` + `name`**, or **`label`** for form fields. These follow what users see.
3. **Stable attributes**: `'[name="email"]'`, `'[href="/cart"]'`, `'[aria-label="Close"]'`.
4. **Partial class names** on CSS-module sites: `'[class*="Header_menu__"]'` (the prefix is stable, the hash isn't).
5. **Plain CSS classes**, when the site's classes are meaningful and stable.

When a target doesn't behave as you expect, the [devtools](/guide/devtools) `inspect` action shows every element it matches, which one wraith uses, and whether that element is visible, enabled and uncovered.
