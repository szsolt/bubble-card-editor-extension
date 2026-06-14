// `bce_tags` — ordered chips input. selector: { bce_tags: { options, custom_value,
// implicit_default } }. options entries are strings or { label, value }. Value is
// a list of strings. Chips reorder (mouse + touch via ha-sortable); order is
// meaningful (CSS filters chain in order). While the list is empty the input
// placeholder names what is in force (context.single sibling value, else
// implicit_default).
//
// Fully usable by mouse, keyboard, and touch:
//   - reorder: ha-sortable (touch-aware), whole chip is the handle.
//   - keyboard: roving tabindex — one Tab stop; ←/→ walk chips, Delete/Backspace
//     removes the focused chip, Enter edits a free-text chip, Escape returns to
//     the input.
//   - inline edit: free-text chips (custom_value !== false) edit in place,
//     keeping position; Enter commits, Esc reverts, blur commits, empty removes.
//
// A lit element registered as ha-selector-bce_tags; HA drives it via
// value/selector/context + value-changed.
import { LitElement, html, css } from 'lit';
import { fireEvent } from '../bc.js';

export class TagsSelector extends LitElement {
  static properties = {
    selector: { attribute: false },
    context: { attribute: false },
    label: { attribute: false },
    value: { attribute: false },
    _query: { state: true },
    _focused: { state: true },
    _hiIdx: { state: true },
    _focusIdx: { state: true },
    _editIdx: { state: true },
    _editValue: { state: true },
  };

  constructor() {
    super();
    this._value = [];
    this._snapshot = null;
    this._query = '';
    this._focused = false;
    this._hiIdx = -1;
    this._hiVal = null;
    this._focusIdx = -1;   // -1 = input focused; 0..n-1 = that chip focused
    this._editIdx = -1;    // index of chip in inline-edit mode, or -1
    this._editValue = '';  // in-flight edit text
    this._appliedFocusIdx = -1;  // last DOM-applied focus (avoid re-focus fights)
  }

  set value(v) {
    const next = v == null || v === '' ? [] : Array.isArray(v) ? v.map(String) : [String(v)];
    if (next.length === this._value.length && next.every((x, i) => x === this._value[i])) return;
    this._value = next;
    this._snapshot = null;
    this.requestUpdate();
  }
  // Return a STABLE array reference between mutations: ha-form diffs `.value` by
  // identity, so a fresh `.slice()` on every read would look like a change and
  // force redundant re-renders. The snapshot is rebuilt only when `_value`
  // actually mutates (cleared via _touch at every mutation point).
  get value() {
    if (!this._snapshot) this._snapshot = this._value.slice();
    return this._snapshot;
  }
  _touch() { this._snapshot = null; }

  get _sel() { return this.selector?.bce_tags || {}; }
  _editable() { return this._sel.custom_value !== false; }

  _opts() {
    return (this._sel.options || []).map((o) =>
      typeof o === 'object' && o !== null
        ? { label: String(o.label), value: String(o.value) }
        : { label: String(o), value: String(o) });
  }
  _labelFor(v) { return this._opts().find((o) => o.value === v)?.label ?? v; }

  // While empty, what is in force: context.single (sibling value), else
  // implicit_default (display only). seed=false means show but never inject.
  _implicit() {
    if (this._value.length) return null;
    const single = this.context?.single != null ? String(this.context.single) : '';
    const def = this._sel.implicit_default != null ? String(this._sel.implicit_default) : null;
    if (single) return { value: single, seed: single !== def };
    if (def != null) return { value: def, seed: false };
    return null;
  }

