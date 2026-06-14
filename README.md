# Bubble Card Editor (extension)

[![Open your Home Assistant instance and open this repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=szsolt&repository=bubble-card-editor-extension&category=plugin)

Extends [Bubble Card](https://github.com/Clooos/Bubble-Card) with **custom editor
support** — letting any Bubble Card module ship a richer config editor than plain
YAML schema allows.

> ⚠️ **Requires [Bubble Card](https://github.com/Clooos/Bubble-Card).**
> This is an editor *extension* — install Bubble Card first. On its own it does
> nothing; it adds custom selector UI to Bubble Card's existing editor. It does
> not fork or replace Bubble Card and runs against the unmodified release.

## What it adds

Bubble Card modules describe their editor with a YAML `editor` schema built from
HA's standard form selectors. That covers simple fields, but not custom controls
— an ordered chip list, a JS code field with live preview, a structured object
editor, collapsible field groups, or schema generated dynamically from data.

This resource lets a module carry an **`editor_code`** block: a small piece of JS
that runs once when the module loads and can:

- register a custom `ha-selector-<name>` control — HA's `ha-form` then renders it
  anywhere the module's schema references it; and
- generate or rewrite the module's `editor` schema in JS instead of YAML.

It ships a small **author framework** (`window.BubbleCardEditor`) so you build
those controls and schema with minimal boilerplate, plus a library of ready-made
base controls you can use by name or extend.

## Install

1. Install via HACS (custom frontend repository) or copy
   `dist/bubble-card-editor.js` to `/config/www/`.
2. Add it as a Lovelace resource (type **JavaScript Module**), alongside Bubble
   Card:
   `/local/bubble-card-editor.js` (or the `/hacsfiles/...` path HACS gives you).
3. Modules that carry an `editor_code` block now get their custom editor.

## Author API — `window.BubbleCardEditor`

Available inside a module's `editor_code` (and to any loaded script).

```js
const E = window.BubbleCardEditor;
```

### `bc`

The lit primitives (from the bundled lit) plus `fireEvent`, for building custom
elements: `{ apiVersion, LitElement, html, css, nothing, fireEvent }`.

### `defineSelector(name, configOrClass)`

Register `ha-selector-<name>`. Pass **either** a config object (the framework
wraps it into a LitElement and wires `value` in / `value-changed` out):

```js
E.defineSelector('rating', {
  render(h, ctx) {
    return h`<input type="range" min="0" max="5"
      .value=${ctx.value ?? 0}
      @input=${(e) => ctx.setValue(Number(e.target.value))}>`;
  },
  // optional: parse(raw)->value on the way in, serialize(value)->raw on the way out
});
```

…**or** a custom-element class (a `LitElement` subclass or a plain
`HTMLElement`) when you need full control over lifecycle and internal state.

Reference it from your module's `editor` schema:

```yaml
editor:
  - name: stars
    selector: { rating: {} }
```

### `selectors`

The live registry of control classes by name (base library + anything defined).
Extend an existing control by subclassing:

```js
class MyTags extends E.selectors.bce_tags {
  // override render()/styles, call super.* as needed
}
E.defineSelector('my_tags', MyTags);
```

### `override(name, impl)`

Replace what a name resolves to. A custom element cannot be redefined once
defined, so `override` only swaps the **live element** if it runs *before* that
element is first defined; afterwards it updates the `selectors` registry only
(for subclassers). Override early, or define your variant under a new name.

### `schema`

Helpers to build editor schema in JS instead of repetitive YAML:

- `schema.group(title, fields, opts?)` — a collapsible group.
- `schema.repeat(template, countOrItems)` — N entries from `template(item, i)`.
- `schema.when(cond, fields)` — include `fields` only when `cond` is truthy.

```js
module.editor = [
  E.schema.group('Colors', E.schema.repeat(
    (i) => ({ name: `color_${i}`, selector: { text: {} } }), 3,
  )),
];
```

## Base control library

Ready-made controls registered on load; reference them in a module's `editor`
schema by name (`selector: { bce_tags: {} }`), or subclass via `selectors`:

- `bce_js` — a code field for JS expressions (optional live-preview hook).
- `bce_tags` — an ordered chip list, order significant. Reorder by mouse, touch
  (`ha-sortable`), or keyboard (Ctrl/Cmd+←/→); free-text chips edit inline.
- `bce_object` — a structured object / list editor.

## Example — a module using `editor_code`

A Bubble Card module is a YAML object with a `code` block (the card render) and,
with this extension installed, an optional `editor_code` block (the editor
setup). `editor_code` runs once when the module loads; it receives the module's
`module_id`, the `module` object (assign `module.editor` to set its form), and
`bc` (lit primitives). `window.BubbleCardEditor` is also in scope.

```yaml
my_filter_module:
  name: My Filter Module
  # ... the module's `code` (card render) goes here ...
  editor_code: |
    const E = window.BubbleCardEditor;

    // Drive the module's editor form from JS.
    module.editor = [
      { name: 'name', selector: { text: {} } },

      // The bce_tags base control: an ordered list of CSS filters. Order is
      // meaningful, so the chip order is the value order.
      {
        name: 'filters',
        selector: {
          bce_tags: {
            options: ['grayscale(1)', 'invert(1)', 'blur(2px)', 'sepia(1)'],
            custom_value: true,   // allow free-text chips, edited inline
          },
        },
      },

      // Collapsible group built with a schema helper.
      E.schema.group('Advanced', [
        { name: 'opacity', selector: { number: { min: 0, max: 1, step: 0.1 } } },
      ]),
    ];
```

The module's config now stores `filters` as an ordered string list, editable as
reorderable chips. To ship a *custom* control instead of a base one, call
`E.defineSelector('my_control', …)` in the same `editor_code` and reference
`selector: { my_control: {} }`.

## How it works

HA's `ha-form` renders any `{ name, selector }` entry through `ha-selector`,
which instantiates `ha-selector-<type>` by convention. Defining that element is
all it takes for the schema to render it. lit is bundled (HA exposes none to
resources); custom controls are self-contained web components — HA wires them
via plain properties and a `value-changed` event, so the bundled lit never
crosses into HA's.

The resource reads the module YAML, runs each module's `editor_code`, and places
the result into Bubble Card's editor via its module-update event. Loading the
resource twice is a no-op.

## Trust model

`editor_code` is evaluated via `new Function`, exactly as a Bubble Card module's
own `code` block already is on every card render. It grants no capability `code`
doesn't already have.
