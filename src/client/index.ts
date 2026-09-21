// `react` is marked external by scripts/build-client.js and resolved at runtime
// by DSH's client module loader (`require("react")`). A bare
// `declare const React: any` would be erased by the compiler and leave the
// bundle referencing an undefined global at render time.
import React from 'react';

export interface PickedElement {
  selector: string;
  tag: string;
  text: string;
  xpath?: string;
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

export function injectIntoChatTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea = document.querySelector('textarea');
  if (textarea) {
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
  return false;
}

const callApi = async (method: string, payload?: any) => {
  try {
    const res = await fetch(`/realbrowser/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export function RealBrowserPanel(props?: { host?: any }) {
  const host = props?.host;
  const [url, setUrl] = React.useState('https://example.com');
  const [inputUrl, setInputUrl] = React.useState('https://example.com');
  const [proxyPort, setProxyPort] = React.useState(0);
  const [pickerActive, setPickerActive] = React.useState(false);
  const [viewport, setViewport] = React.useState('100%');
  const iframeRef = React.useRef(null);
  const navigationStateRef = React.useRef({ version: 0, pending: false }) as {
    current: { version: number; pending: boolean };
  };

  const callRpc = async (method: string, payload?: any) => {
    if (host?.call) {
      const rpcMethod = method.startsWith('realbrowser-') ? method : `realbrowser-${method}`;
      return payload !== undefined ? host.call(rpcMethod, payload) : host.call(rpcMethod);
    }
    const apiMethod = method.replace(/^realbrowser-/, '');
    return callApi(apiMethod, payload);
  };

  const navigateTo = (newUrl: string) => {
    const normalizedUrl = normalizeHttpUrl(newUrl);
    if (!normalizedUrl) return;
    const navigationVersion = ++navigationStateRef.current.version;
    navigationStateRef.current.pending = true;
    setInputUrl(normalizedUrl);
    setUrl(normalizedUrl);
    callRpc('navigate', { url: normalizedUrl })
      .catch(() => {})
      .finally(() => {
        if (navigationStateRef.current.version === navigationVersion) {
          navigationStateRef.current.pending = false;
        }
      });
  };

  React.useEffect(() => {
    callRpc('get-proxy').then((res: any) => {
      if (res && res.port) setProxyPort(res.port);
    });

    // Last URL the host reported. The host URL is adopted only when the host's
    // OWN value changes (an agent-driven navigation), so a stale value can never
    // overwrite what the user typed. Comparing against the current local URL
    // instead made every poll tick revert a manual navigation.
    let lastHostUrl: string | null = null;

    const syncUrl = () => {
      const navigationVersion = navigationStateRef.current.version;
      const navigationPending = navigationStateRef.current.pending;
      callRpc('get-current-url').then((res: any) => {
        if (navigationVersion !== navigationStateRef.current.version || navigationPending) return;
        const hostUrl = res?.url;
        if (!hostUrl || hostUrl === lastHostUrl) return;
        lastHostUrl = hostUrl;
        setUrl((prevUrl: string) => {
          if (hostUrl === prevUrl) return prevUrl;
          setInputUrl(hostUrl);
          return hostUrl;
        });
      }).catch(() => {});
    };

    syncUrl();
    const pollInterval = setInterval(syncUrl, 1000);

    const onMessage = (e: MessageEvent) => {
      if (iframeRef.current && e.source !== (iframeRef.current as any).contentWindow) return;
      if (e.data && e.data.type === 'REALBROWSER_ELEMENT_PICKED') {
        const msg = formatPickedElementMessage(e.data.payload);
        if (!injectIntoChatTextarea(msg)) {
          navigator.clipboard?.writeText?.(msg);
        }
        setPickerActive(false);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const togglePicker = () => {
    const next = !pickerActive;
    setPickerActive(next);
    const win = (iframeRef.current as any)?.contentWindow;
    if (win) {
      win.postMessage(
        { type: next ? 'REALBROWSER_PICKER_ENABLE' : 'REALBROWSER_PICKER_DISABLE' },
        '*'
      );
    }
  };

  const proxyUrl = proxyPort ? `http://127.0.0.2:${proxyPort}?url=${encodeURIComponent(url)}` : '';

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%' } },
    // Toolbar
    React.createElement(
      'div',
      { style: { display: 'flex', gap: '8px', padding: '8px', background: '#1e293b', borderBottom: '1px solid #334155', alignItems: 'center' } },
      React.createElement('button', {
        onClick: () => (iframeRef.current as any)?.contentWindow?.history?.back?.(),
        style: { padding: '4px 8px', background: '#334155', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
      }, 'Back'),
      React.createElement('button', {
        onClick: () => (iframeRef.current as any)?.contentWindow?.history?.forward?.(),
        style: { padding: '4px 8px', background: '#334155', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
      }, 'Forward'),
      React.createElement('button', {
        onClick: () => (iframeRef.current as any)?.contentWindow?.location?.reload?.(),
        style: { padding: '4px 8px', background: '#334155', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
      }, 'Reload'),
      React.createElement('input', {
        value: inputUrl,
        onChange: (e: any) => setInputUrl(e.target.value),
        onKeyDown: (e: any) => { if (e.key === 'Enter') navigateTo(inputUrl); },
        style: { flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: '#fff' },
        placeholder: 'Enter URL...',
      }),
      React.createElement('button', {
        onClick: () => navigateTo(inputUrl),
        style: { padding: '4px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
      }, 'Go'),
      React.createElement('button', {
        onClick: togglePicker,
        style: { padding: '4px 12px', background: pickerActive ? '#ef4444' : '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
      }, pickerActive ? 'Cancel Picker' : 'Pick Element'),
      React.createElement('select', {
        value: viewport,
        onChange: (e: any) => setViewport(e.target.value),
        style: { padding: '4px 8px', background: '#0f172a', color: '#fff', border: '1px solid #475569', borderRadius: '4px' },
      },
        React.createElement('option', { value: '100%' }, 'Responsive (100%)'),
        React.createElement('option', { value: '1920px' }, 'Desktop (1920px)'),
        React.createElement('option', { value: '768px' }, 'Tablet (768px)'),
        React.createElement('option', { value: '375px' }, 'Mobile (375px)'),
      )
    ),
    // Iframe Container
    React.createElement(
      'div',
      { style: { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', background: '#0f172a' } },
      proxyUrl ? React.createElement('iframe', {
        ref: iframeRef,
        src: proxyUrl,
        style: { width: viewport, height: '100%', border: 'none', background: '#fff' },
      }) : React.createElement('div', { style: { padding: '20px', color: '#94a3b8' } }, 'Starting proxy...')
    )
  );
}

export function createClientPlugin(host?: any) {
  return {
    apply(ctx: any) {
      const slots = ctx.get?.('slots');
      if (slots?.inject) {
        slots.inject('sidebar.view', () => {
          slots.register({ name: 'sidebar.view', id: 'realbrowser-panel' }, () => RealBrowserPanel({ host }));
        });
      }
      apply(ctx);
    },
  };
}

export const name = 'realbrowser';
export const inject = ['betterSidebar', 'slots'];

export function apply(ctx: any) {
  // 1. Register with betterSidebar
  ctx.inject?.(['betterSidebar'], (injected: any) => {
    const sidebar = injected.get?.('betterSidebar') || injected.betterSidebar;
    if (!sidebar) return;

    sidebar.registerTab({
      id: 'realbrowser',
      title: 'Browser',
      order: 45,
      icon: (size: number) => {
        return React.createElement('svg', {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.2'
        },
          React.createElement('circle', { cx: '8', cy: '8', r: '7' }),
          React.createElement('line', { x1: '1', y1: '8', x2: '15', y2: '8' }),
          React.createElement('path', { d: 'M8 1a10 10 0 0 1 0 14A10 10 0 0 1 8 1z' })
        );
      },
      component: RealBrowserPanel,
    });
  });

  // 2. Register header action button
  if (ctx.slots) {
    ctx.slots.inject?.('conversation.session.header.actions', () => {
      ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'realbrowser-open-btn',
        order: 25,
      }, () => {
        return React.createElement('button', {
          onClick: () => {
            const sidebar = ctx.get?.('betterSidebar') || (ctx as any).betterSidebar;
            if (sidebar) {
              sidebar.openTab({ type: 'realbrowser', title: 'Browser' });
            }
          },
          title: 'Open RealBrowser',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3px 8px',
            background: 'var(--dsw-alias-fill-l2, rgba(255,255,255,0.06))',
            border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))',
            borderRadius: '6px',
            color: 'var(--dsw-alias-label-secondary, #94a3b8)',
            cursor: 'pointer',
            fontSize: '12px',
            gap: '4px',
            lineHeight: '18px',
          },
        }, '🌐 Browser');
      });
    });
  }
}
