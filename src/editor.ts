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

/** 元PDFには手を加えず、ページの順序と回転だけを保持する。 */
export class Editor {
  pages: EditorPage[] = [];
  selectedId = '';
  private history: Snapshot[] = [];
  private initialSignature = '[]';

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
