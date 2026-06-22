// 圖種 adapter 註冊表 + 型別偵測。
// 偵測邏輯刻意對齊 VS Code 擴充的 mermaidExtract.ts#diagramType(去 frontmatter/%% 後取首 token),
// 讓 core 與擴充對「這是哪種圖」判定一致。

import type { DiagramType } from '../scene/types';
import type { DiagramAdapter } from './types';

const registry = new Map<DiagramType, DiagramAdapter>();

export function registerAdapter(adapter: DiagramAdapter): void {
  registry.set(adapter.capabilities.type, adapter);
}

export function getAdapter(type: DiagramType): DiagramAdapter | undefined {
  return registry.get(type);
}

export function listAdapters(): DiagramAdapter[] {
  return [...registry.values()];
}

/** 取第一個有意義關鍵字(略過 frontmatter 與 %% 註解、init 指令)。 */
export function firstKeyword(text: string): string {
  let src = text.trim();
  // 去除開頭 YAML frontmatter(--- ... ---)。
  if (src.startsWith('---')) {
    const end = src.indexOf('\n---', 3);
    if (end !== -1) {
      const after = src.indexOf('\n', end + 1);
      src = after === -1 ? '' : src.slice(after + 1);
    }
  }
  for (const rawLine of src.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('%%')) continue; // 註解 / init 指令
    // 與 mermaidExtract.ts 相同:用空白 / : / ( / { 斷詞取首 token。
    return line.split(/[\s:({]/)[0].toLowerCase();
  }
  return '';
}

/** 由文字偵測圖種;比對已註冊 adapter 的 keywords。 */
export function detectDiagramType(text: string): DiagramType | undefined {
  const kw = firstKeyword(text);
  if (!kw) return undefined;
  for (const adapter of registry.values()) {
    if (adapter.keywords.includes(kw)) return adapter.capabilities.type;
  }
  return undefined;
}
