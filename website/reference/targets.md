# Targets

```ts sig
type Target = string | Locator | TargetQuery;
```

- **`string`**: a CSS or Playwright selector, such as `'#save'`, `'button.primary'` or `'text=Save'`. The first match is used.
- **`Locator`**: a Playwright locator, used as is. Useful for iframes: `page.raw.frameLocator('iframe').locator('button')`.
- **`TargetQuery`**: a description of the element.

## TargetQuery

```ts sig
interface TargetQuery {
  role?: AriaRole;          // with name
  name?: string | RegExp;
  label?: string | RegExp;
  text?: string | RegExp;
  placeholder?: string | RegExp;
  alt?: string | RegExp;
  title?: string | RegExp;
  testId?: string | RegExp;
  exact?: boolean;
  within?: Target;
  nth?: number;
}
```

Give exactly one of `role`, `label`, `text`, `placeholder`, `alt`, `title` or `testId`; otherwise a `WraithError` is thrown.

| Key | Finds |
| --- | --- |
| `role` | By ARIA role. `name` is the accessible name: a button's or link's text, a field's label |
| `label` | A form field by its label, `aria-label` or `aria-labelledby` |
| `text` | An element by its text |
| `placeholder` | A field by its placeholder |
| `alt` | An image by its alt text |
| `title` | An element by its `title` attribute |
| `testId` | An element by its `data-testid` attribute |
| `exact` | Match strings exactly (case and whole text) instead of as case-insensitive substrings |
| `within` | Only look inside this target |
| `nth` | Which match to use, from 0. Default: the first |

These map to Playwright's `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`, `getByAltText`, `getByTitle` and `getByTestId`.

[Guide](/guide/targets)
