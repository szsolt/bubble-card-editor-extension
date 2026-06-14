// The `bc` API handed to a module's editor_code — identical shape to what
// Bubble Card's native hook would hand it: lit primitives + fireEvent, plus an
// apiVersion for feature detection. Built from OUR bundled lit (HA does not
// expose its own). Frozen so one module can't swap an entry out from under
// modules that load later.
import { LitElement, html, css, nothing } from 'lit';

export function fireEvent(node, type, detail = {}, options = {}) {
  const event = new CustomEvent(type, {
    bubbles: options.bubbles ?? true,
    cancelable: Boolean(options.cancelable),
    composed: options.composed ?? true,
    detail,
  });
  node.dispatchEvent(event);
  return event;
}

export const bc = Object.freeze({
  apiVersion: 1,
  LitElement,
  html,
  css,
  nothing,
  fireEvent,
});
