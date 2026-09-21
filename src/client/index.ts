// `react` is external and supplied by DSH's client module loader.
import React from 'react';
import { VIEWPORT_GROUPS, mapPreviewPoint, resolveViewportMetrics } from '../browser/viewports.js';
import type { BrowserInput, BrowserSnapshot, ViewportMetrics } from '../browser/protocol.js';

export interface PickedElement {
  selector: string;
  tag: string;
  text: string;
  xpath?: string;
}

export interface RealBrowserPanelProps {
  host?: any;
  ctx?: any;
  scope?: { sessionId: string };
  visible?: boolean;
}

export function formatPickedElementMessage(el: PickedElement): string {
  if (el.xpath) {
    return `Element selected: \`${el.selector}\` [XPath: \`${el.xpath}\`] (<${el.tag}>: "${el.text}")`;
  }
  return `Element selected: \`${el.selector}\` (<${el.tag}>: "${el.text}")`;
}

export function normalizeHttpUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Removed in Task 7 after the Conversation service replaces the legacy bridge.
export function injectIntoChatTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea = document.querySelector('textarea');
  if (!textarea) return false;
  const newText = textarea.value ? `${textarea.value}\n${text}` : text;
  const win = typeof window !== 'undefined' ? window : (globalThis as any);
  const setter = win.HTMLTextAreaElement?.prototype
    ? Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set
    : undefined;
  if (setter) setter.call(textarea, newText);
  else textarea.value = newText;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  textarea.focus();
  return true;
}

