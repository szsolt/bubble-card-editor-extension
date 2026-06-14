# Contributing

Thanks for your interest. This is an editor *extension* for
[Bubble Card](https://github.com/Clooos/Bubble-Card) — it does not fork or
replace Bubble Card.

## Setup

```bash
npm install
```

Node 22+.

## Source vs build

- Edit code under `src/`. **Never hand-edit `dist/bubble-card-editor.js`** — it
  is the bundled output.
- `dist/bubble-card-editor.js` is committed (HACS installs it from the release).
  Rebuild it whenever `src/` changes and commit the result in the same change.

```bash
npm run build      # bundle src/ -> dist/ (version baked from package.json)
npm run watch      # rebuild on change
```

CI rejects a PR whose committed `dist/` does not match a fresh build of `src/`.

## Tests

```bash
npm test           # node --test test/*.test.mjs
```

Add tests for tricky or regression-prone logic. Keep the suite green.

## Commits

Conventional commits with a component scope:

```
type(scope): summary

feat(tags): keyboard reorder
fix(engine): re-decorate on fresh module object
```

Types: `feat`, `fix`, `refactor`, `docs`, `perf`, `build`, `chore`, `test`.

## Pull requests

1. Branch from `main`.
2. Keep changes focused; rebuild `dist/` if you touched `src/`.
3. Ensure `npm test` and `npm run build` are clean.
4. Describe what changed and why.
