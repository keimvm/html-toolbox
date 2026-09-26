// 手動のブラウザ検証で addInitScript する模擬ファイル。配布 HTML には含めない。
(() => {
  const notes = {
    '仕事/週次メモ.md': '# 週次メモ\n\n2026-09-09\n\n## 今週のこと\n\n- ノートの画面構成を整理する\n- 保存まわりの動作を確認する\n\n## 決めたこと\n\nフォルダ構成はそのまま使う。\n\n本文の読みやすさを優先し、操作はひとつの場所にまとめる。\n\n[企画メモを見る](企画メモ.md)\n\n## 次にやること\n\n- [ ] 直接編集とソースの往復を確認する\n- [x] 保存後の表示を確認する\n',
    '仕事/企画メモ.md': '\ufeff# 企画メモ\r\n\r\n| 項目 | 状態 |\r\n| --- | --- |\r\n| 保存 | 確認中 |\r\n\r\n![ローカル画像](../sample.png)\r\n\r\n![外部画像](https://example.com/pixel.png)\r\n\r\n<script>alert("xss")</script>\r\n',
    '個人/企画メモ.md': '# 個人の企画メモ\n',
    'README.MD': '# はじめに\n\n[週次メモ](仕事/週次メモ.md)\n\n> ローカルだけで使えるノートです。\n',
    '.hidden/隠しノート.md': '# 隠しフォルダ内のノート\n',
  };
  const files = new Map();
  const directory = (name, path = '') => ({
    name, path, kind: 'directory', children: new Map(), permission: 'granted',
    async queryPermission() { return this.permission; },
    async isSameEntry(other) { return this === other; },
    async requestPermission() { this.permission = 'granted'; return 'granted'; },
    async *values() { yield* this.children.values(); },
    async getDirectoryHandle(name, options) { if (options?.create && !this.children.has(name)) this.children.set(name, directory(name, this.path ? `${this.path}/${name}` : name)); const child = this.children.get(name); if (!child) throw new DOMException('Not found', 'NotFoundError'); if (child.kind !== 'directory') throw new DOMException('Wrong type', 'TypeMismatchError'); return child; },
    async getFileHandle(name, options) { if (options?.create && !this.children.has(name)) insert(this.path ? `${this.path}/${name}` : name, new Uint8Array()); const child = this.children.get(name); if (!child) throw new DOMException('Not found', 'NotFoundError'); if (child.kind !== 'file') throw new DOMException('Wrong type', 'TypeMismatchError'); return child; },
    async removeEntry(name) { this.children.delete(name); files.delete(this.path ? `${this.path}/${name}` : name); },
  });
  const root = directory('マイノート');
  function insert(path, data) {
    const parts = path.split('/'); let parent = root;
    for (const part of parts.slice(0, -1)) { if (!parent.children.has(part)) parent.children.set(part, directory(part, parent.path ? `${parent.path}/${part}` : part)); parent = parent.children.get(part); }
    const name = parts.at(-1);
    const file = { name, kind: 'file', data,
      async getFile() { return new File([this.data], name); },
      async requestPermission() { return 'granted'; },
      async isSameEntry(other) { return other === this; },
      async createWritable() {
        let pending;
        return { write: async value => { pending = value; }, close: async () => { this.data = pending; }, abort: async () => {} };
      },
    };
    parent.children.set(name, file); files.set(path, file);
  }
  for (const [path, text] of Object.entries(notes)) insert(path, new TextEncoder().encode(text));
  root.children.set('アイデア', directory('アイデア'));
  insert('sample.png', Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yG7sAAAAASUVORK5CYII='), ch => ch.charCodeAt(0)));
  window.noteFixture = { root, files, insert };
  window.showDirectoryPicker = async () => root;
})();
