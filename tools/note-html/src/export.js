import { renderMarkdown } from './markdown.js';
import { FONT_SIZES } from './display.js';

function waitFor(promise, signal, milliseconds = 30000) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error, value) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new Error('ExportAborted'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('ExportTimeout')), milliseconds);
    Promise.resolve(promise).then(value => finish(null, value), finish);
  });
}

async function dataUrl(window, blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 16384) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
  return `data:${blob.type};base64,${window.btoa(chunks.join(''))}`;
}

export function createExporter(window, { onError }) {
  const document = window.document;
  const downloads = new Map();
  let operation;
  let disposed = false;

  async function run({ format, source, root, path, fontSize }) {
    if (disposed || operation || !['html', 'pdf'].includes(format)) return false;
    const controller = new window.AbortController(); operation = controller;
    const signal = controller.signal;
    const article = document.createElement('article');
    article.className = 'markdown export-document';
    article.style.setProperty('--note-font-size', `${FONT_SIZES.includes(fontSize) ? fontSize : 16}px`);
    const title = path.split('/').at(-1).replace(/\.md$/i, '');
    let renderer;
    let previousTitle;
    let afterPrint;
    try {
      renderer = renderMarkdown({ document, container: article, source, root, path, mode: 'export', onError });
      await waitFor(renderer.ready, signal);
      await waitFor(Promise.all([...article.querySelectorAll('img')].map(async img => {
        try { if (img.decode) await waitFor(img.decode(), signal, 15000); }
        catch {
          if (signal.aborted || !img.parentNode) return;
          const message = document.createElement('span'); message.textContent = `${img.alt}（画像を表示できません）`; img.replaceWith(message);
          onError('一部の画像を出力できませんでした。本文中の案内を確認してください。');
        }
      })), signal);
      if (format === 'html') {
        const output = document.implementation.createHTMLDocument(title);
        output.documentElement.lang = 'ja';
        const charset = output.createElement('meta'); charset.setAttribute('charset', 'UTF-8'); output.head.prepend(charset);
        const viewport = output.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1'; output.head.append(viewport);
        const policy = output.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
        policy.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
        output.head.append(policy);
        const style = output.createElement('style'); style.textContent = document.getElementById('document-styles').textContent; output.head.append(style);
        output.body.append(output.importNode(article, true));
        // 閲覧中のDOMへdata URLを設定するとアプリのCSPに拒否されるため、非アクティブな出力文書で置換する。
        for (const img of output.querySelectorAll('img')) img.src = await waitFor(dataUrl(window, renderer.imageBlobs.get(img.src)), signal);
        const blob = new window.Blob(['<!DOCTYPE html>\n', output.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        // ダウンロード開始直後には解放せず、Chromeが取得する時間を確保する。
        const timer = window.setTimeout(() => { window.URL.revokeObjectURL(url); downloads.delete(url); }, 60000);
        downloads.set(url, timer);
        const link = document.createElement('a'); link.href = url; link.download = `${title}.html`; link.hidden = true;
        document.body.append(link);
        try { link.click(); }
        catch (error) { window.clearTimeout(timer); downloads.delete(url); window.URL.revokeObjectURL(url); throw error; }
        finally { link.remove(); }
      } else {
        article.id = 'print-document'; document.body.append(article);
        previousTitle = document.title; document.title = title;
        document.body.classList.add('note-printing');
        // Chromeの印刷画面はprint()が戻るまで開く。afterprintとfinallyの両方で後始末する。
        afterPrint = () => { article.remove(); document.body.classList.remove('note-printing'); };
        window.addEventListener('afterprint', afterPrint, { once: true });
        window.print();
      }
      return true;
    } catch {
      if (!disposed && !signal.aborted) onError('エクスポートできませんでした。もう一度お試しください。');
      return false;
    } finally {
      if (afterPrint) window.removeEventListener('afterprint', afterPrint);
      article.remove(); document.body.classList.remove('note-printing');
      if (previousTitle !== undefined) document.title = previousTitle;
      renderer?.dispose(); operation = null;
    }
  }
  return { run, dispose() {
    disposed = true; operation?.abort();
    for (const [url, timer] of downloads) { window.clearTimeout(timer); window.URL.revokeObjectURL(url); }
    downloads.clear();
  } };
}
