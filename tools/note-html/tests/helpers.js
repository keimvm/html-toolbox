import { afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { installPopover } from './popover.js';
import { createApp } from '../src/app.js';

const cleanup = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });

export function installDOMGlobals(window) {
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'MutationObserver', 'navigator']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true });
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.ClipboardEvent = window.ClipboardEvent || window.Event;
  globalThis.innerHeight = 1000; globalThis.innerWidth = 1440;
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  window.URL.createObjectURL = URL.createObjectURL; window.URL.revokeObjectURL = URL.revokeObjectURL;
}

export const bytes = text => new TextEncoder().encode(text);
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
export const failure = name => new DOMException(name, name);
export class MemoryFile {
  kind = 'file';
  reads = 0;
  writes = 0;
  closes = 0;
  aborted = 0;
  permission = 'granted';
  constructor(name, content = '') { this.name = name; this.bytes = typeof content === 'string' ? bytes(content) : content; }
  async getFile() {
    this.reads++;
    if (this.readGate) await this.readGate;
    if (this.readError) throw failure(this.readError);
    return new File([this.bytes], this.name);
  }
  async requestPermission() { return this.permission; }
  async isSameEntry(other) { return this === other; }
  async createWritable() {
    if (this.createError) throw failure(this.createError);
    let pending;
    return {
      write: async data => { this.writes++; if (this.writeGate) await this.writeGate; if (this.writeError) throw failure(this.writeError); pending = typeof data.arrayBuffer === 'function' ? new Uint8Array(await data.arrayBuffer()) : data.slice(); },
      close: async () => { this.closes++; if (this.closeError) throw failure(this.closeError); this.bytes = pending; if (this.afterClose) this.afterClose(); },
      abort: async () => { this.aborted++; },
    };
  }
}
export class MemoryDirectory {
  kind = 'directory';
  enumerations = 0;
  permission = 'granted';
  permissionRequests = [];
  constructor(name, children = []) { this.name = name; this.children = new Map(children.map(child => [child.name, child])); }
  async queryPermission() { return this.permission; }
  async isSameEntry(other) { return this === other; }
  async requestPermission(options) { this.permissionRequests.push(options); return this.permission; }
  async *values() { this.enumerations++; if (this.enumerationGate) await this.enumerationGate; if (this.error) throw failure(this.error); yield* this.children.values(); }
  async getDirectoryHandle(name, options) {
    if (options?.create && this.createDirectoryError) throw failure(this.createDirectoryError);
    if (!this.children.has(name) && options?.create) this.children.set(name, new MemoryDirectory(name));
    const entry = this.children.get(name); if (!entry) throw failure('NotFoundError'); if (entry.kind !== 'directory') throw failure('TypeMismatchError'); return entry;
  }
  async getFileHandle(name, options) {
    if (options?.create && this.createFileError) throw failure(this.createFileError);
    if (!this.children.has(name) && options?.create) { const file = new MemoryFile(name); this.onCreateFile?.(file); this.children.set(name, file); }
    const entry = this.children.get(name); if (!entry) throw failure('NotFoundError'); if (entry.kind !== 'file') throw failure('TypeMismatchError'); return entry;
  }
  async removeEntry(name, options) { if (this.removeError) throw failure(this.removeError); const child = this.children.get(name); if (child?.kind === 'directory' && child.children.size && !options?.recursive) throw failure('InvalidModificationError'); if (!this.children.delete(name)) throw failure('NotFoundError'); }
}
export class MemorySessionStore {
  saves = [];
  constructor(record) { this.record = record; }
  async load() { if (this.loadGate) await this.loadGate; if (this.loadError) throw failure(this.loadError); return this.record; }
  async save(record) {
    if (this.saveGate) await this.saveGate;
    if (this.saveError) throw failure(this.saveError);
    this.record = { ...record, expandedPaths: [...record.expandedPaths] }; this.saves.push(this.record);
  }
}
export class MemoryLayoutStore {
  saves = [];
  constructor(record) { this.record = record; }
  async load() { if (this.loadGate) await this.loadGate; if (this.loadError) throw failure(this.loadError); return this.record; }
  async save(record) {
    if (this.saveGate) await this.saveGate;
    if (this.saveError) throw failure(this.saveError);
    this.record = { ...record }; this.saves.push(this.record);
  }
}

// jsdom にはレイアウトエンジンがないため、CSS の測定結果とポインターキャプチャを模擬する。
export function layoutViewport(window, width) {
  window.innerWidth = width;
  const workspace = window.document.querySelector('.workspace');
  workspace.getBoundingClientRect = () => ({ width: Math.min(width, 1800) });
  workspace.style.padding = `${width <= 680 ? 12 : width <= 1050 ? 18 : width >= 1500 ? 30 : 26}px`;
  workspace.style.setProperty('--splitter-width', `${width <= 1050 ? 18 : width >= 1500 ? 32 : 28}px`);
  workspace.style.setProperty('--sidebar-default-width', `${width <= 1050 ? 250 : width >= 1500 ? 320 : 292}px`);
  window.dispatchEvent(new window.Event('resize'));
}

export async function setup(root, { supported = true, sessionStore = new MemorySessionStore(), layoutStore = new MemoryLayoutStore(), displayStore = new MemoryLayoutStore(), viewport = 1440, autoOpen = true, waitReady = true } = {}) {
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'file:///index.html' });
  const { window } = dom;
  const popovers = installPopover(window);
  window.document.getElementById('document-styles').textContent = await readFile(new URL('../src/document.css', import.meta.url), 'utf8');
  window.isSecureContext = true;
  window.FileSystemFileHandle = MemoryFile;
  window.FileSystemHandle = MemoryFile;
  if (supported) window.showDirectoryPicker = async () => root;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  installDOMGlobals(window);
  layoutViewport(window, viewport);
  const resizer = window.document.getElementById('sidebar-resizer');
  let capture;
  resizer.setPointerCapture = id => { capture = id; };
  resizer.hasPointerCapture = id => id === capture;
  resizer.releasePointerCapture = () => { capture = undefined; };
  const app = createApp(window, { sessionStore, layoutStore, displayStore });
  cleanup.push(() => { app.dispose(); window.close(); });
  const $ = id => window.document.getElementById(id);
  const edit = text => { if (app.state.mode !== 'source') $('source-mode').click(); $('editor').value = text; $('editor').dispatchEvent(new window.Event('input')); };
  const choose = value => window.document.querySelector(`[data-choice="${value}"]`).click();
  if (waitReady) await app.ready;
  if (supported && autoOpen) await app.openFolder();
  return { dom, window, app, $, edit, choose, sessionStore, layoutStore, displayStore, popovers };
}
