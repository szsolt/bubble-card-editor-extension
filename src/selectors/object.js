import { LitElement, html, css, nothing } from 'lit';
import { fireEvent } from '../bc.js';
import { debug } from '../log.js';

// ── bce_object list selector ──
// The list editor for object/list fields (e.g. icons: / badges:): one
// expandable row per entry, collapsible field groups, mode dropdowns for
// variant families, visual clusters, native field warnings, per-field context,
// card-entity fallback, and drag-reorder / duplicate. The consuming module
// decorates each entry's field schema (group / visible_if / variant_of /
// cluster_of / context / description_field) and points the entry at this
// selector. Reads selector.bce_object.
//
// A lit element — bce bundles lit, so it imports lit directly rather than
// taking the injected `bc`.
//
// Returns the registered element tag ('ha-selector-bce_object') so the caller
// can register it in the framework's selectors registry without re-deriving it.
// Compiled `visible_if` / `warn_if` expression cache, shared across all
// ObjectSelector instances. The compiled function is a pure transform of the
// expression string (it closes over no instance state — item/hass/card come in
// as args), so one cache keyed by string serves every instance and every render
// without growing per-instance. The set of distinct expressions in a module's
// schema is finite, so this is bounded.
const _exprCache = new Map();
function compileExpr(expr) {
  let fn = _exprCache.get(expr);
  if (!fn) {
    fn = new Function('item', 'hass', 'card', `return !!(${expr});`);
    _exprCache.set(expr, fn);
  }
  return fn;
}

