// PDF エンジンの呼び出し口。PDF編集と画像変換が同じ Worker（PDFium 1つ）を使う。
// 最初に使うときに Worker を作り、PDFium と日本語フォントを渡す。
import { payloadSource } from 'virtual:toolbox/payload';
import PdfWorker from './worker?worker&inline';
import type { Operations, Response } from './types';

export class PdfEngine {
  private worker = new PdfWorker();
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (result: never) => void; reject: (error: Error) => void }
  >();
  private failed = false;

  constructor() {
    this.worker.postMessage({
      init: { pdfium: payloadSource('pdfium'), font: payloadSource('font-jp') },
    });
    this.worker.onmessage = (event: MessageEvent<Response>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if ('error' in event.data) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result as never);
    };
    this.worker.onerror = () => {
      this.failed = true;
      for (const { reject } of this.pending.values())
        reject(new Error('PDFの処理を始められません。画面を開き直してください。'));
      this.pending.clear();
    };
  }

  call<K extends keyof Operations>(
    method: K,
    args: Operations[K]['args'],
    transfer: Transferable[] = [],
  ): Promise<Operations[K]['result']> {
    if (this.failed)
      return Promise.reject(new Error('PDFの処理が止まっています。画面を開き直してください。'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args }, transfer);
    });
  }
}

let shared: PdfEngine | undefined;
/** 全ツールで共有する PDF エンジン。 */
export const pdfEngine = () => (shared ??= new PdfEngine());
