/**
 * Vitest stand-in for the `react` module.
 *
 * The client half is bundled for the browser by `scripts/build-client.js` with
 * `react` marked external, and DSH's client module loader supplies the real
 * module at runtime. Under Vitest there is no loader, so bare `react` resolves
 * here and forwards every property read to the per-test `globalThis.React` stub
 * the client-bridge tests install. The lookup is lazy on purpose: the tests set
 * `globalThis.React` in a `beforeEach`/inside the case, i.e. after import.
 */
export default new Proxy(
  {},
  {
    get(_target, prop) {
      const react = (globalThis as any).React;
      return react === undefined ? undefined : react[prop];
    },
    has(_target, prop) {
      const react = (globalThis as any).React;
      return react !== undefined && prop in react;
    },
  },
);
