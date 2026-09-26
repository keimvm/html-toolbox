import type { PdfDocumentObject, ImageDataLike } from '@embedpdf/models';
import type { EditorPage } from '../editor';

export interface PageElement {
  index: number;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  image?: {
    width: number;
    height: number;
    widthMm: number;
    heightMm: number;
    dpiX: number;
    dpiY: number;
  };
}
export interface Inspection {
  text: string;
  elements: PageElement[];
}
export interface Operations {
  open: {
    args: { id: string; content: ArrayBuffer };
    result: PdfDocumentObject;
  };
  close: { args: { id: string }; result: boolean };
  render: {
    args: {
      page: EditorPage;
      scale: number;
      type?: 'image/png' | 'image/jpeg';
    };
    result: Blob;
  };
  inspect: { args: { page: EditorPage }; result: Inspection };
  image: { args: { page: EditorPage; index: number }; result: Blob };
  export: { args: { pages: EditorPage[] }; result: ArrayBuffer };
}
export type Request = {
  [K in keyof Operations]: {
    id: number;
    method: K;
    args: Operations[K]['args'];
  };
}[keyof Operations];
export type RawImage = ImageDataLike;