  _menuMatches() {
    const q = (this._query || '').toLowerCase();
    return this._opts().filter((o) =>
      !this._value.includes(o.value) &&
      (!q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)));
  }

  _emit() {
    fireEvent(this, 'value-changed', { value: this._value.length ? this._value.slice() : undefined });
  }

  _add(v) {
    if (!v) return;
    const imp = this._implicit();
    if (imp?.seed && imp.value !== v) this._value.push(imp.value);
    if (this._value.includes(v)) return;
    this._value.push(v);
    this._touch();
    this._query = '';
    const input = this.renderRoot?.querySelector('input.tag-input');
    if (input) input.value = '';
    this.requestUpdate();
    this._emit();
  }

  _removeAt(i) {
    this._value.splice(i, 1);
    this._touch();
    this.requestUpdate();
    this._emit();
  }

  _clearAll() {
    if (!this._value.length) return;
    this._value = [];
    this._touch();
    this._focusIdx = -1;
    this._editIdx = -1;
    this.requestUpdate();
    this._emit();
  }

  _onInput(e) { this._query = e.target.value; this._focused = true; }
  _onFocus() { this._focused = true; this._focusIdx = -1; }
  _onBlur() { this._focused = false; }

  _onKeydown(ev) {
    const matches = this._menuMatches();
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!matches.length) return;
      const dir = ev.key === 'ArrowDown' ? 1 : -1;
      this._hiIdx = this._hiIdx === -1 && dir === -1
        ? matches.length - 1
        : (this._hiIdx + dir + matches.length) % matches.length;
      this._hiVal = matches[this._hiIdx]?.value ?? null;
    } else if (ev.key === 'Enter') {
      // Keep Enter from reaching the dialog (it would save/close it).
      ev.preventDefault();
      ev.stopPropagation();
      const typed = ev.target.value.trim();
      const pick = this._hiIdx >= 0 ? matches[this._hiIdx] : matches[0];
      if (pick) this._add(pick.value);
      else if (typed && this._sel.custom_value !== false) this._add(typed);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this._focused = false;
    } else if (ev.key === 'ArrowLeft' && !ev.target.value && this._value.length) {
      // Caret at start / empty field: step left into the chip row.
      ev.preventDefault();
      this._focusIdx = this._value.length - 1;
    } else if (ev.key === 'Backspace' && !ev.target.value && this._value.length) {
      this._removeAt(this._value.length - 1);
    }
  }

  // Keydown on a focused chip (roving tabindex). The chip row is one Tab stop;
  // arrows move focus among chips, → past the last returns to the input.
  _onChipKeydown(i, ev) {
    const mod = ev.ctrlKey || ev.metaKey;  // Ctrl/Cmd+arrow reorders the chip itself
    if (ev.key === 'ArrowLeft' && mod) {
      ev.preventDefault();
      if (i > 0) { this._moveChip(i, i - 1); this._focusIdx = i - 1; }
    } else if (ev.key === 'ArrowRight' && mod) {
      ev.preventDefault();
      if (i < this._value.length - 1) { this._moveChip(i, i + 1); this._focusIdx = i + 1; }
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      this._focusIdx = Math.max(0, i - 1);
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      this._focusIdx = i < this._value.length - 1 ? i + 1 : -1;
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      this._removeAt(i);
      this._focusIdx = this._value.length ? Math.min(i, this._value.length - 1) : -1;
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      if (this._editable()) this._beginEdit(i);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this._focusIdx = -1;
    }
  }

  _itemMoved(ev) {
    ev.stopPropagation();
    this._moveChip(ev.detail.oldIndex, ev.detail.newIndex);
  }

  _moveChip(from, to) {
    if (from === to || from < 0 || to < 0 || to >= this._value.length) return;
    const [moved] = this._value.splice(from, 1);
    this._value.splice(to, 0, moved);
    this._touch();
    this.requestUpdate();
    this._emit();
  }

  _beginEdit(i) {
    if (!this._editable()) return;
    this._editIdx = i;
    this._editValue = this._value[i];
    this.requestUpdate();
    // focus + select the edit input in updated()
  }

  _commitEdit() {
    const i = this._editIdx;
    if (i < 0) return;
    const next = (this._editValue ?? '').trim();
    this._editIdx = -1;
    if (next === '') {                                       // empty → remove
      this._removeAt(i);
      this._focusIdx = this._value.length ? Math.min(i, this._value.length - 1) : -1;
      this._refocus();
      return;
    }
    if (!(this._value.includes(next) && this._value[i] !== next) && this._value[i] !== next) {
      this._value[i] = next;                                 // edit in place, keep position
      this._touch();
      this._emit();
    }
    // collision falls through to revert (no value change)
    this._focusIdx = i;
    this._refocus();
    this.requestUpdate();
  }

  _cancelEdit() {
    const i = this._editIdx;
    this._editIdx = -1;
    if (i >= 0) this._focusIdx = i;
    this._refocus();
    this.requestUpdate();
  }

  // Force updated() to re-apply DOM focus to the focused chip / input even when
  // _focusIdx is unchanged (e.g. leaving edit mode back to the same chip — the
  // edit <input> just stole focus, so we must put it back).
  _refocus() { this._appliedFocusIdx = -2; }

  static styles = css`
    :host { display: block; }
    .wrap {
      border: 1px solid var(--outline-color, var(--divider-color, #727272));
      border-radius: var(--mdc-shape-small, 4px);
      padding: 8px 12px;
      background: var(--mdc-text-field-fill-color, transparent);
      position: relative;
    }
    .wrap:focus-within { border-color: var(--primary-color); }
    label { display: block; font-size: 0.75rem; color: var(--secondary-text-color); margin-bottom: 4px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-right: 22px; }
    .chips-sortable { display: contents; }
    .clear {
      all: unset; position: absolute; right: 10px; bottom: 12px; cursor: pointer;
      line-height: 1; padding: 2px 4px; color: var(--secondary-text-color);
    }
    .clear:hover { color: var(--error-color, #db4437); }
    .chip {
      display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px 3px 10px;
      border-radius: 14px; background: rgba(var(--rgb-primary-color, 33, 150, 243), 0.15);
      color: var(--primary-text-color); font-size: 0.8125rem; cursor: grab;
      user-select: none; white-space: nowrap;
    }
    .chip:focus, .chip:focus-visible {
      outline: 2px solid var(--primary-color); outline-offset: 1px;
    }
    .chip.editable { cursor: text; }
    .chip button { all: unset; cursor: pointer; line-height: 1; padding: 0 4px; color: var(--secondary-text-color); }
    .chip button:hover { color: var(--error-color, #db4437); }
    .chip-edit {
      border: none; outline: none; background: transparent; color: var(--primary-text-color);
      font: inherit; min-width: 6ch; width: 9ch; padding: 0; margin: 0;
    }
    input.tag-input {
      border: none; outline: none; background: transparent; color: var(--primary-text-color);
      font-size: 0.875rem; flex: 1; min-width: 90px; padding: 4px 0;
    }
    input.tag-input::placeholder { color: var(--secondary-text-color); opacity: 0.7; }
    .menu {
      position: absolute; left: 0; right: 0; top: 100%; z-index: 10; margin-top: 2px;
      border-radius: var(--mdc-shape-small, 4px); background: var(--card-background-color, #fff);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3); max-height: 220px; overflow-y: auto;
    }
    .menu:empty { display: none; }
    .menu div { padding: 8px 12px; cursor: pointer; font-size: 0.875rem; }
    .menu div:hover, .menu div.active { background: rgba(var(--rgb-primary-color, 33, 150, 243), 0.12); }
  `;

  // Reconcile the keyboard highlight before render: track the highlighted row
  // by value (_hiVal) so it survives a menu rebuild (options/query change), and
  // drop it when that value leaves the filtered set. Also clamp roving focus /
  // edit indices when an external value change shrinks the list. Deriving here
  // (not in render) keeps render side-effect-free.
  willUpdate() {
    const matches = this._focused ? this._menuMatches() : [];
    if (this._hiVal != null) {
      const idx = matches.findIndex((o) => o.value === this._hiVal);
      this._hiIdx = idx;
      if (idx < 0) this._hiVal = null;
    }
    if (this._focusIdx >= this._value.length) this._focusIdx = -1;
    if (this._editIdx >= this._value.length) this._editIdx = -1;
  }

  // Keep the arrow-key-highlighted menu row visible, and apply roving DOM focus
  // (only when the focus index changed, so we don't fight the user's caret) and
  // autofocus+select the inline-edit input when one opens.
  updated() {
    const active = this.renderRoot?.querySelector('.menu .active');
    if (active) active.scrollIntoView({ block: 'nearest' });

    if (this._editIdx >= 0) {
      const ed = this.renderRoot?.querySelector('.chip-edit');
      if (ed && this.renderRoot.activeElement !== ed) { ed.focus(); ed.select(); }
      return;  // edit input owns focus; don't also run roving focus
    }

    if (this._focusIdx !== this._appliedFocusIdx) {
      this._appliedFocusIdx = this._focusIdx;
      const target = this._focusIdx === -1
        ? this.renderRoot?.querySelector('input.tag-input')
        : this.renderRoot?.querySelectorAll('.chip')[this._focusIdx];
      if (target) target.focus();
    }
  }

  _renderChip(v, i) {
    if (i === this._editIdx) {
      return html`
        <span class="chip editing">
          <input
            class="chip-edit"
            .value=${this._editValue}
            spellcheck="false"
            autocomplete="off"
            @input=${(e) => { this._editValue = e.target.value; }}
            @keydown=${(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this._commitEdit(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this._cancelEdit(); }
            }}
            @blur=${this._commitEdit}
          >
        </span>
      `;
    }
    const editable = this._editable();
    return html`
      <span
        class=${editable ? 'chip editable' : 'chip'}
        tabindex=${i === this._focusIdx ? 0 : -1}
        @keydown=${(e) => this._onChipKeydown(i, e)}
        @click=${editable ? () => this._beginEdit(i) : null}
      >${this._labelFor(v)}<button
          type="button"
          title="Remove"
          @click=${(e) => { e.stopPropagation(); this._removeAt(i); }}
        >✕</button></span>
    `;
  }

  render() {
    const imp = this._implicit();
    const placeholder = imp ? `${this._labelFor(imp.value)} (${imp.seed ? 'current' : 'default'})` : '';
    const matches = this._focused ? this._menuMatches() : [];
    return html`
      ${this.label ? html`<label>${this.label}</label>` : ''}
      <div class="wrap">
        ${this._value.length
          ? html`<button class="clear" type="button" title="Clear all" @click=${this._clearAll}>✕</button>`
          : ''}
        <div class="chips">
          <ha-sortable
            draggable-selector=".chip"
            .disabled=${this._editIdx >= 0}
            @item-moved=${this._itemMoved}
          >
            <div class="chips-sortable">
              ${this._value.map((v, i) => this._renderChip(v, i))}
            </div>
          </ha-sortable>
          <input
            class="tag-input"
            tabindex=${this._focusIdx === -1 ? 0 : -1}
            spellcheck="false"
            autocomplete="off"
            placeholder=${placeholder}
            @input=${this._onInput}
            @focus=${this._onFocus}
            @blur=${this._onBlur}
            @keydown=${this._onKeydown}
          >
        </div>
        <div class="menu">
          ${matches.map((o, i) => html`
            <div
              class=${i === this._hiIdx ? 'active' : ''}
              @mousedown=${(e) => { e.preventDefault(); this._add(o.value); }}
            >${o.label === o.value ? o.label : `${o.label} (${o.value})`}</div>
          `)}
        </div>
      </div>
    `;
  }
}
