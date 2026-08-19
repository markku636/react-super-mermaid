import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const USE_CLIENT = "'use client';\n";

export default defineConfig({
  // index = React 元件入口(含 'use client');editor = 框架無關繪製/round-trip 引擎(零 React);
  // orid = 只有 ORID 轉譯的極小入口(自行呼叫 mermaid.render 的 host 用)。
  entry: { index: 'src/index.ts', editor: 'src/editor.ts', orid: 'src/orid.ts' },
  format: ['esm', 'cjs'],
  target: 'es2020',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  // Never bundle the peers — the host provides them (or we load mermaid at runtime).
  external: ['react', 'react-dom', 'react/jsx-runtime', 'mermaid', 'svg-pan-zoom'],
  onSuccess: async () => {
    // Ship the sketch-theme handwriting font alongside the JS so the default
    // jsDelivr URL (`/npm/react-super-mermaid/dist/Virgil.woff2`) resolves post-publish.
    mkdirSync('dist', { recursive: true });
    copyFileSync('assets/Virgil.woff2', 'dist/Virgil.woff2');
    // esbuild strips a `banner` "use client" directive when bundling, so prepend it
    // here to preserve the React Server Components client boundary for Next.js consumers.
    for (const file of ['dist/index.js', 'dist/index.cjs']) {
      const code = readFileSync(file, 'utf8');
      if (!code.startsWith("'use client'")) {
        writeFileSync(file, USE_CLIENT + code);
      }
    }
  },
});
