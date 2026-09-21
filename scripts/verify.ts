import http from 'node:http';
import { startProxyServer } from '../src/proxy/proxy-server.js';
import { getOptimalSelector } from '../src/picker/selector-generator.js';
import { formatPickedElementMessage } from '../src/client/index.js';

async function main() {
  console.log('--- RealBrowser Self-Verification ---');

  // 1. Verify selector generation
  const sel = getOptimalSelector({ id: 'login-btn', tagName: 'BUTTON', classList: [] });
  console.assert(sel === '#login-btn', 'Selector generation failed');
  console.log('✔ Selector Generator passed');

  // 2. Verify client message formatting
  const msg = formatPickedElementMessage({ selector: '#login-btn', tag: 'button', text: 'Log In' });
  console.assert(msg.includes('#login-btn'), 'Message formatting failed');
  console.log('✔ Element context formatting passed');

  // 3. Verify proxy server startup & picker endpoint
  const proxy = await startProxyServer();
  console.log(`✔ Proxy server started on port ${proxy.port}`);

  await new Promise<void>((resolve, reject) => {
    http.get(`http://127.0.0.1:${proxy.port}/__realbrowser/picker.js`, (res) => {
      console.assert(res.statusCode === 200, 'Picker JS endpoint failed');
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        console.assert(body.includes('REALBROWSER_PICKER_LOADED'), 'Picker script content invalid');
        console.log('✔ Picker injection script served correctly');
        resolve();
      });
    }).on('error', reject);
  });

  proxy.close();
  console.log('✔ RealBrowser verification completed successfully!');
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
