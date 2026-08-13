// 場景 → erDiagram 文字。確定性、永遠輸出合法 mermaid。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, ErCardinality, SceneEdge, SceneNode } from '../../scene/types';

const INDENT = '    ';

const START_SYM: Record<ErCardinality, string> = {
  zeroOrOne: '|o',
  onlyOne: '||',
  zeroOrMore: '}o',
  oneOrMore: '}|',
};
const END_SYM: Record<ErCardinality, string> = {
  zeroOrOne: 'o|',
  onlyOne: '||',
  zeroOrMore: 'o{',
  oneOrMore: '|{',
};

function bySourceIndex<T extends { sourceIndex?: number }>(a: T, b: T): number {
  return (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b.sourceIndex ?? Number.MAX_SAFE_INTEGER);
}

/**
 * mermaid ER 沒有 alias 語法(`X["顯示名"]` 在 11.x 是語法錯誤)——實體「名稱」本身就是顯示文字。
 * 所以序列化必須輸出 label 而不是內部 id,否則在編輯器改名完全寫不回檔案(改了等於沒改)。
 * 含空白 / 引號等字元時加引號(mermaid 支援 `"客戶 帳號" ||--o{ …`)。
 */
function entityToken(name: string): string {
  return /^[^\s"'{}[\]|:,()]+$/.test(name) ? name : `"${name.replace(/"/g, '')}"`;
}

/** 實體 id → 輸出名稱。以 label 為準,空白時退回 id;重名時補序號以免兩個實體被 mermaid 併成一個。 */
function entityNames(nodes: SceneNode[]): Map<string, string> {
  const taken = new Set<string>();
  const map = new Map<string, string>();
  for (const n of nodes) {
    const base = n.label && n.label.trim().length > 0 ? n.label.trim() : n.id;
    let name = base;
    let k = 2;
    while (taken.has(name)) name = `${base}_${k++}`;
    taken.add(name);
    map.set(n.id, entityToken(name));
  }
  return map;
}

function serializeRelationship(e: SceneEdge, nameOf: Map<string, string>): string {
  const card = e.data?.kind === 'er' ? e.data : undefined;
  const start = START_SYM[card?.cardStart ?? 'onlyOne'];
  const end = END_SYM[card?.cardEnd ?? 'zeroOrMore'];
  const rel = card?.identifying === false ? '..' : '--';
  const role = e.label && e.label.length > 0 ? e.label : '""';
  const s = nameOf.get(e.source) ?? e.source;
  const t = nameOf.get(e.target) ?? e.target;
  return `${s} ${start}${rel}${end} ${t} : ${role}`;
}

export function sceneToEr(scene: EditorScene): SerializeResult {
  // 解析失敗的降級場景(空節點但保有原文)→ 原樣回吐,絕不覆寫成空。
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const lines: string[] = [];

  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('erDiagram');
  const dir = scene.meta.type === 'er' ? scene.meta.direction : undefined;
  if (dir && dir !== 'TB' && dir !== 'TD') lines.push(`${INDENT}direction ${dir}`);
  // 一般 %% 註解(非 init)→ 標頭後逐字保留。
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(INDENT + t);
  }

  // 1. 關係(穩定排序)。
  const nameOf = entityNames([...scene.nodes].sort(bySourceIndex));
  const ids = new Set(scene.nodes.map((n) => n.id));
  for (const e of [...scene.edges].sort(bySourceIndex)) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      warnings.push({ message: `略過懸空關係 ${e.id}`, elementId: e.id });
      continue;
    }
    lines.push(INDENT + serializeRelationship(e, nameOf));
  }

  // 2. 實體屬性區塊(只在有屬性時輸出 { } 區塊;無屬性的實體已由關係宣告)。
  //    孤立且無屬性的實體 → 單獨輸出實體名以保留。
  const inEdge = new Set<string>();
  for (const e of scene.edges) {
    inEdge.add(e.source);
    inEdge.add(e.target);
  }
  for (const n of [...scene.nodes].sort(bySourceIndex)) {
    const attrs = n.data?.kind === 'er' ? n.data.attributes : [];
    const name = nameOf.get(n.id) ?? n.id;
    if (attrs.length > 0) {
      lines.push(`${INDENT}${name} {`);
      for (const a of attrs) {
        const type = a.type && a.type.length ? a.type : 'string';
        const keys = a.keys && a.keys.length ? ` ${a.keys.join(',')}` : '';
        const comment = a.comment && a.comment.length ? ` "${a.comment.replace(/"/g, '')}"` : '';
        lines.push(`${INDENT}${INDENT}${type} ${a.name}${keys}${comment}`);
      }
      lines.push(`${INDENT}}`);
    } else if (!inEdge.has(n.id)) {
      lines.push(`${INDENT}${name}`);
    }
  }

  return { text: lines.join('\n') + '\n', warnings };
}
