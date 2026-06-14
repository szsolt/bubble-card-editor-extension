// `bce_js` — a JS/code field (multiline) with an optional live preview pane.
//
// The preview is driven by a pluggable `evaluate(value, context, hass)` the
// subclass supplies (see defineSelector({extends:'bce_js', evaluate})). The
// base owns the field + preview UI and the re-run triggers; the evaluator owns
// what the expression means (its scope, its helpers). evaluate returns
// { result } on success or { error: string } on failure. With no evaluator the
// control is a plain code field (no preview pane).
//
// Registered as ha-selector-bce_js. HA drives it: sets value/hass/context,
// listens for value-changed { detail: { value } }.
import { LitElement, html, css } from 'lit';
import { fireEvent } from '../bc.js';

export class JsSelector extends LitElement {
  static properties = {
    hass: { attribute: false },
    value: { attribute: false },
    label: { attribute: false },
    selector: { attribute: false },
    context: { attribute: false },
  };

  // Subclasses set this (a function) to enable the preview. undefined → no
  // preview pane. Signature: evaluate(value, context, hass) -> {result}|{error}.
  evaluate = undefined;

  static styles = css`
    :host { display: block; }
    .wrap {
      border: 1px solid var(--outline-color, var(--divider-color, #727272));
      border-radius: var(--mdc-shape-small, 4px);
      padding: 8px 12px 6px;
      background: var(--mdc-text-field-fill-color, transparent);
    }
    .wrap:focus-within { border-color: var(--primary-color); }
    label {
      display: block;
      font-size: 0.75rem;
      color: var(--secondary-text-color);
      margin-bottom: 2px;
    }
    textarea {
      display: block;
      width: 100%;
      box-sizing: border-box;
      border: none;
      outline: none;
      resize: vertical;
      background: transparent;
      color: var(--primary-text-color);
      font-family: var(--ha-font-family-code, monospace);
      font-size: 0.875rem;
      line-height: 1.4;
      min-height: 2.6em;
    }
    .preview {
      font-family: var(--ha-font-family-code, monospace);
      font-size: 0.75rem;
      margin-top: 4px;
      padding: 0 12px;
      color: var(--secondary-text-color);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .preview.err { color: var(--error-color, #db4437); }
    .preview:empty { display: none; }
  `;

  render() {
    const preview = this._previewText();
    return html`
      ${this.label ? html`<label>${this.label}</label>` : ''}
      <div class="wrap">
        <textarea
          rows="2"
          spellcheck="false"
          autocomplete="off"
          .value=${this.value ?? ''}
          @input=${this._onInput}
        ></textarea>
      </div>
      <div class="preview ${preview.err ? 'err' : ''}">${preview.text}</div>
    `;
  }

  _onInput(e) {
    const v = e.target.value;
    fireEvent(this, 'value-changed', { value: v === '' ? undefined : v });
  }

  // Returns { text, err } for the preview pane. Empty text → pane hidden.
  // The evaluator is contracted to return {result}|{error}, but it lives in a
  // subclass — guard against one that throws so a buggy evaluator degrades to a
  // preview error instead of breaking render().
  _previewText() {
    if (typeof this.evaluate !== 'function') return { text: '', err: false };
    const expr = (this.value || '').trim();
    if (!expr) return { text: '', err: false };
    let out;
    try {
      out = this.evaluate(expr, this.context || {}, this.hass);
    } catch (e) {
      return { text: `✗ ${e.message}`, err: true };
    }
    if (out && 'error' in out) return { text: `✗ ${out.error}`, err: true };
    if (out && 'result' in out) return { text: String(out.result), err: false };
    return { text: '', err: false };
  }
}