const callApi = async (method: string, payload?: any) => {
  const response = await fetch(`/realbrowser/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  if (!response.ok) throw new Error(`RealBrowser request failed (${response.status})`);
  return response.json();
};

const mouseButtons = ['left', 'middle', 'right'] as const;

export function pointerInputFromEvent(
  event: { clientX: number; clientY: number; button?: number },
  rect: { left: number; top: number; width: number; height: number },
  viewport: Pick<ViewportMetrics, 'width' | 'height'>,
  type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
): BrowserInput {
  const point = mapPreviewPoint(
    { x: event.clientX - rect.left, y: event.clientY - rect.top },
    rect,
    viewport,
  );
  if (type === 'mouseMoved') return { kind: 'mouse', type, ...point };
  const button = mouseButtons[event.button ?? 0] ?? 'left';
  return { kind: 'mouse', type, ...point, button, clickCount: 1 };
}

function modifiersFromEvent(event: any): number {
  return (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0);
}

function icon(path: string) {
  return React.createElement('svg', {
    viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true,
  }, React.createElement('path', { d: path, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}

const initialSnapshot: BrowserSnapshot = {
  url: 'https://example.com',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
};

export function RealBrowserPanel(props: RealBrowserPanelProps = {}) {
  const host = props.host;
  const visible = props.visible !== false;
  const [snapshot, setSnapshot] = React.useState(initialSnapshot);
  const [inputUrl, setInputUrl] = React.useState(initialSnapshot.url);
  const [viewportId, setViewportId] = React.useState('responsive');
  const [frameUrl, setFrameUrl] = React.useState('');
  const [pickerActive, setPickerActive] = React.useState(false);
  const [error, setError] = React.useState('');
  const surfaceRef = React.useRef(null) as { current: any };
  const previewRef = React.useRef(null) as { current: any };
  const objectUrlRef = React.useRef(null) as { current: string | null };
  const metricsRef = React.useRef({ width: 1, height: 1, deviceScaleFactor: 1, mobile: false }) as {
    current: ViewportMetrics;
  };
  const navigationStateRef = React.useRef({ version: 0, pending: false }) as {
    current: { version: number; pending: boolean };
  };

  const callRpc = (method: string, payload?: any) => {
    const rpcMethod = method.startsWith('realbrowser-') ? method : `realbrowser-${method}`;
    if (host?.call) return payload === undefined ? host.call(rpcMethod) : host.call(rpcMethod, payload);
    return callApi(rpcMethod.replace(/^realbrowser-/, ''), payload);
  };

  const reportError = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : String(reason));
  };

  const navigateTo = (value: string) => {
    const normalized = normalizeHttpUrl(value);
    if (!normalized) return;
    const version = ++navigationStateRef.current.version;
    navigationStateRef.current.pending = true;
    setInputUrl(normalized);
    setSnapshot((current: BrowserSnapshot) => ({ ...current, url: normalized, loading: true }));
    setError('');
    void callRpc('navigate', { url: normalized })
      .catch(reportError)
      .finally(() => {
        if (navigationStateRef.current.version === version) navigationStateRef.current.pending = false;
      });
  };

  const command = (value: 'back' | 'forward' | 'reload') => {
    setError('');
    void callRpc('command', { command: value }).catch(reportError);
  };

  const sendInput = (input: BrowserInput) => {
    void callRpc('input', input).catch(reportError);
  };

  React.useEffect(() => {
    let active = true;
    let lastHostUrl: string | null = null;
    const syncState = async () => {
      const version = navigationStateRef.current.version;
      try {
        const state = await callRpc('get-state');
        if (!active || !state) return;
        setSnapshot(state);
        if (version !== navigationStateRef.current.version || navigationStateRef.current.pending) return;
        if (typeof state.url === 'string' && state.url && state.url !== lastHostUrl) {
          lastHostUrl = state.url;
          setInputUrl(state.url);
        }
      } catch (reason) {
        if (active) reportError(reason);
      }
    };
    void syncState();
    const timer = setInterval(syncState, 250);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    let active = true;
    let started = false;
    let sequence = 0;
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const delay = (ms: number) => new Promise<void>((resolve) => {
      delayTimer = setTimeout(resolve, ms);
    });
    const stop = () => {
      if (started) void callRpc('stop-stream').catch(() => {});
      started = false;
    };
    const run = async () => {
      try {
        const rect = previewRef.current?.getBoundingClientRect?.();
        await callRpc('start-stream', {
          maxWidth: Math.max(1, Math.round(rect?.width || 1)),
          maxHeight: Math.max(1, Math.round(rect?.height || 1)),
        });
        started = true;
        if (!active) {
          stop();
          return;
        }
        while (active) {
          const response = await fetch(`/realbrowser/frame?after=${sequence}`, { signal: abort.signal });
          if (!active) return;
          if (response.status === 204) {
            await delay(33);
            continue;
          }
          if (!response.ok) throw new Error(`Frame request failed (${response.status})`);
          const nextSequence = Number(response.headers.get('x-realbrowser-sequence'));
          if (!Number.isSafeInteger(nextSequence) || nextSequence <= sequence) {
            throw new Error('Invalid frame sequence');
          }
          const nextUrl = URL.createObjectURL(await response.blob());
          if (!active) {
            URL.revokeObjectURL(nextUrl);
            return;
          }
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = nextUrl;
          sequence = nextSequence;
          setFrameUrl(nextUrl);
        }
      } catch (reason: any) {
        if (active && reason?.name !== 'AbortError') reportError(reason);
      }
    };
    void run();
    return () => {
      active = false;
      abort.abort();
      if (delayTimer !== undefined) clearTimeout(delayTimer);
      stop();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    const applyViewport = () => {
      const rect = previewRef.current?.getBoundingClientRect?.();
      const responsiveSize = {
        width: Math.max(1, Math.round(rect?.width || 1)),
        height: Math.max(1, Math.round(rect?.height || 1)),
      };
      const metrics = resolveViewportMetrics(viewportId, responsiveSize);
      metricsRef.current = metrics;
      const payload = viewportId === 'responsive'
        ? { id: viewportId, ...responsiveSize }
        : { id: viewportId };
      void callRpc('set-viewport', payload).catch(reportError);
    };
    applyViewport();
    if (viewportId !== 'responsive' || typeof ResizeObserver === 'undefined' || !previewRef.current) return;
    const observer = new ResizeObserver(applyViewport);
    observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [visible, viewportId]);

  const forwardPointer = (event: any, type: 'mouseMoved' | 'mousePressed' | 'mouseReleased') => {
    const rect = surfaceRef.current?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return;
    event.preventDefault();
    if (type === 'mousePressed') surfaceRef.current?.focus?.();
    sendInput(pointerInputFromEvent(event, rect, metricsRef.current, type));
  };

  const forwardWheel = (event: any) => {
    const rect = surfaceRef.current?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return;
    event.preventDefault();
    const point = mapPreviewPoint(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      rect,
      metricsRef.current,
    );
    sendInput({ kind: 'wheel', ...point, deltaX: event.deltaX, deltaY: event.deltaY });
  };

  const forwardKey = (event: any, type: 'keyDown' | 'keyUp') => {
    if (typeof event.key !== 'string' || typeof event.code !== 'string') return;
    event.preventDefault();
    const modifiers = modifiersFromEvent(event);
    sendInput({ kind: 'key', type, key: event.key, code: event.code, modifiers });
    if (type === 'keyDown' && event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      sendInput({ kind: 'text', text: event.key });
    }
  };

  const toolbarStyle = {
    display: 'flex', gap: '6px', padding: '8px', alignItems: 'center', flexWrap: 'wrap',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    borderBottom: '1px solid var(--dsw-alias-border-l1)',
  };
  const buttonStyle = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '30px', minHeight: '30px',
    padding: '4px 8px', borderRadius: '6px', cursor: 'pointer',
    background: 'var(--dsw-alias-fill-l2)', color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l1)',
  };

  const browserButton = (
    label: string,
    path: string,
    onClick: () => void,
    disabled = false,
  ) => React.createElement('button', {
    type: 'button', title: label, 'aria-label': label, onClick, disabled,
    style: { ...buttonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' },
  }, icon(path));

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: 'var(--dsw-alias-bg-base)' } },
    React.createElement('style', {}, '.realbrowser-surface:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}'),
    React.createElement(
      'div',
      { style: toolbarStyle },
      browserButton('Back', 'M10.5 3.5 6 8l4.5 4.5M6 8h7', () => command('back'), !snapshot.canGoBack),
      browserButton('Forward', 'M5.5 3.5 10 8l-4.5 4.5M10 8H3', () => command('forward'), !snapshot.canGoForward),
      browserButton('Reload', 'M12.5 5.5A5 5 0 1 0 13 9M12.5 5.5V2.5m0 3h-3', () => command('reload')),
      React.createElement('input', {
        value: inputUrl,
        onChange: (event: any) => setInputUrl(event.target.value),
        onKeyDown: (event: any) => { if (event.key === 'Enter') navigateTo(inputUrl); },
        'aria-label': 'Address',
        placeholder: 'Enter URL',
        style: {
          flex: '1 1 220px', minWidth: '120px', padding: '6px 8px', borderRadius: '6px',
          border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)',
          color: 'var(--dsw-alias-label-primary)',
        },
      }),
      React.createElement('button', {
        type: 'button', onClick: () => navigateTo(inputUrl), style: buttonStyle,
      }, 'Go'),
      React.createElement('button', {
        type: 'button', onClick: () => setPickerActive(!pickerActive),
        'aria-pressed': pickerActive,
        style: {
          ...buttonStyle,
          borderColor: pickerActive ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)',
          color: pickerActive ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)',
        },
      }, pickerActive ? 'Cancel Picker' : 'Pick Element'),
      React.createElement('select', {
        value: viewportId,
        onChange: (event: any) => setViewportId(event.target.value),
        'aria-label': 'Viewport',
        style: {
          padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
        },
      }, ...VIEWPORT_GROUPS.map((group) => React.createElement(
        'optgroup',
        { key: group.label, label: group.label },
        ...group.options.map((option) => React.createElement('option', { key: option.id, value: option.id }, option.label)),
      ))),
    ),
    error ? React.createElement('div', {
      role: 'status', 'aria-live': 'polite',
      style: { padding: '6px 8px', color: 'var(--dsw-alias-label-error)', background: 'var(--dsw-alias-bg-layer-1)' },
    }, error) : null,
    React.createElement(
      'div',
      {
        ref: previewRef,
        style: {
          flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-secondary)',
        },
      },
      React.createElement('img', {
        ref: surfaceRef,
        className: 'realbrowser-surface',
        src: frameUrl || undefined,
        alt: 'Live browser page',
        tabIndex: 0,
        draggable: false,
        'aria-busy': snapshot.loading,
        onMouseMove: (event: any) => forwardPointer(event, 'mouseMoved'),
        onMouseDown: (event: any) => forwardPointer(event, 'mousePressed'),
        onMouseUp: (event: any) => forwardPointer(event, 'mouseReleased'),
        onWheel: forwardWheel,
        onKeyDown: (event: any) => forwardKey(event, 'keyDown'),
        onKeyUp: (event: any) => forwardKey(event, 'keyUp'),
        style: {
          display: frameUrl ? 'block' : 'none', maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto',
          userSelect: 'none', cursor: pickerActive ? 'crosshair' : 'default',
        },
      }),
      !frameUrl ? React.createElement('div', { role: 'status' }, snapshot.loading ? 'Loading page…' : 'Waiting for browser frame…') : null,
    ),
  );
}

function registerClient(ctx: any, host?: any) {
  const slots = ctx.get?.('slots') || ctx.slots;
  if (slots?.inject) {
    slots.inject('sidebar.view', () => slots.register(
      { name: 'sidebar.view', id: 'realbrowser-panel' },
      (props: any) => RealBrowserPanel({ ...props, ctx, host }),
    ));
  }

  ctx.inject?.(['betterSidebar'], (injected: any) => {
    const sidebar = injected.get?.('betterSidebar') || injected.betterSidebar;
    if (!sidebar) return;
    sidebar.registerTab({
      id: 'realbrowser', title: 'Browser', order: 45,
      icon: (size: number) => React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: '1.2', 'aria-hidden': true,
      },
      React.createElement('circle', { cx: '8', cy: '8', r: '7' }),
      React.createElement('line', { x1: '1', y1: '8', x2: '15', y2: '8' }),
      React.createElement('path', { d: 'M8 1a10 10 0 0 1 0 14A10 10 0 0 1 8 1z' })),
      component: (props: any) => RealBrowserPanel({ ...props, ctx, host }),
    });
  });

  if (slots?.inject) {
    slots.inject('conversation.session.header.actions', () => slots.register({
      name: 'conversation.session.header.actions', id: 'realbrowser-open-btn', order: 25,
    }, () => React.createElement('button', {
      type: 'button',
      onClick: () => (ctx.get?.('betterSidebar') || ctx.betterSidebar)?.openTab({ type: 'realbrowser', title: 'Browser' }),
      title: 'Open RealBrowser', 'aria-label': 'Open RealBrowser',
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '3px 8px',
        background: 'var(--dsw-alias-fill-l2)', border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
        fontSize: '12px', lineHeight: '18px',
      },
    }, 'Browser')));
  }
}

export function createClientPlugin(host?: any) {
  return { apply(ctx: any) { registerClient(ctx, host); } };
}

export const name = 'realbrowser';
export const inject = ['betterSidebar', 'slots'];

export function apply(ctx: any) {
  registerClient(ctx, (ctx as any).host);
}
