export interface EditorPage {
  id: string;
  sourceId: string;
  sourceIndex: number;
  rotation: number;
}

interface Snapshot {
  pages: EditorPage[];
  selectedId: string;
}

export interface EditorState extends Snapshot {
  history: Snapshot[];
  initialPages: EditorPage[];
}

function isPages(value: unknown): value is EditorPage[] {
  return (
    Array.isArray(value) &&
    value.every((page: unknown) => {
      if (!page || typeof page !== 'object') return false;
      return (
        'id' in page &&
        typeof page.id === 'string' &&
        /^[\w-]+$/.test(page.id) &&
        'sourceId' in page &&
        typeof page.sourceId === 'string' &&
        'sourceIndex' in page &&
        Number.isInteger(page.sourceIndex) &&
        Number(page.sourceIndex) >= 0 &&
        'rotation' in page &&
        [0, 90, 180, 270].includes(Number(page.rotation)) &&
        typeof page.rotation === 'number'
      );
    }) &&
    new Set(value.map((page: EditorPage) => page.id)).size === value.length
  );
}
function isSnapshot(value: unknown): value is Snapshot {
  return (
    !!value &&
    typeof value === 'object' &&
    'pages' in value &&
    isPages(value.pages) &&
    'selectedId' in value &&
    typeof value.selectedId === 'string' &&
    (value.pages.length
      ? value.pages.some((page) => page.id === value.selectedId)
      : value.selectedId === '')
  );
}
export function isEditorState(value: unknown): value is EditorState {
  return (
    isSnapshot(value) &&
    'history' in value &&
    Array.isArray(value.history) &&
    value.history.length <= 50 &&
    value.history.every(isSnapshot) &&
    'initialPages' in value &&
    isPages(value.initialPages)
  );
}

/** 元PDFには手を加えず、ページの順序と回転だけを保持する。 */
export class Editor {
  pages: EditorPage[] = [];
  selectedId = '';
  private history: Snapshot[] = [];
  private initialSignature = '[]';

  snapshot(): EditorState {
    return structuredClone({
      pages: this.pages,
      selectedId: this.selectedId,
      history: this.history,
      initialPages: JSON.parse(this.initialSignature) as EditorPage[],
    });
  }

  restore(state: unknown) {
    if (!isEditorState(state))
      throw new Error('復元用の編集状態が壊れています。');
    const copy = structuredClone(state);
    this.pages = copy.pages;
    this.selectedId = copy.selectedId;
    this.history = copy.history;
    this.initialSignature = JSON.stringify(copy.initialPages);
  }

  get selected() {
    return this.pages.find((page) => page.id === this.selectedId);
  }

  get selectedIndex() {
    return this.pages.findIndex((page) => page.id === this.selectedId);
  }

  get canUndo() {
    return this.history.length > 0;
  }

  get changed() {
    return JSON.stringify(this.pages) !== this.initialSignature;
  }

  open(pages: EditorPage[]) {
    this.pages = structuredClone(pages);
    this.selectedId = pages[0]?.id ?? '';
    this.history = [];
    this.initialSignature = JSON.stringify(this.pages);
  }

  select(id: string) {
    if (this.pages.some((page) => page.id === id)) this.selectedId = id;
  }

  private remember() {
    this.history.push({
      pages: structuredClone(this.pages),
      selectedId: this.selectedId,
    });
    if (this.history.length > 50) this.history.shift();
  }

  rotate() {
    const page = this.selected;
    if (!page) return false;
    this.remember();
    page.rotation = (page.rotation + 90) % 360;
    return true;
  }

  remove() {
    if (this.pages.length <= 1 || !this.selected) return false;
    const index = this.selectedIndex;
    this.remember();
    this.pages.splice(index, 1);
    this.selectedId = this.pages[Math.min(index, this.pages.length - 1)]!.id;
    return true;
  }

  move(id: string, target: number) {
    const index = this.pages.findIndex((page) => page.id === id);
    if (
      index < 0 ||
      !Number.isInteger(target) ||
      target < 0 ||
      target >= this.pages.length ||
      index === target
    )
      return false;
    this.remember();
    this.pages.splice(target, 0, this.pages.splice(index, 1)[0]!);
    this.selectedId = id;
    return true;
  }

  append(pages: EditorPage[]) {
    if (!pages.length) return false;
    this.remember();
    this.pages.push(...structuredClone(pages));
    this.selectedId = pages[0]!.id;
    return true;
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    this.pages = previous.pages;
    this.selectedId = previous.selectedId;
    return true;
  }
}
