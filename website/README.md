# wraith website

The landing page and documentation at https://praneth2580.github.io/WRAITH/, built with [VitePress](https://vitepress.dev). It's separate from the library: it has its own `package.json`, and nothing here is in the npm package.

```bash
cd website
npm install
npm run dev       # live preview at http://localhost:5173/WRAITH/
npm run check     # type-check every ts example in the docs against ../src (needs the root's npm install)
npm run build     # static site in .vitepress/dist; fails on broken links
npm run preview   # serve the built site
npm run deploy    # build, then push .vitepress/dist to the gh-pages branch
```

## Writing docs

- Pages are Markdown: `index.md` (landing page), `guide/`, `reference/`, `changelog.md`. The sidebar and navigation are in `.vitepress/config.mts`.
- Every ` ```ts ` block is type-checked by `npm run check`. Fragments can use `wraith`, `page` and `url` without declaring them. Mark signatures and type sketches that aren't runnable code as ` ```ts sig `.
- Links between pages are absolute without the base or extension: `[Waiting](/guide/waiting)`.
- When the library's API changes, update the reference pages and `changelog.md`, then run `npm run check`.

## Deploying

`npm run deploy` publishes to the `gh-pages` branch of the repository's `origin` remote. The first time, turn on GitHub Pages: on GitHub, open the repository's **Settings → Pages**, set **Source** to "Deploy from a branch", and choose `gh-pages` and `/ (root)`.

The site is served under `/WRAITH/`. If the repository is renamed, change `base` in `.vitepress/config.mts` to match.
