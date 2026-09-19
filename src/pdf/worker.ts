import japaneseFont from '../../node_modules/@embedpdf/fonts-jp/fonts/NotoSansJP-Regular.otf?url&inline';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url&inline';
import { PdfRuntime } from './runtime';
import type { Request, RawImage } from './types';

// Viteで埋め込まれたdata URLを直接復号する。fetchやCDNを使わない。
const binary = Uint8Array.from(
  atob(wasmUrl.slice(wasmUrl.indexOf(',') + 1)),
  (char) => char.charCodeAt(0),
);
const font = Uint8Array.from(
  atob(japaneseFont.slice(japaneseFont.indexOf(',') + 1)),
  (char) => char.charCodeAt(0),
);
const runtime = PdfRuntime.create(binary.buffer, font);
async function encode(image: RawImage, type = 'image/png') {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を作成できません。');
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  return canvas.convertToBlob({ type, quality: 0.92 });
}
let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<Request>) => {
  queue = queue.then(async () => {
    const request = event.data;
    try {
      const pdf = await runtime;
      let result: unknown;
      switch (request.method) {
        case 'open':
          result = await pdf.open(request.args.id, request.args.content);
          break;
        case 'close':
          result = await pdf.close(request.args.id);
          break;
        case 'render':
          result = await encode(
            await pdf.render(request.args.page, request.args.scale),
            request.args.type,
          );
          break;
        case 'inspect':
          result = await pdf.inspect(request.args.page);
          break;
        case 'image':
          result = await encode(
            pdf.image(request.args.page, request.args.index),
          );
          break;
        case 'export':
          result = await pdf.export(request.args.pages);
          break;
      }
      self.postMessage({ id: request.id, result });
    } catch (error) {
      self.postMessage({
        id: request.id,
        error:
          error instanceof Error
            ? error.message
            : 'PDFを処理できません。パスワードやファイルの破損を確認してください。',
      });
    }
  });
};
