/**
 * Minimal ambient surface for the host-provided `react` module.
 *
 * The client half is bundled by `scripts/build-client.js` with `react` marked
 * external, so nothing here is installed as a dependency: at runtime DSH's own
 * module loader supplies the real module through `require("react")`. This
 * declaration exists only so `tsc` can typecheck `src/client/index.ts` without
 * pulling `@types/react` into the host build.
 */
declare module 'react' {
  const React: any;
  export default React;
}
