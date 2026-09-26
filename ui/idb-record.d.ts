export const DEFAULT_TIMEOUT: number;

export interface RecordStoreOptions {
  /** IndexedDB の DB 名。ツールごとに分ける。 */
  database: string;
  /** DB 内のオブジェクトストア名。 */
  store: string;
  /** 値を置くキー。 */
  key: IDBValidKey;
  /** 接続・読み書きを待つ上限（ミリ秒）。 */
  timeoutMs?: number;
}

export interface RecordStore<T = unknown> {
  /** 記録がなければ undefined。 */
  load(): Promise<T | undefined>;
  save(value: T): Promise<void>;
}

/** IndexedDB の1つのキーに値を1つ置き、読み書きする。 */
export function createRecordStore<T = unknown>(
  window: Pick<Window, 'indexedDB'>,
  options: RecordStoreOptions,
): RecordStore<T>;
