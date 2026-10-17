// PDF エンジンの Worker。最初のメッセージで PDFium と日本語フォントを受け取り、以後は順番に処理する。
import { decodePayload } from './payload';
import { PdfRuntime } from './runtime';
import type { PayloadSource } from 'virtual:toolbox/payload';
import type { JpegEncoder, RawImage, Request, Response } from './types';

interface Init {
  init: { pdfium: PayloadSource; font: PayloadSource };
}

let runtime: Promise<PdfRuntime> | undefined;

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

const encode = (image: RawImage, type: 'image/png' | 'image/jpeg' = 'image/png') =>
  canvasOf(image).convertToBlob({ type, quality: 0.92 });

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

async function handle(request: Request): Promise<unknown> {
  const pdf = await runtime!;
  switch (request.method) {
    case 'open':
      return pdf.open(request.args.id, request.args.content);
    case 'close':
      return pdf.close(request.args.id);
    case 'render':
      return encode(await pdf.render(request.args.page, request.args.scale), request.args.type);
    case 'inspect':
      return pdf.inspect(request.args.page);
    case 'image':
      return encode(pdf.image(request.args.page, request.args.index));
    case 'export':
      return pdf.export(request.args.pages);
    case 'removeElements':
      return pdf.removeElements(request.args.page, request.args.indices, request.args.id);
    case 'create':
      return pdf.create(request.args.images);
    case 'shrink':
      return pdf.shrink(request.args.content, request.args.options, encodeJpeg);
  }
}

let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<Request | Init>) => {
  const data = event.data;
  if ('init' in data) {
    runtime = Promise.all([decodePayload(data.init.pdfium), decodePayload(data.init.font)]).then(
      ([wasm, font]) => PdfRuntime.create(wasm, new Uint8Array(font)),
    );
    return;
  }
  queue = queue.then(async () => {
    let response: Response;
    try {
      response = { id: data.id, result: await handle(data) };
    } catch (error) {
      response = {
        id: data.id,
        error:
          error instanceof Error
            ? error.message
            : 'PDFを処理できません。パスワードやファイルの破損を確認してください。',
      };
    }
    self.postMessage(response);
  });
};
