// HTML の末尾に埋め込んだバイナリ（vite/toolbox.ts）を取り出す。Worker の中で使う。
import type { PayloadSource } from 'virtual:toolbox/payload';

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const native = (
    Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array<ArrayBuffer> }
  ).fromBase64;
  if (native) return native(text);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 埋め込んだ gzip を標準の DecompressionStream で展開する。開発中はファイルを読む。 */
export async function decodePayload(source: PayloadSource): Promise<ArrayBuffer> {
  if (source.kind === 'url') return (await fetch(source.url)).arrayBuffer();
  const stream = new Blob([fromBase64(source.text.trim())])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}
