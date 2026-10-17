// テスト用の CP932 対応表（fixtures/）を読む。配布物には入れない。
import { readFileSync } from 'node:fs';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'latin1');

/** CP932.TXT：コード → Unicode。UNDEFINED の行は含めない。 */
export function readCp932(): Map<number, number> {
  const map = new Map<number, number>();
  for (const line of fixture('CP932.TXT').split('\n')) {
    const match = /^0x([0-9A-F]+)\t0x([0-9A-F]+)/iu.exec(line);
    if (match) map.set(parseInt(match[1]!, 16), parseInt(match[2]!, 16));
  }
  return map;
}

/** bestfit932.txt：MBTABLE・DBCSTABLE（コード → Unicode）と WCTABLE（Unicode → コード）。 */
export function readBestFit932() {
  const multiByte = new Map<number, number>();
  const wideChar = new Map<number, number>();
  let section: 'mb' | 'dbcs' | 'wc' | undefined;
  let lead = 0;
  for (const raw of fixture('bestfit932.txt').split(/\r?\n/u)) {
    // ; 以降はコメント。
    const line = raw.replace(/;.*/u, '').trim();
    // DBCSRANGE の2つ目の範囲は、直前の DBCSTABLE の後ろに続く。
    if (/Lead Byte Range/u.test(raw)) continue;
    const [tag, first] = line.split(/\s+/u);
    if (tag === 'MBTABLE') section = 'mb';
    else if (tag === 'DBCSTABLE') {
      section = 'dbcs';
      lead = parseInt(/LeadByte = 0x([0-9a-f]+)/iu.exec(raw)![1]!, 16);
    } else if (tag === 'WCTABLE') section = 'wc';
    else if (tag === 'DBCSRANGE' || tag === 'ENDCODEPAGE') section = undefined;
    else if (section && tag?.startsWith('0x') && first?.startsWith('0x')) {
      const from = parseInt(tag, 16);
      const to = parseInt(first, 16);
      if (section === 'mb') multiByte.set(from, to);
      else if (section === 'dbcs') multiByte.set((lead << 8) | from, to);
      else wideChar.set(from, to);
    }
  }
  return { multiByte, wideChar };
}
