# Selector schemas

The format `extract()` takes on browser and static pages, and `extractHtml()` on any HTML.

```ts sig
interface SelectorSchema {
  readonly [key: string]: FieldSpec;
}

type FieldSpec = string | ValueField | NestedField;
```

## String

A CSS selector. The trimmed text of the first match, or `null`.

Add `@attr` to read an attribute instead: `'a.next@href'`, `'img@src'`, `'meta[name=description]@content'`.

## ValueField

```ts sig
interface ValueField {
  selector?: string;
  attr?: string;
  html?: boolean;
  list?: boolean;
  transform?: (value: string) => unknown;
  default?: unknown;
  text?: string | RegExp;
  near?: string | RegExp;
}
```

| Key | |
| --- | --- |
| `selector` | CSS selector inside the parent. Leave it out to read the parent element itself |
| `attr` | Read this attribute instead of the text. `href`, `src`, `action` and `poster` become absolute URLs |
| `html` | Read the inner HTML instead of the text |
| `list` | Return every match as an array instead of the first. An empty array when nothing matches |
| `transform` | Converts each value; applied to each item of a list |
| `default` | Returned when nothing matches, instead of `null`. Ignored for lists |
| `text` | Only elements whose own text matches: a string matches the whole text, ignoring case and extra spaces; a RegExp is tested against it |
| `near` | The value written next to a label: in the same element after the label, in the text right after it, in the next sibling (`dt`/`dd`, `th`/`td`, `label`/`span`), or in the element after the label's parent. Gives text; `attr` and `html` don't apply |

## NestedField

```ts sig
interface NestedField {
  selector: string;
  fields: SelectorSchema;
  list?: boolean;
}
```

Reads `fields` inside each match of `selector`. Without `list`, one object, or `null` when `selector` matches nothing; with `list`, an array of objects.

## Result types

The result type, `InferSchema<S>`, is worked out from the schema:

| Field spec | Type |
| --- | --- |
| `'h1'` | `string \| null` |
| `{ selector: '.tag', list: true }` | `string[]` |
| `{ selector: '.price', transform: Number }` | `number \| null` |
| `{ selector: '.stock', default: 'unknown' }` | `string` |
| `{ selector: '.n', transform: Number, default: 0 }` | `number` |
| `{ selector: '.item', fields: { name: 'h3' } }` | `{ name: string \| null } \| null` |
| `{ selector: '.item', list: true, fields: { name: 'h3' } }` | `{ name: string \| null }[]` |

When you define a schema separately from the `extract()` call, add `as const` so `list: true` keeps its literal type:

```ts
const schema = { tags: { selector: '.tag', list: true } } as const;
const { tags } = await page.extract(schema);   // string[]
```

[Guide](/guide/extracting)
