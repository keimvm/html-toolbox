import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { dropPdfiumUrl, toolbox, workerLicenseCollector } from './vite/toolbox.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
// 版は scripts/toolbox.mjs が環境変数で渡す。開発中は「開発版」と表示する。
const version = process.env.TOOLBOX_VERSION ?? 'dev';
const plugins = toolbox({ root });

export default defineConfig({
  plugins: [viteSingleFile(), ...plugins],
  worker: {
    format: 'iife',
    plugins: () => [dropPdfiumUrl(), workerLicenseCollector(plugins)],
  },
  define: {
    __TOOLBOX_VERSION__: JSON.stringify(version),
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  // public/ のファイルは HTML に埋め込まれないため使わない。
  publicDir: false,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    target: ['chrome129', 'edge129'],
    // light-dark() を OS の設定だけに従う形へ変換させず、画面の切り替えを効かせる。
    cssTarget: ['chrome129', 'edge129'],
    modulePreload: false,
    reportCompressedSize: false,
    rollupOptions: {
      // 普通の script として実行し、HTML の末尾の重いデータを読む前に画面を出す（vite/toolbox.ts）。
      output: { format: 'iife' },
    },
  },
});
