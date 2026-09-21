export * from './picker/selector-generator.js';
export * from './picker/picker-script.js';
export * from './proxy/header-filter.js';
export * from './proxy/proxy-server.js';
export * from './cdp/cdp-client.js';
export * from './cdp/chrome-controller.js';
export * from './host/index.js';
// NOTE: './client/index.js' is deliberately NOT re-exported. The host half runs
// in Node and the client half imports `react`, which only DSH's browser module
// loader can resolve — re-exporting it would make the host bundle require react
// and abort the boot. The client entry is built separately into dist/client.js.

export const name = 'realbrowser';
export const inject = ['webServer', 'tools'];

import { createHostPlugin } from './host/index.js';

export function apply(ctx: any, config: any) {
  const plugin = createHostPlugin(config);
  return plugin.apply(ctx);
}
