declare const React: any;

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

export function createClientPlugin(host: any) {
  return {
    apply(ctx: any) {
      const slots = ctx.get?.('slots');
      if (!slots) return;

      slots.inject('sidebar.view', () => {
        slots.register({ name: 'sidebar.view', id: 'realbrowser-panel' }, () => {
          const [url, setUrl] = React.useState('https://example.com');
          const [inputUrl, setInputUrl] = React.useState('https://example.com');
          const [proxyPort, setProxyPort] = React.useState(0);
          const [pickerActive, setPickerActive] = React.useState(false);
          const [viewport, setViewport] = React.useState('100%');
          const iframeRef = React.useRef(null);

          const navigateTo = (newUrl: string) => {
            setUrl(newUrl);
            host.call('realbrowser-navigate', { url: newUrl }).catch(() => {});
          };

          React.useEffect(() => {
            host.call('realbrowser-get-proxy').then((res: any) => {
              if (res && res.port) setProxyPort(res.port);
            });

            const syncUrl = () => {
              host.call('realbrowser-get-current-url').then((res: any) => {
                if (res && res.url) {
                  setUrl((prevUrl: string) => {
                    if (res.url !== prevUrl) {
                      setInputUrl(res.url);
                      return res.url;
                    }
                    return prevUrl;
                  });
                }
              }).catch(() => {});
            };

            syncUrl();
            const pollInterval = setInterval(syncUrl, 1000);

            const onMessage = (e: MessageEvent) => {
              if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;
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
            if (iframeRef.current && iframeRef.current.contentWindow) {
              iframeRef.current.contentWindow.postMessage(
                { type: next ? 'REALBROWSER_PICKER_ENABLE' : 'REALBROWSER_PICKER_DISABLE' },
                '*'
              );
            }
          };

          const proxyUrl = proxyPort ? `http://127.0.0.1:${proxyPort}?url=${encodeURIComponent(url)}` : '';

          return React.createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%' } },
            // Toolbar
            React.createElement(
              'div',
              { style: { display: 'flex', gap: '8px', padding: '8px', background: '#1e293b', borderBottom: '1px solid #334155', alignItems: 'center' } },
              React.createElement('button', {
                onClick: () => iframeRef.current?.contentWindow?.history?.back?.(),
                style: { padding: '4px 8px', background: '#334155', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
              }, 'Back'),
              React.createElement('button', {
                onClick: () => iframeRef.current?.contentWindow?.history?.forward?.(),
                style: { padding: '4px 8px', background: '#334155', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
              }, 'Forward'),
              React.createElement('button', {
                onClick: () => iframeRef.current?.contentWindow?.location?.reload?.(),
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
        });
      });
    },
  };
}
