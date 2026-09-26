import { getHandle, isImage } from './core.js';

const encoder = new TextEncoder();
function shorten(value, maxBytes) {
  let result = '';
  for (const character of value) {
    if (encoder.encode(result + character).length > maxBytes) break;
    result += character;
  }
  return result;
}

export function assetName(original, id) {
  const clean = original.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '');
  const dot = clean.lastIndexOf('.');
  const extension = dot > 0 ? shorten(clean.slice(dot), 24) : '';
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  return `${shorten(stem, 160) || 'file'}-${id}${extension}`;
}

export function assetReference(notePath, name) {
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${'../'.repeat(notePath.split('/').length - 1)}.assets/${encoded}`;
}

// File をそのままストリームに渡し、大きな添付の全体コピーをメモリ内に作らない。
export async function saveAssets(root, notePath, files, { createId = () => crypto.randomUUID(), cancelled = () => false } = {}) {
  const directory = await root.getDirectoryHandle('.assets', { create: true });
  const added = [], failed = [];
  for (const file of files) {
    if (cancelled()) break;
    let name, handle, stream;
    try {
      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = assetName(file.name, createId());
        try { await directory.getFileHandle(candidate); }
        catch (error) {
          if (error.name === 'NotFoundError') { name = candidate; break; }
          if (error.name !== 'TypeMismatchError') throw error;
        }
      }
      if (!name) throw new Error('AssetNameCollision');
      if (cancelled()) break;
      handle = await directory.getFileHandle(name, { create: true });
      stream = await handle.createWritable();
      await stream.write(file);
      await stream.close(); stream = null;
      added.push({ name: file.name, path: `.assets/${name}`, href: assetReference(notePath, name), image: isImage(name) });
    } catch (error) {
      if (stream) { try { await stream.abort(); } catch { /* 途中ファイルの削除も試みる。 */ } }
      let remaining = '';
      if (handle) {
        try {
          const current = await directory.getFileHandle(name);
          if (await current.isSameEntry(handle)) await directory.removeEntry(name);
          else remaining = `.assets/${name}`;
        } catch (cleanupError) { if (cleanupError.name !== 'NotFoundError') remaining = `.assets/${name}`; }
      }
      failed.push({ name: file.name, error, remaining });
    }
  }
  return { added, failed };
}

export const hasDroppedFiles = transfer => Array.from(transfer?.types || []).includes('Files');

export function droppedFiles(transfer) {
  const items = Array.from(transfer?.items || []).filter(item => item.kind === 'file');
  if (items.some(item => item.webkitGetAsEntry?.()?.isDirectory)) return null;
  return Array.from(transfer?.files || []);
}

// MIME をファイル名の許可リストから決め、HTML・SVG等を文書として実行しない。
export function previewMime(path) {
  const extension = path.split('.').at(-1).toLowerCase();
  return ({ pdf: 'application/pdf', txt: 'text/plain;charset=utf-8', md: 'text/plain;charset=utf-8', csv: 'text/plain;charset=utf-8', log: 'text/plain;charset=utf-8', json: 'text/plain;charset=utf-8',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' })[extension] || '';
}

export function createAssetOpener(window, onNotice) {
  const resources = new Set();
  const pending = new Set();
  let disposed = false;
  function release(resource) {
    window.clearTimeout(resource.timer); window.clearInterval(resource.timer);
    window.URL.revokeObjectURL(resource.url); resources.delete(resource);
  }
  function urlFor(file, mime) {
    const resource = { url: window.URL.createObjectURL(file.slice(0, file.size, mime)), timer: null };
    resources.add(resource); return resource;
  }
  function download(file) {
    if (disposed) return;
    const resource = urlFor(file, 'application/octet-stream');
    const link = window.document.createElement('a');
    link.href = resource.url; link.download = file.name; link.rel = 'noopener noreferrer';
    window.document.body.append(link); link.click(); link.remove();
    resource.timer = window.setTimeout(() => release(resource), 60_000);
  }
  return {
    async open(root, path) {
      if (disposed || !(path.startsWith('.assets/') || isImage(path))) return;
      const mime = previewMime(path);
      let popup;
      // 非同期のファイル取得前にタブを確保する。拒否された場合はダウンロードを案内する。
      if (mime) {
        try {
          popup = window.open('about:blank', '_blank');
          if (popup) { popup.opener = null; popup.document.title = '添付を読み込み中…'; pending.add(popup); }
        } catch { popup?.close(); popup = null; }
      }
      try {
        const file = await (await getHandle(root, path)).getFile();
        if (disposed) { popup?.close(); return; }
        if (!mime) { download(file); return; }
        let opened = false;
        if (popup && !popup.closed) {
          const resource = urlFor(file, mime);
          try {
            popup.location.replace(resource.url);
            resource.timer = window.setInterval(() => { if (popup.closed) release(resource); }, 1000);
            opened = true;
          } catch { popup.close(); release(resource); }
        }
        onNotice(opened ? '添付を別タブで開きました。表示されない場合はダウンロードできます。' : '別タブで開けませんでした。ダウンロードして開いてください。', 'ダウンロード', () => download(file));
      } catch {
        popup?.close();
        if (!disposed) onNotice('添付ファイルを取得できません。ファイルの状態とアクセス権を確認してください。');
      } finally { if (popup) pending.delete(popup); }
    },
    dispose() { disposed = true; for (const popup of pending) popup.close(); pending.clear(); for (const resource of resources) release(resource); },
  };
}
