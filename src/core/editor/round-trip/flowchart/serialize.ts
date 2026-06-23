// 場景 → flowchart 文字。確定性、可逐行 diff、永遠輸出合法 mermaid。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneContainer, SceneEdge, SceneNode } from '../../scene/types';
import { SHAPE_TO_BRACKETS, buildLinkOperator } from './syntax-maps';

const INDENT = '    ';

/** 是否可不加引號直接當 label(僅英數、空白、底線、CJK 等安全字元)。 */
function isBareSafe(label: string): boolean {
  if (label.length === 0) return false;
  if (label !== label.trim()) return false;
  // 含括號/引號/管線/井號/角括號/大括號 → 需引號。
  return !/[[\](){}|<>"#&;\\/]/.test(label) && !/^\d/.test(label);
}

/** 把 label 轉成可放進括號的安全形式。 */
function escapeLabel(label: string, kind?: SceneNode['labelKind']): string {
  if (kind === 'markdown') {
    // markdown label 用反引號包裹。
    const inner = label.replace(/`/g, '\\`');
    return `"\`${inner}\`"`;
  }
  if (isBareSafe(label)) return label;
  // 引號內 mermaid 保留 & # ( ) 等字面值;只需轉義會破壞解析的 " 與換行。
  // (先前還轉 &→&amp;、#→&#35;,但 mermaid 不會還原 → 每次 round-trip 重複轉義成 &amp;amp; 而資料漸壞。)
  const escaped = label.replace(/"/g, '&quot;').replace(/\r?\n/g, '<br/>');
  return `"${escaped}"`;
}

/** 節點宣告:`id[label]`。rectangle + 空 label → 裸 id。 */
function declareNode(n: SceneNode): string {
  const brackets = SHAPE_TO_BRACKETS[n.shape];
  if (!brackets || (n.shape === 'rectangle' && n.label.length === 0)) {
    // 無對映外形(passthrough / 其他圖種)或空矩形 → 裸 id(+ 原始 raw)。
    return n.raw ? `${n.id}${n.raw}` : n.id;
  }
  const lbl = n.label.length === 0 ? '' : escapeLabel(n.label, n.labelKind);
  const inner = lbl.length === 0 ? ' ' : lbl;
  let decl = `${n.id}${brackets.left}${inner}${brackets.right}`;
  if (n.style?.classRef) decl += `:::${n.style.classRef}`;
  return decl;
}

function serializeEdge(e: SceneEdge): string {
  const op = buildLinkOperator(e);
  if (e.label && e.label.length > 0) {
    return `${e.source} ${op}|${escapeLabel(e.label, e.labelKind)}| ${e.target}`;
  }
  return `${e.source} ${op} ${e.target}`;
}

/** 比較器:先 sourceIndex(parse 原序),否則維持插入序。 */
function bySourceIndex<T extends { sourceIndex?: number }>(a: T, b: T): number {
  const ai = a.sourceIndex ?? Number.MAX_SAFE_INTEGER;
  const bi = b.sourceIndex ?? Number.MAX_SAFE_INTEGER;
  return ai - bi;
}

export function sceneToFlowchart(scene: EditorScene): SerializeResult {
  const warnings: DataLossWarning[] = [];
  const lines: string[] = [];

  // 1. frontmatter(逐字)。
  if (scene.frontmatter) {
    lines.push(scene.frontmatter.replace(/\n+$/, ''));
  }
  // 2. init / 設定指令(逐字,來自 raw.comments 中的 %%{...}%%)。
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }

  // 3. 標頭。
  const direction = scene.meta.type === 'flowchart' ? scene.meta.direction : 'TB';
  lines.push(`flowchart ${direction}`);

  // 4. 節點:先頂層,容器內的留到 subgraph 裡宣告。
  const containerOf = new Map<string, string>();
  for (const c of scene.containers) {
    for (const cid of c.childNodeIds) containerOf.set(cid, c.id);
  }
  const topNodes = scene.nodes.filter((n) => !containerOf.has(n.id)).sort(bySourceIndex);
  for (const n of topNodes) lines.push(INDENT + declareNode(n));

  // 5. subgraph(DFS,支援巢狀)。
  const byId = new Map(scene.nodes.map((n) => [n.id, n] as const));
  const containersById = new Map(scene.containers.map((c) => [c.id, c] as const));
  const childContainers = new Map<string, SceneContainer[]>();
  const rootContainers: SceneContainer[] = [];
  for (const c of scene.containers) {
    if (c.parentId && containersById.has(c.parentId)) {
      const arr = childContainers.get(c.parentId) ?? [];
      arr.push(c);
      childContainers.set(c.parentId, arr);
    } else {
      rootContainers.push(c);
    }
  }

  const emitContainer = (c: SceneContainer, depth: number): void => {
    const pad = INDENT.repeat(depth);
    const title = c.label && c.label.length > 0 ? ` [${escapeLabel(c.label)}]` : '';
    lines.push(`${pad}subgraph ${c.id}${title}`);
    if (c.direction) lines.push(`${pad}${INDENT}direction ${c.direction}`);
    for (const cid of c.childNodeIds) {
      const node = byId.get(cid);
      if (node) lines.push(pad + INDENT + declareNode(node));
    }
    for (const child of (childContainers.get(c.id) ?? []).sort(bySourceIndex)) {
      emitContainer(child, depth + 1);
    }
    lines.push(`${pad}end`);
  };
  for (const c of rootContainers.sort(bySourceIndex)) emitContainer(c, 1);

  // 6. 連線(穩定排序)。
  const edges = [...scene.edges].sort(bySourceIndex);
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      warnings.push({ message: `略過懸空連線 ${e.id}(${e.source}→${e.target})`, elementId: e.id });
      continue;
    }
    lines.push(INDENT + serializeEdge(e));
  }

  // 7. 節點內聯樣式(編輯器設的底色 / 框線)→ mermaid `style <id> fill:..,stroke:..`。
  for (const n of scene.nodes) {
    const st = n.style;
    if (!st || st.classRef) continue; // classRef 已在宣告時用 :::name 輸出
    const parts: string[] = [];
    if (st.fill) parts.push(`fill:${st.fill}`);
    if (st.stroke) parts.push(`stroke:${st.stroke}`);
    if (st.strokeWidth) parts.push(`stroke-width:${st.strokeWidth}px`);
    if (st.color) parts.push(`color:${st.color}`);
    if (parts.length) lines.push(`${INDENT}style ${n.id} ${parts.join(',')}`);
  }

  // 8. 樣式 / class / click(逐字回吐)。
  for (const s of scene.raw?.styleLines ?? []) lines.push(INDENT + s.trim());
  for (const ck of scene.raw?.clickLines ?? []) lines.push(INDENT + ck.trim());

  return { text: lines.join('\n') + '\n', warnings };
}
