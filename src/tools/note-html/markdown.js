import MarkdownIt from 'markdown-it';
import { resolveReference, getHandle } from './core.js';

export const markdownParser = new MarkdownIt({ html: false, linkify: false, typographer: false });
const tags = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'strong',
  'em',
  's',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);

export function renderMarkdown({
  document,
  container,
  source,
  root,
  path,
  onNote,
  onError,
  onAsset = () => {},
  mode = 'interactive',
}) {
  const exporting = mode === 'export';
  const fragment = document.createDocumentFragment();
  const urls = new Set();
  const imageBlobs = new Map();
  const pending = [];
  const headingIds = new Map();
  let disposed = false;
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function externalLink(node, url) {
    node.href = url;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    node.referrerPolicy = 'no-referrer';
  }
  function anchor(fragmentId) {
    const target = [...container.querySelectorAll('[data-heading]')].find(
      (node) => node.dataset.heading === fragmentId,
    );
    if (target) target.scrollIntoView({ block: 'start' });
    else onError('リンク先の見出しが見つかりません。');
  }
  function renderTokens(tokens, parent) {
    const stack = [parent];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const current = stack.at(-1);
      if (token.nesting === -1) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (token.type === 'inline') {
        renderTokens(token.children || [], current);
        continue;
      }
      if (token.type === 'link_open') {
        const raw = token.attrGet('href') || '';
        const ref = resolveReference(raw, path);
        const localAnchor =
          ref.kind === 'anchor' || (ref.kind === 'note' && ref.path === path && ref.fragment);
        const linked = exporting
          ? ref.kind === 'external' || localAnchor
          : ['external', 'note', 'anchor', 'attachment', 'image'].includes(ref.kind);
        const node = element(linked ? 'a' : 'span');
        if (ref.kind === 'external') externalLink(node, ref.url);
        else if (exporting && localAnchor)
          node.setAttribute('href', `#${encodeURIComponent(`note-export-${ref.fragment}`)}`);
        else if (exporting && ['note', 'attachment', 'image'].includes(ref.kind)) {
          node.dataset.reference = raw;
        } else if (['note', 'anchor', 'attachment', 'image'].includes(ref.kind)) {
          node.href = '#';
          node.addEventListener('click', (event) => {
            event.preventDefault();
            if (ref.kind === 'note') onNote(ref.path, ref.fragment);
            else if (ref.kind === 'anchor') anchor(ref.fragment);
            else onAsset(ref.path);
          });
          node.title = raw;
        } else {
          node.className = 'unavailable-reference';
          node.title = `参照できません: ${raw}`;
          node.append(element('span', `[参照不可: ${raw}] `));
        }
        current.append(node);
        stack.push(node);
        continue;
      }
      if (token.type === 'image') {
        const raw = token.attrGet('src') || '';
        const alt =
          (token.children || []).map((child) => child.content).join('') || token.content || '画像';
        const ref = resolveReference(raw, path);
        const placeholder = element('span');
        placeholder.className = 'image-placeholder';
        current.append(placeholder);
        if (ref.kind === 'external') {
          placeholder.append(document.createTextNode(`${alt} — `));
          const link = element('a', '外部画像を開く');
          externalLink(link, ref.url);
          placeholder.append(link);
        } else if (ref.kind === 'image') {
          placeholder.textContent = `${alt}（画像を読み込み中）`;
          pending.push(
            (async () => {
              try {
                const handle = await getHandle(root, ref.path);
                const file = await handle.getFile();
                const mime = /\.png$/i.test(ref.path)
                  ? 'image/png'
                  : /\.jpe?g$/i.test(ref.path)
                    ? 'image/jpeg'
                    : /\.gif$/i.test(ref.path)
                      ? 'image/gif'
                      : 'image/webp';
                const blob = file.slice(0, file.size, mime);
                if (disposed) return;
                const url = URL.createObjectURL(blob);
                urls.add(url);
                imageBlobs.set(url, blob);
                const img = element('img');
                img.alt = alt;
                img.src = url;
                img.addEventListener('error', () => {
                  if (disposed || !img.parentNode) return;
                  img.replaceWith(element('span', `${alt}（画像を表示できません: ${raw}）`));
                  if (exporting)
                    onError('一部の画像を出力できませんでした。本文中の案内を確認してください。');
                });
                placeholder.replaceWith(img);
              } catch {
                if (!disposed) {
                  placeholder.textContent = `${alt}（画像を取得できません: ${raw}）`;
                  if (exporting)
                    onError('一部の画像を出力できませんでした。本文中の案内を確認してください。');
                }
              }
            })(),
          );
        } else placeholder.textContent = `${alt}（参照できません: ${raw}）`;
        continue;
      }
      if (token.nesting === 1) {
        const node = element(tags.has(token.tag) ? token.tag : 'span');
        if (token.hidden) node.classList.add('tight-paragraph');
        if (token.tag === 'ol' && token.attrGet('start'))
          node.start = Number(token.attrGet('start'));
        if (token.tag === 'td' || token.tag === 'th') {
          const align = token.attrGet('style')?.match(/^text-align:(left|right|center)$/)?.[1];
          if (align) node.style.textAlign = align;
        }
        if (token.type === 'heading_open') {
          const heading = (tokens[index + 1]?.content || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}_\s-]/gu, '')
            .trim()
            .replace(/\s/g, '-');
          const count = headingIds.get(heading) || 0;
          headingIds.set(heading, count + 1);
          node.dataset.heading = count ? `${heading}-${count}` : heading;
          if (exporting) node.id = `note-export-${node.dataset.heading}`;
        }
        current.append(node);
        stack.push(node);
        continue;
      }
      if (token.type === 'fence' || token.type === 'code_block') {
        const pre = element('pre');
        pre.append(element('code', token.content));
        current.append(pre);
      } else if (token.type === 'code_inline') current.append(element('code', token.content));
      else if (token.type === 'hr') current.append(element('hr'));
      else if (token.type === 'hardbreak') current.append(element('br'));
      else if (token.type === 'softbreak') current.append(document.createTextNode('\n'));
      else current.append(document.createTextNode(token.content));
    }
  }
  const frontMatter = source.match(/^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?:\r?\n|$)/);
  if (frontMatter) {
    const pre = element('pre');
    pre.className = 'raw-block';
    pre.append(element('code', frontMatter[0]));
    fragment.append(pre);
  }
  renderTokens(
    markdownParser.parse(frontMatter ? source.slice(frontMatter[0].length) : source, {}),
    fragment,
  );
  for (const reference of fragment.querySelectorAll('[data-reference]')) {
    reference.append(document.createTextNode(`（${reference.dataset.reference}）`));
    delete reference.dataset.reference;
  }
  for (const li of fragment.querySelectorAll('li')) {
    const paragraph = li.firstElementChild;
    const first = paragraph?.tagName === 'P' ? paragraph.firstChild : li.firstChild;
    if (first?.nodeType !== 3) continue;
    const task = first.textContent.match(/^\[([ xX])\](?:\s|$)/);
    if (!task) continue;
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.disabled = true;
    checkbox.checked = task[1] !== ' ';
    if (checkbox.checked) checkbox.setAttribute('checked', '');
    checkbox.setAttribute('aria-label', checkbox.checked ? '完了' : '未完了');
    li.classList.add('task-item');
    li.dataset.checked = String(checkbox.checked);
    first.textContent = first.textContent.slice(task[0].length);
    first.before(checkbox, document.createTextNode(' '));
  }
  container.replaceChildren(fragment);
  if (!source.trim()) container.append(element('p', 'このノートは空です。'));
  return {
    ready: Promise.all(pending),
    imageBlobs,
    anchor,
    dispose() {
      disposed = true;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      imageBlobs.clear();
    },
  };
}
