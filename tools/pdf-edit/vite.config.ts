import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    viteSingleFile(),
    {
      name: 'distribution-filename',
      apply: 'build',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const html = bundle['index.html'];
        if (!html || html.type !== 'asset') {
          this.error('配布用のHTMLが生成されませんでした。');
        }
        this.emitFile({
          type: 'asset',
          fileName: 'PDF編集.html',
          source: html.source,
        });
        delete bundle['index.html'];
      },
    },
    {
      name: 'offline-distribution-policy',
      apply: 'build',
      transformIndexHtml() {
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content:
                "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: data:; worker-src blob: data:; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'none'; base-uri 'none'; form-action 'none'",
            },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  ],
  // public/のファイルは埋め込まれないため、単一HTMLの配布には使わない。
  publicDir: false,
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022', modulePreload: false },
});
