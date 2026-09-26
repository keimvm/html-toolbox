import { Schema } from 'prosemirror-model';
import { schema as baseSchema, MarkdownParser, MarkdownSerializer, MarkdownSerializerState, defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { tableNodes } from 'prosemirror-tables';
import { markdownParser } from './markdown.js';

const tables = tableNodes({ tableGroup: 'block', cellContent: 'paragraph', cellAttributes: {
  align: { default: null, getFromDOM: dom => ['left', 'center', 'right'].includes(dom.style.textAlign) ? dom.style.textAlign : null,
    setDOMAttr: (value, attrs) => { if (value) attrs.style = `text-align: ${value}`; } },
} });
let nodes = baseSchema.spec.nodes
  .update('list_item', {
    ...baseSchema.spec.nodes.get('list_item'), content: 'paragraph block*', attrs: { checked: { default: null } },
    parseDOM: [{ tag: 'li', getAttrs: dom => ({ checked: dom.hasAttribute('data-checked') ? dom.dataset.checked === 'true' : null }) }],
    toDOM: node => ['li', node.attrs.checked === null ? {} : { 'data-checked': String(node.attrs.checked), class: 'task-item' }, 0],
  })
  .update('image', {
    ...baseSchema.spec.nodes.get('image'),
    // 文書モデルには原参照だけを保存し、画像の実取得は NodeView に限定する。
    parseDOM: [{ tag: 'span[data-md-image]', getAttrs: dom => ({ src: dom.dataset.mdImage, alt: dom.dataset.alt || '', title: dom.dataset.title || null }) },
      { tag: 'img[src]', getAttrs: dom => ({ src: dom.getAttribute('src'), alt: dom.getAttribute('alt'), title: dom.getAttribute('title') }) }],
    toDOM: node => ['span', { 'data-md-image': node.attrs.src, 'data-alt': node.attrs.alt || '', 'data-title': node.attrs.title || '', class: 'image-placeholder' }, node.attrs.alt || '画像'],
  })
  .append({ soft_break: { inline: true, group: 'inline', selectable: false, toDOM: () => ['span', { 'data-soft-break': '', class: 'soft-break' }, '\n'], parseDOM: [{ tag: 'span[data-soft-break]' }] },
    raw_block: { group: 'block', atom: true, attrs: { source: {} }, toDOM: node => ['pre', { class: 'raw-block', 'data-raw-source': node.attrs.source }, ['code', node.attrs.source]],
      parseDOM: [{ tag: 'pre[data-raw-source]', getAttrs: dom => ({ source: dom.dataset.rawSource }) }] },
  }).append(tables);
const marks = baseSchema.spec.marks.update('link', {
  ...baseSchema.spec.marks.get('link'),
  parseDOM: [{ tag: 'span[data-md-link]', getAttrs: dom => ({ href: dom.dataset.mdLink, title: dom.dataset.title || null }) },
    ...baseSchema.spec.marks.get('link').parseDOM],
  // リンクの起動も参照先の判定後に行う。危険な href を DOM に置かない。
  toDOM: mark => ['span', { 'data-md-link': mark.attrs.href, 'data-title': mark.attrs.title || '', class: 'editor-link', role: 'link', tabindex: '0', title: `${mark.attrs.href}（⌘ / Ctrl＋クリックで開く）` }, 0],
}).addBefore('code', 'strike', { parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: () => ['s', 0] });
export const editorSchema = new Schema({ nodes, marks });

const tokenizer = { parse(source, env) {
  const tokens = markdownParser.parse(source, env);
  const result = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'list_item_open' && tokens[i + 1]?.type === 'paragraph_open') {
      const inline = tokens[i + 2];
      const first = inline?.children?.[0];
      const task = first?.type === 'text' && /^\[([ xX])\]\s/.test(inline.content) && first.content.match(/^\[([ xX])\]\s/);
      if (task) { token.meta = { checked: task[1] !== ' ' }; first.content = first.content.slice(task[0].length); }
    }
    if (token.type === 'th_close' || token.type === 'td_close') result.push({ type: 'paragraph_close' });
    result.push(token);
    if (token.type === 'th_open' || token.type === 'td_open') result.push({ type: 'paragraph_open' });
  }
  return result;
} };
const cellAttrs = token => ({ align: token.attrGet('style')?.match(/^text-align:(left|center|right)$/)?.[1] || null });
const parser = new MarkdownParser(editorSchema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  list_item: { block: 'list_item', getAttrs: token => ({ checked: token.meta?.checked ?? null }) },
  image: { node: 'image', getAttrs: token => ({ src: token.attrGet('src'), alt: (token.children || []).map(child => child.content).join(''), title: token.attrGet('title') || null }) },
  softbreak: { node: 'soft_break' }, s: { mark: 'strike' },
  table: { block: 'table' }, thead: { ignore: true }, tbody: { ignore: true }, tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: cellAttrs }, td: { block: 'table_cell', getAttrs: cellAttrs },
});

export function parseMarkdown(source) {
  // 他のツールのメタデータを見出し・区切り線として書き換えない。
  const frontMatter = source.match(/^(---|\+\+\+)\n[\s\S]*?\n\1(?:\n|$)/);
  if (frontMatter) {
    const rest = parser.parse(source.slice(frontMatter[0].length));
    const content = [editorSchema.nodes.raw_block.create({ source: frontMatter[0] })];
    rest.forEach(node => content.push(node));
    return editorSchema.topNodeType.create(null, content);
  }
  const doc = parser.parse(source);
  doc.check();
  return doc;
}

const serializer = new MarkdownSerializer({
  ...defaultMarkdownSerializer.nodes,
  bullet_list(state, node) { state.renderList(node, '  ', () => '- '); },
  list_item(state, node) {
    if (node.attrs.checked !== null) state.write(node.attrs.checked ? '[x] ' : '[ ] ');
    state.renderContent(node);
  },
  soft_break(state) { state.write('\n'); },
  raw_block(state, node) { state.write(node.attrs.source.replace(/\n$/, '')); state.closeBlock(node); },
  table(state, node) {
    node.forEach((row, _offset, index) => {
      const cells = [];
      row.forEach(cell => {
        // GFM のセルは一段落。縦棒はコード・URL の中も含めてエスケープする。
        const inner = new MarkdownSerializerState(serializer.nodes, serializer.marks, { escapeExtraCharacters: /[<&)]/g });
        inner.renderInline(cell.firstChild);
        cells.push(inner.out.replaceAll('|', '\\|'));
      });
      state.write(`| ${cells.join(' | ')} |\n`);
      if (index === 0) {
        const separators = [];
        row.forEach(cell => separators.push(({ left: ':---', center: ':---:', right: '---:' })[cell.attrs.align] || '---'));
        state.write(`| ${separators.join(' | ')} |\n`);
      }
    });
    state.closeBlock(node);
  },
}, { ...defaultMarkdownSerializer.marks, strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true } }, {
  // 入力された文字列が、保存後に実体参照・自動リンク・リスト・表へ変化するのを防ぐ。
  escapeExtraCharacters: /[<&)|]/g,
});

export function serializeMarkdown(doc) {
  return serializer.serialize(doc);
}