export function registerObjectSelector() {
  if (customElements.get('ha-selector-bce_object')) return 'ha-selector-bce_object';

  // Collapsible section for fields sharing a `group` — a drop-in for ha-form's
  // built-in `expandable`, but the schema item carries the per-field
  // `warnings` map and the element re-applies it to its nested ha-form so
  // grouped fields keep the native amber alert instead of a ⚠️ helper line.
  class FormGroup extends LitElement {
    static properties = {
      hass: { attribute: false },
      data: { attribute: false },
      schema: { attribute: false },
      disabled: { type: Boolean },
      computeLabel: { attribute: false },
      computeHelper: { attribute: false },
      localizeValue: { attribute: false },
    };

    render() {
      return html`
        <ha-expansion-panel outlined .expanded=${Boolean(this.schema?.expanded)}>
          ${this.schema?.icon
            ? html`<ha-icon slot="leading-icon" .icon=${this.schema.icon}></ha-icon>`
            : nothing}
          <div slot="header" role="heading" aria-level="3">${this.schema?.title}</div>
          <div class="content">
            <ha-form
              .hass=${this.hass}
              .data=${this.data}
              .schema=${this.schema?.schema || []}
              .warning=${this.schema?.warnings || {}}
              .computeWarning=${(warning) => warning}
              .disabled=${this.disabled}
              .computeLabel=${this.computeLabel}
              .computeHelper=${this.computeHelper}
              .localizeValue=${this.localizeValue}
            ></ha-form>
          </div>
        </ha-expansion-panel>
      `;
    }

    static styles = css`
      :host {
        display: flex !important;
        flex-direction: column;
      }
      :host ha-form {
        display: block;
      }
      .content {
        padding: 12px;
      }
      ha-expansion-panel {
        display: block;
        --expansion-panel-content-padding: 0;
        border-radius: 6px;
        --ha-card-border-radius: 6px;
      }
      ha-icon[slot="leading-icon"] {
        color: var(--secondary-text-color);
      }
    `;
  }
  if (!customElements.get('ha-form-bce_group')) {
    customElements.define('ha-form-bce_group', FormGroup);
  }

  // Visual-only container for a variant family (mode dropdown + active value
  // field) or a cluster_of group: always open, no chevron — a thin left rail
  // marks the rows as one unit. `flatten: true` keeps the stored keys
  // top-level. Carries the per-field warnings map for the same reason as
  // FormGroup.
  class FormCluster extends LitElement {
    static properties = {
      hass: { attribute: false },
      data: { attribute: false },
      schema: { attribute: false },
      disabled: { type: Boolean },
      computeLabel: { attribute: false },
      computeHelper: { attribute: false },
      localizeValue: { attribute: false },
    };

    render() {
      return html`
        <ha-form
          .hass=${this.hass}
          .data=${this.data}
          .schema=${this.schema?.schema || []}
          .warning=${this.schema?.warnings || {}}
          .computeWarning=${(warning) => warning}
          .disabled=${this.disabled}
          .computeLabel=${this.computeLabel}
          .computeHelper=${this.computeHelper}
          .localizeValue=${this.localizeValue}
        ></ha-form>
      `;
    }

    static styles = css`
      :host {
        display: block;
        border-left: 2px solid var(--divider-color, rgba(127, 127, 127, 0.4));
        padding-left: 12px;
      }
    `;
  }
  if (!customElements.get('ha-form-bce_cluster')) {
    customElements.define('ha-form-bce_cluster', FormCluster);
  }

  // Object selector with dynamic per-item context for entity-attribute linking
  // (HA's stock object selector drops context into the item form), plus the
  // group / visible_if / variant / cluster / warn / reorder features.
  class ObjectSelector extends LitElement {
    static properties = {
      hass: { attribute: false },
      selector: { attribute: false },
      value: { attribute: false },
      label: {},
      helper: {},
      disabled: { type: Boolean },
      required: { type: Boolean },
      localizeValue: { attribute: false },
    };

    constructor() {
      super();
      this.disabled = false;
      this.required = false;
    }

    // The card's own config, found by walking up the shadow-root host chain to
    // the editor element. Entity-linked fields (attribute pickers, visible_if /
    // warn_if expressions) fall back to the card's entity when an item doesn't
    // set its own — mirroring how cards resolve entities at render time.
    //
    // Memoized per update cycle: the walk is invoked once per item AND inside
    // every visible_if/warn_if eval, so for an N-item list re-rendering on each
    // keystroke it would run N×(items+expressions)×20 host hops. willUpdate()
    // clears the memo so a host-chain change between cycles is still picked up.
    get _cardConfig() {
      // `undefined` is a real result (no config-bearing host found), so memo
      // presence is tracked with a separate flag, not by the value.
      if (this.__cardConfigMemoSet) return this.__cardConfigMemo;
      this.__cardConfigMemo = this._walkCardConfig();
      this.__cardConfigMemoSet = true;
      return this.__cardConfigMemo;
    }

    // Drop the per-cycle _cardConfig memo before each render so a host-chain or
    // card-entity change between cycles is re-walked once.
    willUpdate() {
      this.__cardConfigMemoSet = false;
    }

    _walkCardConfig() {
      const MAX_DEPTH = 20;
      let node = this;
      for (let i = 0; node && i < MAX_DEPTH; i++) {
        const host = node.getRootNode?.()?.host;
        if (!host) return undefined;
        if (host._config && typeof host._config === "object") return host._config;
        node = host;
      }
      // Hit the cap without finding a config-bearing host. Entity-linked fields
      // fall back to undefined (no card entity) rather than walking forever; if
      // HA ever nests the editor deeper than this, raise MAX_DEPTH.
      debug(`bce_object: _cardConfig host-walk hit depth cap (${MAX_DEPTH}); no card config found`);
      return undefined;
    }

    // `visible_if` is a JS expression over the item's data (`item`), the live
    // `hass`, and the card config (`card`). The schema regenerates on every
    // change, so fields show/hide live. Fails open: a broken expression keeps
    // the field visible rather than unreachable.
    _fieldVisible(field, itemData) {
      if (!field.visible_if) return true;
      try {
        return compileExpr(field.visible_if)(itemData || {}, this.hass, this._cardConfig);
      } catch (e) {
        return true;
      }
    }

    // `warn_if` is a JS expression; when true, `warn_text` shows as the field's
    // native amber warning. Fails silent: a broken expression never warns.
    _fieldWarning(field, itemData) {
      if (!field.warn_if) return "";
      try {
        return compileExpr(field.warn_if)(itemData || {}, this.hass, this._cardConfig) ? (field.warn_text || "Check this value") : "";
      } catch (e) {
        return "";
      }
    }

    // Group fields by a `<relKey>: <base>` reference to another field:
    // base key -> [{key, field}, ...] in declaration order. References to
    // unknown bases are ignored, so a typo degrades to a standalone field.
    _familiesBy(fields, relKey) {
      const fieldEntries = Array.isArray(fields)
        ? fields.map((f, i) => [f.name || i, f])
        : Object.entries(fields || {});
      const fams = {};
      for (const [key, field] of fieldEntries) {
        if (field[relKey] && fields[field[relKey]]) {
          (fams[field[relKey]] = fams[field[relKey]] || []).push({ key, field });
        }
      }
      return fams;
    }

    // `variant_of: <base>` fields are alternative representations of the base
    // (static value vs. state->value map vs. JS expression). The form shows one
    // mode dropdown per family plus only the active variant's input. The
    // dropdown is a synthetic `__<base>_mode` key in per-item UI state, stripped
    // from the emitted value, so the stored config never changes shape.
    _variantFamilies(fields) {
      return this._familiesBy(fields, "variant_of");
    }

    // `cluster_of: <base>` fields render inside the base field's visual cluster
    // (the thin-left-rail box) instead of as standalone rows — purely visual.
    // Unlike variants, every member is a real stored field with its own
    // visible_if; a hidden base hides the cluster.
    _clusterFamilies(fields) {
      return this._familiesBy(fields, "cluster_of");
    }

    _variantHasData(itemData, key) {
      const v = itemData?.[key];
      return v !== undefined && v !== null && v !== "" &&
        !(typeof v === "object" && Object.keys(v).length === 0);
    }

    // The base field's own mode label; the base field may rename it via `variant`.
    _variantBaseLabel(field) {
      return field?.variant || "Static";
    }

    // Default mode per family: the first declared variant with data, else base.
    _variantDefaults(fields, itemData) {
      const out = {};
      for (const [base, variants] of Object.entries(this._variantFamilies(fields))) {
        const withData = variants.find((v) => this._variantHasData(itemData, v.key));
        out[`__${base}_mode`] =
          withData ? (withData.field.variant || withData.key) : this._variantBaseLabel(fields[base]);
      }
      return out;
    }

    // Generate schema from selector fields, including context for
    // entity-attribute linking. Per-field metadata (variant helpers, warnings)
    // is keyed by item index so forms of different items never read each
    // other's state.
    //
    // Synthetic schema item names share the flat namespace with real field
    // keys: the `__*` prefix (mode dropdowns, cluster wrappers, group sections,
    // card entity) is reserved — module field keys must not start with `__`.
    _generateSchema(fields, itemData, index = 0) {
      if (!fields) return [];

      const fieldEntries = Array.isArray(fields)
        ? fields.map((f, i) => [f.name || i, f])
        : Object.entries(fields);

      // Find entity field name for context
      let entityFieldName = null;
      for (const [key, field] of fieldEntries) {
        if (field.selector && field.selector.entity) {
          entityFieldName = key;
          break;
        }
      }

      const families = this._variantFamilies(fields);
      const clusters = this._clusterFamilies(fields);
      this._variantMeta = this._variantMeta || {};
      // Active warnings per field, fed to ha-form's native `warning` prop
      // (amber ha-alert above the field). ha-form doesn't forward the prop into
      // nested forms, so FormGroup and FormCluster carry the map and re-apply it.
      this._warnTop = this._warnTop || {};
      this._warnTop[index] = {};

      const makeItem = (key, field) => {
        // A declared default surfaces as the text input's placeholder.
        let selector = field.selector;
        if (field.default !== undefined && selector?.text &&
            selector.text.placeholder === undefined) {
          selector = { text: { ...selector.text, placeholder: String(field.default) } };
        }
        const schemaItem = {
          name: key,
          selector,
          required: field.required ?? false,
        };
        // Context for attribute selectors links to the entity field; when the
        // item has no entity of its own, link to the synthetic __card_entity
        // key (the card's entity) instead. The selector is rebuilt per item
        // with the item's OWN entity: a baked entity_id (from the editor's
        // inherited-entities pass) overrides the per-item context inside
        // ha-selector-attribute.
        if (field.selector && field.selector.attribute && entityFieldName) {
          const own = itemData?.[entityFieldName];
          schemaItem.selector = {
            attribute: { ...field.selector.attribute, entity_id: own || undefined },
          };
          const useCard = !own && itemData?.__card_entity;
          schemaItem.context = { filter_entity: useCard ? "__card_entity" : entityFieldName };
        }
        // A field may declare its own context mapping (contextKey -> sibling
        // field name); ha-form resolves it against the item's data, so custom
        // selectors (e.g. bce_js) can read sibling values. __card_entity works here too.
        if (field.context && !schemaItem.context) {
          schemaItem.context = { ...field.context };
        }
        const warn = this._fieldWarning(field, itemData);
        if (warn) this._warnTop[index][key] = warn;
        return schemaItem;
      };

      // Fields sharing a `group` are wrapped in a collapsible section
      // (flattened, so the stored config keys stay top-level). Fields without a
      // group render flat.
      const schema = [];
      const groups = new Map();

      const place = (field, schemaItems) => {
        const group = field.group;
        if (!group) {
          schema.push(...schemaItems);
          return;
        }
        let section = groups.get(group);
        if (!section) {
          section = {
            name: `__group_${groups.size}`,
            type: "bce_group",
            flatten: true,
            title: group,
            expanded: false,
            schema: [],
            warnings: this._warnTop[index],
          };
          if (field.group_icon) section.icon = field.group_icon;
          groups.set(group, section);
          schema.push(section);
        } else if (!section.icon && field.group_icon) {
          section.icon = field.group_icon;
        }
        section.schema.push(...schemaItems);
      };

      for (const [key, field] of fieldEntries) {
        // Variant and cluster-member fields render through their base, never alone.
        if (field.variant_of && fields[field.variant_of]) continue;
        if (field.cluster_of && fields[field.cluster_of]) continue;
        if (!this._fieldVisible(field, itemData)) continue;

        // Visible cluster members, in declaration order, appended after the
        // base (or after the variant rows when the base also has variants).
        const memberItems = (clusters[key] || [])
          .filter((m) => this._fieldVisible(m.field, itemData))
          .map((m) => makeItem(m.key, m.field));

        const variants = families[key];
        if (!variants) {
          if (!memberItems.length) {
            // No visible members — render flat, no rail around a lone field.
            place(field, [makeItem(key, field)]);
            continue;
          }
          place(field, [{
            type: "bce_cluster",
            name: `__cluster_${key}`,
            flatten: true,
            schema: [makeItem(key, field), ...memberItems],
            warnings: this._warnTop[index],
          }]);
          continue;
        }

        const modeKey = `__${key}_mode`;
        const baseLabel = this._variantBaseLabel(field);
        const options = [baseLabel, ...variants.map((v) => v.field.variant || v.key)];
        const mode = options.includes(itemData?.[modeKey]) ? itemData[modeKey] : baseLabel;
        const activeVariant = variants.find((v) => (v.field.variant || v.key) === mode);

        // Warn when an inactive variant still has data — the module's priority
        // rules decide which wins, which is invisible otherwise.
        const othersWithData = variants
          .filter((v) => v !== activeVariant && this._variantHasData(itemData, v.key))
          .map((v) => v.field.variant || v.key);
        if (mode !== baseLabel && this._variantHasData(itemData, key)) {
          othersWithData.unshift(baseLabel);
        }
        this._variantMeta[`${index}:${modeKey}`] = {
          label: field.label || key,
          helper: othersWithData.length
            ? `Other modes also set: ${othersWithData.join(", ")} — the module's priority decides which wins.`
            : "",
        };

        const modeItem = {
          name: modeKey,
          selector: {
            select: { options, multiple: false, custom_value: false, mode: "dropdown" },
          },
          // Required: a mode is always in force, and it keeps ha-select from
          // rendering a clear (✕) that would only blank the dropdown's display.
          required: true,
        };
        const activeItem = activeVariant
          ? makeItem(activeVariant.key, activeVariant.field)
          : makeItem(key, field);
        // The family renders inside a light visual cluster (thin left rail) so
        // the mode dropdown and its value field read as one unit.
        place(field, [{
          type: "bce_cluster",
          name: `__cluster_${key}`,
          flatten: true,
          schema: [modeItem, activeItem, ...memberItems],
          warnings: this._warnTop[index],
        }]);
      }

      return schema;
    }

    _computeLabel(schema, index = 0) {
      if (this._variantMeta?.[`${index}:${schema.name}`]) return this._variantMeta[`${index}:${schema.name}`].label;

      const field = this.selector?.bce_object?.fields?.[schema.name];
      if (field?.label) return field.label;

      const translationKey = this.selector?.bce_object?.translation_key;
      if (this.localizeValue && translationKey) {
        const label = this.localizeValue(`${translationKey}.fields.${schema.name}.name`) ||
                      this.localizeValue(`${translationKey}.fields.${schema.name}`);
        if (label) return label;
      }
      return schema.name;
    }

    _computeHelper(schema, index = 0) {
      if (this._variantMeta?.[`${index}:${schema.name}`]) return this._variantMeta[`${index}:${schema.name}`].helper;

      const field = this.selector?.bce_object?.fields?.[schema.name];
      if (field?.description) return field.description;

      const translationKey = this.selector?.bce_object?.translation_key;
      if (this.localizeValue && translationKey) {
        const helper = this.localizeValue(`${translationKey}.fields.${schema.name}.description`);
        if (helper) return helper;
      }
      return "";
    }

    _formatValue(item, selector) {
      if (!item || !this.hass) return "";

      const labelField = this.selector?.bce_object?.label_field ||
                         Object.keys(this.selector?.bce_object?.fields || {})[0];

      if (!labelField) return "";

      // 0 is a real label (e.g. a threshold row's `from: 0`) — only blank-ish
      // values fall through to the "Item N" placeholder.
      const value = item[labelField];
      if (value === undefined || value === null || value === "") return "";

      // Format entity names nicely.
      if (this.selector?.bce_object?.fields?.[labelField]?.selector?.entity) {
        const state = this.hass.states[value];
        if (state) {
          return state.attributes.friendly_name || value;
        }
      }

      return String(value);
    }

    // description_field may be a single key or a list (first with a value
    // wins); list values join with ", ".
    _getDescription(item) {
      const descField = this.selector?.bce_object?.description_field;
      if (!descField || !item) return "";
      for (const key of Array.isArray(descField) ? descField : [descField]) {
        const v = item[key];
        if (Array.isArray(v) ? v.length : (v || v === 0)) return Array.isArray(v) ? v.join(", ") : v;
      }
      return "";
    }

    render() {
      const isMultiple = this.selector?.bce_object?.multiple || false;
      const fields = this.selector?.bce_object?.fields;

      if (!fields) {
        return html`<div>No fields defined</div>`;
      }

      if (isMultiple) {
        return this._renderMultiple();
      }
      return this._renderSingle();
    }

    _renderMultiple() {
      const items = Array.isArray(this.value) ? this.value : [];

      return html`
        ${this.label ? html`<label class="bce-object-label">${this.label}</label>` : nothing}
        <ha-sortable
          handle-selector=".reorder-handle"
          draggable-selector=".bce-object-item"
          .disabled=${this.disabled}
          @item-moved=${this._itemMoved}
        >
          <div class="bce-object-items">
            ${items.map((item, index) => this._renderItem(item, index))}
            <ha-button
              class="bce-object-add-button"
              @click=${this._addItem}
              ?disabled=${this.disabled}
            >
              <ha-icon icon="mdi:plus"></ha-icon>
              ${this.hass?.localize?.("ui.common.add") || "Add"}
            </ha-button>
          </div>
        </ha-sortable>
        ${this.helper ? html`<ha-input-helper-text>${this.helper}</ha-input-helper-text>` : nothing}
      `;
    }

    _renderSingle() {
      if (this.value) {
        return html`
          ${this.label ? html`<label class="bce-object-label">${this.label}</label>` : nothing}
          <div class="bce-object-items">
            ${this._renderItem(this.value, 0)}
          </div>
          ${this.helper ? html`<ha-input-helper-text>${this.helper}</ha-input-helper-text>` : nothing}
        `;
      }

      return html`
        ${this.label ? html`<label class="bce-object-label">${this.label}</label>` : nothing}
        <ha-button
          class="bce-object-add-button"
          @click=${this._addItem}
          ?disabled=${this.disabled}
        >
          <ha-icon icon="mdi:plus"></ha-icon>
          ${this.hass?.localize?.("ui.common.add") || "Add"}
        </ha-button>
        ${this.helper ? html`<ha-input-helper-text>${this.helper}</ha-input-helper-text>` : nothing}
      `;
    }

    // Unset single-select fields with a declared default render the default as
    // the selected value (display only — _itemChanged strips it back out), so a
    // cleared dropdown shows the value in force instead of an empty box. Text
    // inputs get this via placeholder; dropdowns have none, hence the injection.
    _selectDefaults(fields, item) {
      const out = {};
      const entries = Array.isArray(fields)
        ? fields.map((f, i) => [f.name || i, f])
        : Object.entries(fields || {});
      for (const [key, field] of entries) {
        if (field?.default !== undefined && field?.selector?.select &&
            !field.selector.select.multiple &&
            (item?.[key] === undefined || item?.[key] === null || item?.[key] === "")) {
          out[key] = field.default;
        }
      }
      return out;
    }

    // Item data extended with synthetic `__*` UI-only keys (variant mode
    // dropdowns): defaults derived from which keys hold data, overridden by this
    // item's transient UI state. Never part of the emitted value.
    _itemFormData(item, index) {
      const fields = this.selector?.bce_object?.fields;
      // Cleared synthetic keys (mode dropdown ✕) leave empty entries in UI
      // state; drop them so the derived defaults stay visible.
      const ui = {};
      for (const [k, v] of Object.entries(this._uiState?.[index] || {})) {
        if (v !== undefined && v !== null && v !== "") ui[k] = v;
      }
      return {
        ...item,
        ...this._selectDefaults(fields, item),
        ...this._variantDefaults(fields, item),
        ...ui,
        // Always fresh — the card's entity, for attribute pickers on items that
        // inherit it (synthetic key, stripped from the emitted value).
        __card_entity: this._cardConfig?.entity,
      };
    }

    _renderItem(item, index) {
      const label = this._formatValue(item, this.selector) || `Item ${index + 1}`;
      const description = this._getDescription(item);
      const isMultiple = this.selector?.bce_object?.multiple || false;
      const formData = this._itemFormData(item, index);

      return html`
        <ha-expansion-panel outlined class="bce-object-item">
          <h4 slot="header" class="bce-object-item-header">
            ${isMultiple ? html`
              <ha-icon-button
                class="reorder-handle"
                @click=${(e) => e.stopPropagation()}
                .label="${this.hass?.localize?.("ui.common.move") || "Move"}"
              >
                <ha-icon icon="mdi:drag"></ha-icon>
              </ha-icon-button>
            ` : nothing}
            <div class="bce-object-item-title-container">
              <span class="bce-object-item-label">${label}</span>
              ${description ? html`<span class="bce-object-item-description">${description}</span>` : nothing}
            </div>
            <div class="button-container" @click=${(e) => e.stopPropagation()} @mousedown=${(e) => e.stopPropagation()} @touchstart=${(e) => e.stopPropagation()}>
              ${isMultiple ? html`
                <ha-icon-button
                  class="duplicate-icon"
                  @click=${() => this._duplicateItem(index)}
                  ?disabled=${this.disabled}
                  .label="${this.hass?.localize?.("ui.common.duplicate") || "Duplicate"}"
                >
                  <ha-icon icon="mdi:content-copy"></ha-icon>
                </ha-icon-button>
              ` : nothing}
              <ha-icon-button
                class="delete-icon"
                @click=${() => this._deleteItem(index)}
                ?disabled=${this.disabled}
                .label="${this.hass?.localize?.("ui.common.delete") || "Delete"}"
              >
                <ha-icon icon="${isMultiple ? 'mdi:delete' : 'mdi:close'}"></ha-icon>
              </ha-icon-button>
            </div>
          </h4>
          <div class="bce-object-item-content">
            <ha-form
              .hass=${this.hass}
              .data=${formData}
              .schema=${this._generateSchema(this.selector?.bce_object?.fields, formData, index)}
              .warning=${this._warnTop?.[index] || {}}
              .computeWarning=${(warning) => warning}
              .disabled=${this.disabled}
              .computeLabel=${(schema) => this._computeLabel(schema, index)}
              .computeHelper=${(schema) => this._computeHelper(schema, index)}
              .localizeValue=${this.localizeValue}
              @value-changed=${(ev) => this._itemChanged(ev, index)}
            ></ha-form>
          </div>
        </ha-expansion-panel>
      `;
    }

    _addItem() {
      const isMultiple = this.selector?.bce_object?.multiple || false;

      if (isMultiple) {
        const newValue = [...(Array.isArray(this.value) ? this.value : []), {}];
        fireEvent(this, "value-changed", { value: newValue });
      } else {
        fireEvent(this, "value-changed", { value: {} });
      }
    }

    _duplicateItem(index) {
      const items = Array.isArray(this.value) ? this.value : [];
      const copy = JSON.parse(JSON.stringify(items[index] || {}));

      if (this._uiState) {
        const shifted = {};
        for (const [i, state] of Object.entries(this._uiState)) {
          const n = Number(i);
          shifted[n > index ? n + 1 : n] = state;
        }
        shifted[index + 1] = { ...(this._uiState[index] || {}) };
        this._uiState = shifted;
      }

      const newValue = [...items];
      newValue.splice(index + 1, 0, copy);
      fireEvent(this, "value-changed", { value: newValue });
    }

    // ha-sortable reports the DOM move; mirror it in the value array and remap
    // per-item UI state (variant mode dropdowns) so each item keeps its state.
    _itemMoved(ev) {
      ev.stopPropagation();
      const { oldIndex, newIndex } = ev.detail;
      if (oldIndex === newIndex) return;

      const newValue = [...(Array.isArray(this.value) ? this.value : [])];
      const [moved] = newValue.splice(oldIndex, 1);
      newValue.splice(newIndex, 0, moved);

      if (this._uiState) {
        const remap = (n) => {
          if (n === oldIndex) return newIndex;
          if (oldIndex < newIndex) return n > oldIndex && n <= newIndex ? n - 1 : n;
          return n >= newIndex && n < oldIndex ? n + 1 : n;
        };
        const shifted = {};
        for (const [i, state] of Object.entries(this._uiState)) {
          shifted[remap(Number(i))] = state;
        }
        this._uiState = shifted;
      }

      fireEvent(this, "value-changed", { value: newValue });
    }

    _deleteItem(index) {
      const isMultiple = this.selector?.bce_object?.multiple || false;

      if (this._uiState) {
        const shifted = {};
        for (const [i, state] of Object.entries(this._uiState)) {
          const n = Number(i);
          if (n < index) shifted[n] = state;
          else if (n > index) shifted[n - 1] = state;
        }
        this._uiState = shifted;
      }

      if (isMultiple) {
        const newValue = [...(this.value || [])];
        newValue.splice(index, 1);
        fireEvent(this, "value-changed", { value: newValue });
      } else {
        fireEvent(this, "value-changed", { value: undefined });
      }
    }

    _itemChanged(ev, index) {
      ev.stopPropagation();
      const isMultiple = this.selector?.bce_object?.multiple || false;

      // Split synthetic `__*` UI keys (variant mode dropdowns) out of the form
      // value: they stay in per-item element state, never in the stored config.
      const clean = {};
      const ui = {};
      for (const [k, v] of Object.entries(ev.detail.value || {})) {
        (k.startsWith("__") ? ui : clean)[k] = v;
      }
      // Drop display-only injected select defaults (_selectDefaults): a value
      // equal to the field default on a key the stored item never had stays
      // unstored — explicitly picking the default and leaving it unset are the
      // same config, and the clear (✕) keeps meaning "back to default".
      const stored = isMultiple ? (this.value || [])[index] : this.value;
      for (const [key, dflt] of Object.entries(
        this._selectDefaults(this.selector?.bce_object?.fields, stored)
      )) {
        if (clean[key] === dflt) delete clean[key];
      }
      this._uiState = { ...(this._uiState || {}) };
      this._uiState[index] = { ...(this._uiState[index] || {}), ...ui };
      this.requestUpdate();

      if (isMultiple) {
        const newValue = [...(this.value || [])];
        newValue[index] = clean;
        fireEvent(this, "value-changed", { value: newValue });
      } else {
        fireEvent(this, "value-changed", { value: clean });
      }
    }

    static styles = css`
      :host {
        display: block;
      }

      .bce-object-label {
        display: block;
        margin-bottom: 8px;
        font-weight: var(--ha-font-weight-medium, 500);
      }

      .bce-object-items {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .bce-object-item {
        --expansion-panel-summary-padding: 0 16px;
        width: 100% !important;
        max-width: 100% !important;
      }

      .bce-object-item-header {
        display: flex;
        align-items: center;
        margin: 0;
        width: 100%;
        justify-content: space-between;
      }

      .bce-object-item-title-container {
        display: flex;
        flex-direction: column;
        flex: 1;
        padding: 12px 0;
        overflow: hidden;
      }

      .bce-object-item-label {
        font-weight: var(--ha-font-weight-medium, 500);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bce-object-item-description {
        font-size: 0.9em;
        color: var(--secondary-text-color);
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bce-object-item-content {
        padding: 16px;
        width: 100% !important;
        box-sizing: border-box;
      }

      .button-container {
        display: flex;
        align-items: center;
        margin-left: 8px;
      }

      .delete-icon,
      .duplicate-icon {
        color: var(--secondary-text-color);
      }

      .reorder-handle {
        color: var(--secondary-text-color);
        cursor: grab;
        margin-right: 4px;
      }

      .reorder-handle ha-icon,
      .duplicate-icon ha-icon {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .delete-icon ha-icon {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .delete-icon[disabled] {
        color: var(--disabled-text-color);
        opacity: 0.5;
      }

      .bce-object-add-button {
        align-self: flex-start;
      }

      ha-input-helper-text {
        display: block;
        margin-top: 4px;
      }
    `;
  }

  customElements.define('ha-selector-bce_object', ObjectSelector);
  return 'ha-selector-bce_object';
}
