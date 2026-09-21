import esbuild from 'esbuild';
import fs from 'fs';

async function build() {
  const result = await esbuild.build({
    entryPoints: ['src/client/index.ts'],
    bundle: true,
    format: 'cjs',
    target: 'es2022',
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/*',
    ],
    write: false,
  });

  const code = result.outputFiles[0].text;
  const wrapped = `window.__ModuleLoader__.load({
  id: "realbrowser",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${code}
    return module.exports;
  }
});
`;

  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('dist/client.js', wrapped, 'utf8');
  console.log('dist/client.js built successfully');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
