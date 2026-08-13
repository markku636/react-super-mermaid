// architecture-beta 的雙向 round-trip(純文字)。
//
// 為什麼自己解析:architecture 走的是 langium parser,它的 DB 上一個 getXxx() 都沒有
// (inspectDb 對它印出「這個 DB 沒有任何 getXxx() 可讀」),所以資料根本要不回來。
// 好在語法只有四種行,逐行解析既精確又可逆。
//
//   group  <id>(<icon>)[<標題>] [in <parent>]
//   service <id>(<icon>)[<標題>] [in <group>]
//   junction <id> [in <group>]
//   <id>:<邊> <箭頭> <邊>:<id>      邊 ∈ T/B/L/R,箭頭 ∈ -- / --> / <-- / <-->

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneContainer, SceneEdge, SceneNode } from '../../scene/types';

const NODE_W = 132;
const NODE_H = 96;

const DECL_RE = /^(group|service|junction)\s+([A-Za-z0-9_-]+)\s*(?:\(([^)]*)\))?\s*(?:\[([^\]]*)\])?\s*(?:in\s+([A-Za-z0-9_-]+))?\s*$/i;
const EDGE_RE = /^([A-Za-z0-9_-]+):([TBLR])\s*(<-->|-->|<--|--)\s*([TBLR]):([A-Za-z0-9_-]+)\s*$/;

export function architectureToScene(text: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const comments: string[] = [];
  const nodes: SceneNode[] = [];
  const containers: SceneContainer[] = [];
  const edges: SceneEdge[] = [];
  let seenHeader = false;
  let nIdx = 0;
  let cIdx = 0;
  let eIdx = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) {
      comments.push(line);
      continue;
    }
    if (!seenHeader && /^architecture(-beta)?$/i.test(line)) {
      seenHeader = true;
      continue;
    }
    const d = DECL_RE.exec(line);
    if (d) {
      const [, kindRaw, id, icon, title, parent] = d;
      const kind = kindRaw.toLowerCase();
      if (kind === 'group') {
        containers.push({
          id,
          label: title ?? id,
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          parentId: parent ?? null,
          childNodeIds: [],
          c4Type: icon, // 圖示存在既有欄位(容器沒有 data 欄位可放)
          sourceIndex: cIdx++,
        });
      } else {
        nodes.push({
          id,
          shape: 'archNode',
          label: title ?? id,
          x: 0,
          y: 0,
          w: NODE_W,
          h: NODE_H,
          parentId: parent ?? null,
          data: { kind: 'architecture', icon: icon || undefined, junction: kind === 'junction' },
          sourceIndex: nIdx++,
        });
      }
      continue;
    }
    const e = EDGE_RE.exec(line);
    if (e) {
      const [, from, fromSide, arrow, toSide, to] = e;
      edges.push({
        id: `e${eIdx}`,
        source: from,
        target: to,
        lineKind: 'solid',
        arrowStart: arrow.startsWith('<') ? 'arrow' : 'none',
        arrowEnd: arrow.endsWith('>') ? 'arrow' : 'none',
        data: { kind: 'architecture', fromSide, toSide },
        sourceIndex: eIdx++,
      });
      continue;
    }
    warnings.push({ message: `略過看不懂的一行:${line}` });
  }

  if (!seenHeader) warnings.push({ message: '找不到 architecture-beta 標頭,已以空圖處理。' });

  // 把節點掛進所屬 group(容器框由渲染器依子節點 bbox 算)。
  const byId = new Map(containers.map((c) => [c.id, c] as const));
  for (const n of nodes) {
    if (n.parentId) byId.get(n.parentId)?.childNodeIds.push(n.id);
  }

  const scene: EditorScene = {
    version: 1,
    diagramType: 'architecture',
    meta: { type: 'architecture' },
    nodes,
    edges,
    containers,
    raw: { comments, fullSource: seenHeader ? undefined : text },
    // 座標交給排版:mermaid 的 architecture 渲染器不吐可讀節點,會落到內建的分組格狀排版。
    layoutOwner: 'engine',
  };
  return { scene, warnings };
}

function bySourceIndex<T extends { sourceIndex?: number }>(a: T, b: T): number {
  return (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b.sourceIndex ?? Number.MAX_SAFE_INTEGER);
}

export function sceneToArchitecture(scene: EditorScene): SerializeResult {
  if (scene.nodes.length === 0 && scene.containers.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const lines: string[] = [];
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('architecture-beta');
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(`    ${t}`);
  }

  /**
   * 標籤的三條規矩(都是直接問 mermaid 問出來的,見 scripts/checkSyntax.mjs):
   *   [中文]     → Lexer error;必須寫成 ["中文"]
   *   []         → Lexer error;沒有標籤就整段省略
   *   [Order DB] → 可以,空白不需要引號
   */
  const labelPart = (label: string): string => {
    const clean = label.replace(/[[\]"]/g, '').trim();
    if (!clean) return '';
    return /^[\x20-\x7E]+$/.test(clean) ? `[${clean}]` : `["${clean}"]`;
  };
  const decl = (id: string, icon: string | undefined, label: string, parent?: string | null): string =>
    `${id}${icon ? `(${icon})` : ''}${labelPart(label)}${parent ? ` in ${parent}` : ''}`;

  for (const c of [...scene.containers].sort(bySourceIndex)) {
    lines.push(`    group ${decl(c.id, c.c4Type, c.label || c.id, c.parentId)}`);
  }
  for (const n of [...scene.nodes].sort(bySourceIndex)) {
    const d = n.data?.kind === 'architecture' ? n.data : undefined;
    if (d?.junction) {
      lines.push(`    junction ${n.id}${n.parentId ? ` in ${n.parentId}` : ''}`);
      continue;
    }
    lines.push(`    service ${decl(n.id, d?.icon, n.label || n.id, n.parentId)}`);
  }
  const ids = new Set(scene.nodes.map((n) => n.id));
  for (const e of [...scene.edges].sort(bySourceIndex)) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      warnings.push({ message: `略過懸空連線 ${e.id}`, elementId: e.id });
      continue;
    }
    const d = e.data?.kind === 'architecture' ? e.data : undefined;
    // 箭頭方向沿用場景的 arrowStart / arrowEnd(右鍵切換箭頭就會反映到這裡)。
    const arrow =
      e.arrowStart !== 'none' && e.arrowEnd !== 'none'
        ? '<-->'
        : e.arrowEnd !== 'none'
          ? '-->'
          : e.arrowStart !== 'none'
            ? '<--'
            : '--';
    lines.push(`    ${e.source}:${d?.fromSide ?? 'R'} ${arrow} ${d?.toSide ?? 'L'}:${e.target}`);
  }
  return { text: lines.join('\n') + '\n', warnings };
}
