// Wraps a config-object selector definition into a LitElement, so authors can
// register a custom ha-selector-<name> control without writing LitElement
// boilerplate. ha-form drives every selector the same way:
//   - sets plain props: hass, value, label, selector, context
//   - listens for a `value-changed` CustomEvent {detail:{value}}
// so this base auto-wires `value` in and `value-changed` out, and hands the
// author a small `ctx` plus the bundled `html` tag.
//
// An author who needs lifecycle/internal state beyond this can pass a full
// LitElement subclass to defineSelector() instead of a config object.
import { LitElement, html, css } from 'lit';
import { fireEvent } from '../bc.js';

// config: { render(h, ctx) -> TemplateResult, parse?(raw)->value,
//           serialize?(value)->raw, styles?: CSSResult }
export function selectorClassFromConfig(config) {
  return class ConfigSelector extends LitElement {
    static properties = {
      hass: { attribute: false },
      value: { attribute: false },
      label: { attribute: false },
      selector: { attribute: false },
      context: { attribute: false },
    };

    static styles = config.styles ?? css``;

    render() {
      const ctx = {
        value: this.value,
        hass: this.hass,
        label: this.label,
        selector: this.selector,
        context: this.context,
        // emit a new value back to ha-form
        setValue: (v) => this._emit(v),
      };
      return config.render.call(this, html, ctx);
    }

    _emit(raw) {
      const value =
        typeof config.serialize === 'function' ? config.serialize(raw) : raw;
      fireEvent(this, 'value-changed', { value });
    }
  };
}

export { LitElement, html, css };
