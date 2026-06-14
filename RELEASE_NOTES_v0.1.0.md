# v0.1.0 — first public release

Editor-extension framework for [Bubble Card](https://github.com/Clooos/Bubble-Card). Runs a module's `editor_code` on the **unmodified** Bubble Card release and lets modules ship custom config controls — no fork, no patched build.

**Engine — owns parse + dispatch on stock Bubble Card.**
- Intercepts the read-side `_getProcessedSchema` to decorate a module's editor schema.
- RunGuard re-decorates on a fresh module object so bce wins back `yamlKeysMap` against the stock registry's async clobber.
- Re-processes on `yaml-modules-updated` so modules added mid-session pick up their editor.
- Union module discovery across YAML + localStorage caches.

**Author API — `window.BubbleCardEditor`.**
- `defineSelector(name, configOrClass)` registers `ha-selector-<name>`; accepts a config object or a custom-element class.
- `extends` resolution — subclass a base control and apply config without boilerplate.
- `selectors` registry + `override(name, impl)` for swapping/extending live controls.
- `schema.group / repeat / when` build editor schema in JS instead of repetitive YAML.

**Base control library.**
- `bce_js` — JS code field with a pluggable evaluator-hook live preview (guards a throwing evaluator).
- `bce_tags` — ordered chip list. Reorder by mouse, touch (`ha-sortable`), or keyboard (Ctrl/Cmd+←/→); free-text chips edit inline; full keyboard nav/removal.
- `bce_object` — structured object / list editor with `visible_if` / `warn_if`.

**Install:** HACS (custom Dashboard repository) or copy `dist/bubble-card-editor.js` to `/config/www/`, then add as a Lovelace JavaScript Module resource alongside Bubble Card. Requires Bubble Card installed first.
