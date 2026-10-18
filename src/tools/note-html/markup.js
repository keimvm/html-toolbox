// ローカルノートの画面の骨組み。旧 index.html の本文を、toolbox 共通のヘッダー（ToolFrame）の中に置く形に分けた。
// 中身の書き換えは app.js などが id で行うため、Preact には一度だけ描かせ、以後は描き直させない（index.tsx の Static）。
// テストも同じ骨組みで jsdom の文書を作る（helpers.test-support.js）。

/** 画面で使うアイコン（<use href="#icon-…">）。 */
export const ICONS = `<svg class="icon-library" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>
  <symbol id="icon-folder" viewBox="0 0 24 24"><path d="M3.5 6.5a1 1 0 0 1 1-1h4.6l2 2.2h8.4a1 1 0 0 1 1 1v9.8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z"/></symbol>
  <symbol id="icon-note" viewBox="0 0 24 24"><path d="M14 3H6.5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V7.5Z"/><path d="M14 3v4.5h4.5M8.5 12.5h7m-7 3.5h7"/></symbol>
  <symbol id="icon-refresh" viewBox="0 0 24 24"><path d="M20 4.5v5h-5M4 19.5v-5h5"/><path d="M19.4 9.5A8 8 0 0 0 5 8.2M4.6 14.5a8 8 0 0 0 14.4 1.3"/></symbol>
  <symbol id="icon-chevron" viewBox="0 0 24 24"><path d="m9.5 6 6 6-6 6"/></symbol>
  <symbol id="icon-sidebar" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.5 4.5v15"/></symbol>
</defs></svg>`;

/** ヘッダーの左上の一角の右隣：フォルダの操作と、開いているノートの名前。 */
export const HEADER_CENTER = `<div class="folder-actions">
  <button class="tb-button tb-icon-button" id="open-folder" aria-label="フォルダを開く" title="フォルダを開く"><svg class="icon" aria-hidden="true"><use href="#icon-folder"/></svg></button>
  <button class="tb-button tb-icon-button" id="reload" disabled aria-label="再読み込み" title="ツリーと本文を再読み込み"><svg class="icon" aria-hidden="true"><use href="#icon-refresh"/></svg></button>
</div>
<div class="note-heading">
  <button class="tb-button" id="sidebar-toggle" aria-label="ファイルナビゲーションを閉じる" aria-expanded="true" aria-controls="sidebar" title="ファイルナビゲーションを閉じる"><svg class="icon" aria-hidden="true"><use href="#icon-sidebar"/></svg></button>
  <div class="note-location"><h2 id="file-name" hidden></h2></div>
</div>`;

/** ヘッダーの右側：書式・その他の操作・保存。 */
export const HEADER_END = `<div class="note-actions">
  <button id="format-toggle" class="tb-button toolbar-button" popovertarget="format-panel" style="anchor-name: --nh-format" disabled>書式<svg class="icon menu-chevron" aria-hidden="true"><use href="#icon-chevron"/></svg></button>
  <div id="format-panel" class="tb-popover toolbar-panel" role="group" aria-label="書式と挿入" popover="auto" style="position-anchor: --nh-format">
    <div id="format-toolbar" class="format-toolbar" role="group" aria-label="本文の書式" hidden></div>
  </div>
  <button id="return-to-note" class="tb-button toolbar-button" aria-label="本文に戻る" title="本文に戻る" hidden><span>本文<span class="return-label">に戻る</span></span></button>
  <button id="options-toggle" class="tb-button toolbar-button" aria-label="その他の操作" title="その他の操作" popovertarget="options-panel" style="anchor-name: --nh-options"><span aria-hidden="true">⋯</span></button>
  <div id="options-panel" class="tb-popover toolbar-panel options-panel" role="group" aria-label="その他の操作" popover="auto" style="position-anchor: --nh-options">
    <button id="settings-open" class="tb-button source-button">設定</button>
    <button id="source-mode" class="tb-button source-button" aria-pressed="false" disabled>Markdownソース</button>
    <button id="export" class="tb-button source-button" disabled>エクスポート</button>
    <p id="file-path" class="menu-path">Markdown を、いつものフォルダで。</p>
  </div>
  <span id="save-status" role="status" aria-live="polite"></span>
  <button id="save" class="tb-button tb-primary" disabled title="保存（⌘S / Ctrl+S）">保存</button>
</div>`;

