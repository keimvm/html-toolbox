import japaneseFont from '../../node_modules/@embedpdf/fonts-jp/fonts/NotoSansJP-Regular.otf?url&inline';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url&inline';
import { PdfRuntime } from './runtime';
import type { JpegEncoder, RawImage, Request } from './types';

// Vite で埋め込まれた data URL を直接復号する。fetch や CDN を使わない。
const decode = (url: string) =>
  Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (char) =>
    char.charCodeAt(0),
  );
const runtime = PdfRuntime.create(decode(wasmUrl).buffer, decode(japaneseFont));

function canvasOf(image: RawImage) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を作成できません。');
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  return canvas;
}

const encodeJpeg: JpegEncoder = async (image, width, height, quality) => {
  const source = canvasOf(image);
  let canvas = source;
  if (width !== image.width || height !== image.height) {
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像を作成できません。');
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
  }
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Uint8Array(await blob.arrayBuffer());
};

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
        case 'render': {
          const { id, index, dpi } = request.args;
          result = await canvasOf(
            await pdf.render(id, index, dpi),
          ).convertToBlob({ type: 'image/png' });
          break;
        }
        case 'create':
          result = pdf.create(request.args.images);
          break;
        case 'shrink':
          result = await pdf.shrink(
            request.args.content,
            request.args.options,
            encodeJpeg,
          );
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
