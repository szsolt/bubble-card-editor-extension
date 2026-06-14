// Decides whether a module's editor_code should run on a given pass.
//
// editor_code runs at most ONCE per module id: it registers a custom element
// (defining the same tag twice throws) and a schema decorator (re-registering is
// harmless but re-running is wasted work). A per-id Set records every id we've
// run so the same id is skipped on any later pass.
//
// (There is no longer a clobber to recover from: bce decorates the schema on the
// read side — see engine.js installSchemaIntercept — instead of dispatching a
// decorated object into stock's registry. So we never need to re-run editor_code
// on a rebuilt raw object the way the old dispatch mechanism did.)
//
// Pure and DOM-free so the logic is unit-testable.
export class RunGuard {
  constructor() {
    this.ranIds = new Set();
  }

  // Returns true if editor_code should run for (id, mod) now. Has the side effect
  // of marking the id as handled. A module without editor_code never runs and
  // leaves the id eligible for a real editor_code later.
  shouldRun(id, mod) {
    if (!mod || typeof mod !== 'object' || !mod.editor_code) return false;
    if (this.ranIds.has(id)) return false;
    this.ranIds.add(id);
    return true;
  }
}
