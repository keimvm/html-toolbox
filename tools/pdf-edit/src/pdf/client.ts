import PdfWorker from './worker?worker&inline';
import type { Operations } from './types';

export class PdfClient {
  private worker = new PdfWorker();
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (result: never) => void; reject: (error: Error) => void }
  >();
  private failed = false;
  constructor() {
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; result: never; error?: string }>,
    ) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result);
    };
    this.worker.onerror = () => {
      this.failed = true;
      this.pending.forEach(({ reject }) =>
        reject(
          new Error('PDF処理を開始できません。画面を開き直してください。'),
        ),
      );
      this.pending.clear();
    };
  }
  call<K extends keyof Operations>(
    method: K,
    args: Operations[K]['args'],
  ): Promise<Operations[K]['result']> {
    if (this.failed)
      return Promise.reject(
        new Error('PDF処理が停止しています。画面を開き直してください。'),
      );
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args });
    });
  }
}
