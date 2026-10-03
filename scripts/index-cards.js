// 入口ページのカードの並び順と表示・非表示を、使う人が変えられるようにする。scripts/toolbox.mjs が入口ページに埋め込む。
// 選んだ内容は localStorage に残す。file:// の入口ページは版をまたいで保存領域を共有するため、新しい版でも引き継ぐ。

export const CARDS_KEY = 'toolbox-cards';

/**
 * 保存した内容を今の一覧（dirs は tools.json の順）に当てはめる。
 * 一覧にないツールは無視し、並べ替えた後に増えたツールは最後に表示する。
 */
export function arrangeCards(dirs, saved) {
  const order = [...new Set(Array.isArray(saved?.order) ? saved.order : [])].filter((dir) =>
    dirs.includes(dir),
  );
  order.push(...dirs.filter((dir) => !order.includes(dir)));
  const hidden = new Set(Array.isArray(saved?.hidden) ? saved.hidden : []);
  return { order, hidden: new Set(dirs.filter((dir) => hidden.has(dir))) };
}

/** 保存する内容。tools.json と同じ並び・全部表示なら null（記録を消し、以後の一覧の変更に従う）。 */
export function savedCards(dirs, order, hidden) {
  const saved = {};
  if (order.some((dir, i) => dir !== dirs[i])) saved.order = order;
  if (hidden.size) saved.hidden = dirs.filter((dir) => hidden.has(dir));
  return Object.keys(saved).length ? saved : null;
}

/**
 * list は li[data-dir] を tools.json の順に並べた ul。各 li はカードのリンク（.card）と、
 * 表示のチェックボックス・移動ボタン（button[data-move="-1" | "1"]）を持つ。
 */
export function setupCards(
  { list, edit, reset, hint, empty },
  { window: win = globalThis.window } = {},
) {
  const items = new Map([...list.children].map((li) => [li.dataset.dir, li]));
  const dirs = [...items.keys()];
  // 保存できない環境でも、開いている画面の中では変えられるようにする。
  let unsaved = null;
  let editing = false;
  let dragged = null;

  function load() {
    try {
      const text = win.localStorage.getItem(CARDS_KEY);
      return arrangeCards(dirs, text === null ? null : JSON.parse(text));
    } catch {
      return arrangeCards(dirs, unsaved);
    }
  }
  function save(order, hidden) {
    unsaved = savedCards(dirs, order, hidden);
    try {
      if (unsaved) win.localStorage.setItem(CARDS_KEY, JSON.stringify(unsaved));
      else win.localStorage.removeItem(CARDS_KEY);
    } catch {
      // 保存できなくても、この画面の表示は変える。
    }
    render();
  }
  function render() {
    const { order, hidden } = load();
    // 並びが変わらないときは動かさない（フォーカスを保つ）。
    if (order.some((dir, i) => list.children[i] !== items.get(dir))) {
      list.append(...order.map((dir) => items.get(dir)));
    }
    for (const [i, dir] of order.entries()) {
      const li = items.get(dir);
      li.toggleAttribute('data-hidden', hidden.has(dir));
      li.hidden = hidden.has(dir) && !editing;
      li.draggable = editing;
      // 編集中はカードを開かず、ドラッグを li で受ける。
      li.querySelector('.card').inert = editing;
      li.querySelector('input[type="checkbox"]').checked = !hidden.has(dir);
      li.querySelector('[data-move="-1"]').disabled = i === 0;
      li.querySelector('[data-move="1"]').disabled = i === order.length - 1;
    }
    list.toggleAttribute('data-editing', editing);
    edit.textContent = editing ? '完了' : '並べ替え・表示';
    reset.hidden = !editing;
    reset.disabled = !savedCards(dirs, order, hidden);
    hint.hidden = !editing;
    empty.hidden = editing || hidden.size < dirs.length;
  }

  edit.addEventListener('click', () => {
    editing = !editing;
    render();
  });
  reset.addEventListener('click', () => {
    save(dirs, new Set());
    // 押したボタンが無効になるため、編集の切り替えへ移す。
    edit.focus();
  });
  list.addEventListener('change', (event) => {
    const { order, hidden } = load();
    const { dir } = event.target.closest('li').dataset;
    if (event.target.checked) hidden.delete(dir);
    else hidden.add(dir);
    save(order, hidden);
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-move]');
    if (!button) return;
    const { order, hidden } = load();
    const { dir } = button.closest('li').dataset;
    const from = order.indexOf(dir);
    const to = from + Number(button.dataset.move);
    [order[from], order[to]] = [order[to], order[from]];
    save(order, hidden);
    // 移動でフォーカスが外れるため戻す。端に着いて押せなくなったら反対のボタンへ移す。
    const other = button.closest('li').querySelector(`[data-move="${-button.dataset.move}"]`);
    (button.disabled ? other : button).focus();
  });

  // マウスでは標準のドラッグ＆ドロップで並べ替える。重なったカードと入れ替えながら動かし、離したときに保存する。
  list.addEventListener('dragstart', (event) => {
    dragged = event.target.closest('li');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragged.dataset.dir);
    dragged.toggleAttribute('data-dragging', true);
  });
  list.addEventListener('dragover', (event) => {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const over = event.target.closest?.('li');
    if (!over || over === dragged || over.parentNode !== list) return;
    const children = [...list.children];
    if (children.indexOf(dragged) < children.indexOf(over)) over.after(dragged);
    else over.before(dragged);
  });
  list.addEventListener('drop', (event) => {
    if (dragged) event.preventDefault();
  });
  list.addEventListener('dragend', (event) => {
    if (!dragged) return;
    dragged.removeAttribute('data-dragging');
    dragged = null;
    const { hidden } = load();
    // Escape などで取りやめたら、保存済みの並びに戻す。
    if (event.dataTransfer.dropEffect === 'none') render();
    else save([...list.children].map((li) => li.dataset.dir), hidden);
  });

  // 別のタブで開いている入口ページで変えた内容に合わせる。
  win.addEventListener('storage', (event) => {
    if (event.key === CARDS_KEY || event.key === null) render();
  });
  render();
}
