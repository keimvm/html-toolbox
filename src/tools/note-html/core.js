/* eslint-disable no-control-regex -- 名前・パス・フォント名に使えない制御文字を拒むため。 */
export const isMarkdown = name => /\.md$/i.test(name);
export const isImage = name => /\.(png|jpe?g|gif|webp)$/i.test(name);

export function equalBytes(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function decodeFile(bytes) {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
  } catch {
    return { text: new TextDecoder().decode(bytes), bom, newline: '\n', problem: 'UTF-8 以外の文字コードです。元のファイルを UTF-8 に変換してから開き直してください。' };
  }
  const crlf = text.includes('\r\n');
  const remainder = text.replaceAll('\r\n', '');
  let problem = '';
  if (remainder.includes('\r') || (crlf && remainder.includes('\n'))) {
    problem = '改行コードが混在しているか、非対応の改行コードです。元のファイルを LF または CRLF に統一してから開き直してください。';
  }
  if (text.includes('\0')) problem = 'テキストとして扱えない文字が含まれています。UTF-8 の Markdown ファイルを開いてください。';
  return { text: text.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), bom, newline: crlf ? '\r\n' : '\n', problem };
}

export function encodeFile(text, format) {
  if (format.problem) throw new Error('UnsupportedFormat');
  return new TextEncoder().encode((format.bom ? '\ufeff' : '') + text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', format.newline));
}

// URL を分類してから、選択済みルート内のパスだけを解決する。
export function resolveReference(raw, currentPath) {
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!url.username && !url.password) return { kind: 'external', url: url.href };
    } catch { /* 不正な URL は参照不可として表示する。 */ }
    return { kind: 'blocked' };
  }
  if (/^[a-z][\w+.-]*:/i.test(value) || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return { kind: 'blocked' };
  const hashAt = value.indexOf('#');
  const pathPart = hashAt < 0 ? value : value.slice(0, hashAt);
  let fragment, decoded;
  try {
    decoded = decodeURIComponent(pathPart);
    fragment = hashAt < 0 ? '' : decodeURIComponent(value.slice(hashAt + 1));
  } catch { return { kind: 'blocked' }; }
  if (!pathPart && hashAt >= 0) return { kind: 'anchor', fragment };
  if (!decoded || decoded.startsWith('/') || decoded.includes('\\') || /[:?\u0000-\u001f\u007f]/.test(decoded)) return { kind: 'blocked' };
  const parts = currentPath.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length) return { kind: 'blocked' };
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  const path = parts.join('/');
  return { kind: isImage(path) ? 'image' : path.startsWith('.assets/') ? 'attachment' : isMarkdown(path) ? 'note' : 'blocked', path, fragment };
}

export async function getHandle(root, path) {
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) throw new Error('InvalidPath');
  let parent = root;
  for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
  return parent.getFileHandle(parts.at(-1));
}

export async function readBytes(handle) {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

export async function listDirectory(handle) {
  const entries = [];
  for await (const entry of handle.values()) {
    if (entry.kind === 'directory' || isMarkdown(entry.name)) entries.push(entry);
  }
  const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'variant' });
  return entries.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'directory' ? -1 : 1));
}

export function errorMessage(error, action = '読み込み') {
  switch (error?.name) {
    case 'AbortError': return `${action}が中断されました。もう一度お試しください。`;
    case 'NotAllowedError': case 'SecurityError': return `${action}の許可がありません。ブラウザーのアクセス許可を確認して、もう一度お試しください。`;
    case 'NotFoundError': return 'ファイルまたはフォルダが削除・移動されています。現在の本文は保持しています。';
    case 'NotReadableError': return 'ファイルを取得できません。ローカルで利用可能な状態にして、もう一度お試しください。';
    case 'QuotaExceededError': return '空き容量が不足しているため保存できません。空き容量を確保して、もう一度お試しください。';
    default: return `${action}できませんでした。ファイルの状態とアクセス権を確認して、もう一度お試しください。`;
  }
}