/** 左のフォルダの一覧と、右の本文。 */
export const BODY = `<div class="workspace">
  <aside class="sidebar" id="sidebar" aria-label="ノートフォルダ">
    <nav id="tree" aria-label="フォルダと Markdown ファイル"><p class="tree-empty">フォルダを開くと、ここに<br>ノートが並びます。</p></nav>
  </aside>
  <div id="sidebar-resizer" role="separator" aria-label="ファイルナビゲーションの幅" aria-orientation="vertical" aria-controls="sidebar" tabindex="0"></div>
  <main class="paper" id="main">
    <div id="notice" class="notice" role="alert" hidden><p id="notice-text"></p><button class="tb-button tb-secondary" id="notice-action" hidden></button><button id="notice-close" class="tb-button text-button" aria-label="通知を閉じる">閉じる</button></div>
    <p id="format-warning" class="format-warning" hidden></p>
    <div id="welcome" class="welcome">
      <div class="welcome-mark"><svg class="icon"><use href="#icon-note"/></svg></div>
      <h2 id="welcome-title">いつものフォルダが、<br>ノートになる。</h2>
      <p id="welcome-text">Markdown を読み、書き、そのまま保存。<br>ノートの置き場所は変わりません。</p>
      <button id="welcome-open" class="tb-button tb-primary"><svg class="icon"><use href="#icon-folder"/></svg><span>フォルダを開く</span></button>
      <p class="welcome-drop">ホームやこの画面にフォルダを置いても開けます。</p>
    </div>
    <div id="rich-editor" hidden></div>
    <article id="preview" class="markdown" aria-label="Markdown プレビュー" tabindex="0" hidden></article>
    <textarea id="editor" aria-label="Markdownソース" spellcheck="false" autocomplete="off" autocapitalize="off" hidden></textarea>
  </main>
</div>`;

/** 確認・設定・ツリーの操作のダイアログ。 */
export const DIALOGS = `<dialog id="confirm-dialog" class="tb-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-text">
  <h2 id="confirm-title"></h2><p id="confirm-text"></p>
  <label id="entry-name-label" hidden>名前<input id="entry-name" class="tb-input" type="text" autocomplete="off" spellcheck="false" aria-describedby="entry-error"></label>
  <p id="entry-error" role="alert" hidden></p><div id="confirm-actions" class="tb-dialog-actions tb-stack"></div>
</dialog>
<dialog id="settings-dialog" class="tb-dialog" aria-labelledby="settings-title">
  <h2 id="settings-title">設定</h2>
  <label for="ui-font">UIフォント</label>
  <input id="ui-font" class="tb-input" list="ui-fonts" placeholder="標準" maxlength="100" aria-describedby="ui-font-hint" autocomplete="off">
  <datalist id="ui-fonts"><option value="Hiragino Sans"><option value="Yu Gothic"><option value="Meiryo"><option value="Noto Sans JP"><option value="Helvetica Neue"></datalist>
  <p id="ui-font-hint">端末にあるフォント名を指定します。空欄で標準に戻ります。</p>
  <label class="font-size-label">UIフォントサイズ<select id="ui-font-size" class="tb-input"><option value="90">90%</option><option value="100" selected>100%</option><option value="110">110%</option><option value="120">120%</option><option value="130">130%</option></select></label>
  <label class="font-size-label">本文フォントサイズ<select id="font-size" class="tb-input"><option value="14">14 px</option><option value="16" selected>16 px</option><option value="18">18 px</option><option value="20">20 px</option><option value="24">24 px</option></select></label>
  <div class="tb-dialog-actions tb-stack"><button id="settings-close" class="tb-button tb-primary">閉じる</button></div>
</dialog>
<dialog id="entry-menu" class="tb-dialog" aria-labelledby="entry-menu-title">
  <h2 id="entry-menu-title"></h2>
  <div class="entry-menu-actions">
    <button class="tb-button" data-entry-action="create-file">ファイルを追加</button><button class="tb-button" data-entry-action="create-directory">フォルダを追加</button>
    <button class="tb-button" data-entry-action="rename">名前を変更</button><button data-entry-action="delete" class="tb-button tb-danger">削除</button>
  </div>
  <div class="tb-dialog-actions tb-stack"><button class="tb-button tb-secondary" id="entry-menu-close">閉じる</button></div>
</dialog>`;
