// Form 子編輯器的共同契約。
//
// timeline / orid 這類「資料圖表」不吃畫布拖拉,由 controller 在偵測到對應關鍵字時
// 惰性建立 form 子編輯器並接管 handle 的子集。各 form 的模型不同(getModel 的回傳型別
// 由各自的 handle 收窄),但生命週期與 host 互動介面必須一致 —— 就是這裡這一組。

import type { ExportRasterOptions } from '../../../types';

export interface FormEditorHandle {
  loadSource(text: string): void;
  toMermaid(): string;
  getModel(): unknown;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  setDark(dark: boolean): void;
  exportSvg(): string;
  exportPng(opts?: ExportRasterOptions): Promise<Blob>;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  destroy(): void;
}
