// 場景 → requirementDiagram 文字。確定性、永遠輸出合法 mermaid。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, ReqType, SceneNode } from '../../scene/types';

const INDENT = '    ';

/**
 * requirementDiagram 的名稱是**識別字**,mermaid 的 lexer 只吃 ASCII 字母 / 數字 / 底線 ——
 * 中文名稱會直接讓整份圖語法錯誤(不像 ER 的實體名可以是中文,也不像 class 有 ["顯示名"] 別名)。
 * 所以這裡把名稱壓成安全識別字;真正要給人看的中文請寫在 text 欄位(它可以加引號帶中文)。
 */
export function reqName(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback.replace(/[^A-Za-z0-9_]+/g, '_') || 'req';
  return /^[0-9]/.test(cleaned) ? `r_${cleaned}` : cleaned;
}

/**
 * 值型欄位(id / text / type / docref)吃到行尾。含非 ASCII 或引號時必須加引號,
 * 否則 lexer 不認(`text: 待填寫` 會噴 Lexical error;`text: "待填寫"` 可以)。
 */
function inlineValue(raw: string): string {
  const v = raw.replace(/\r?\n+/g, ' ').replace(/[{}"]/g, '').trim();
  return /^[\x20-\x7E]*$/.test(v) ? v : `"${v}"`;
}

function emitRequirement(n: SceneNode, lines: string[]): void {
  const d = n.data?.kind === 'requirement' ? n.data.req : undefined;
  if (!d || d.element) return;
  const type: ReqType = d.reqType ?? 'requirement';
  lines.push(`${INDENT}${type} ${reqName(n.label, n.id)} {`);
  // id 與 text 是 mermaid 的必填欄位:少了任一個,整份圖直接語法錯誤。
  lines.push(`${INDENT}${INDENT}id: ${inlineValue(d.reqId ?? '') || n.id}`);
  lines.push(`${INDENT}${INDENT}text: ${inlineValue(d.text ?? '') || n.label || n.id}`);
  if (d.risk) lines.push(`${INDENT}${INDENT}risk: ${d.risk}`);
  if (d.verifyMethod) lines.push(`${INDENT}${INDENT}verifymethod: ${d.verifyMethod}`);
  lines.push(`${INDENT}}`);
}

function emitElement(n: SceneNode, lines: string[]): void {
  const d = n.data?.kind === 'requirement' ? n.data.req : undefined;
  if (!d || !d.element) return;
  lines.push(`${INDENT}element ${reqName(n.label, n.id)} {`);
  lines.push(`${INDENT}${INDENT}type: ${inlineValue(d.elementType ?? '') || 'simulation'}`);
  if (d.docRef) lines.push(`${INDENT}${INDENT}docref: ${inlineValue(d.docRef)}`);
  lines.push(`${INDENT}}`);
}

function bySourceIndex<T extends { sourceIndex?: number }>(a: T, b: T): number {
  return (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (b.sourceIndex ?? Number.MAX_SAFE_INTEGER);
}

export function sceneToRequirement(scene: EditorScene): SerializeResult {
  // 解析失敗的降級場景(空節點但保有原文)→ 原樣回吐,絕不覆寫成空。
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const lines: string[] = [];

  if (scene.frontmatter) lines.push(scene.frontmatter.replace(/\n+$/, ''));
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('requirementDiagram');
  const dir = scene.meta.type === 'requirement' ? scene.meta.direction : undefined;
  if (dir && dir !== 'TB' && dir !== 'TD') lines.push(`${INDENT}direction ${dir}`);
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(INDENT + t);
  }

  const sorted = [...scene.nodes].sort(bySourceIndex);
  for (const n of sorted) emitRequirement(n, lines);
  for (const n of sorted) emitElement(n, lines);
  // 名稱被迫改寫時要講出來 —— 使用者打了中文名字卻在檔案裡看到 `_`,不說明會以為是壞掉。
  for (const n of sorted) {
    const safe = reqName(n.label, n.id);
    if (n.label && safe !== n.label) {
      warnings.push({
        message: `需求圖的名稱只能用英數與底線,「${n.label}」已改寫成「${safe}」(中文請寫在 text 欄位)`,
        elementId: n.id,
      });
    }
  }

  // 關係用「名稱」(mermaid 的節點識別就是名稱),所以要用與宣告一致的正規化名稱。
  const nameOf = new Map(scene.nodes.map((n) => [n.id, reqName(n.label, n.id)] as const));
  for (const e of [...scene.edges].sort(bySourceIndex)) {
    const s = nameOf.get(e.source);
    const t = nameOf.get(e.target);
    if (!s || !t) {
      warnings.push({ message: `略過懸空關係 ${e.id}`, elementId: e.id });
      continue;
    }
    const rel = e.data?.kind === 'requirement' ? e.data.relation : 'traces';
    lines.push(`${INDENT}${s} - ${rel} -> ${t}`);
  }

  for (const s of scene.raw?.styleLines ?? []) lines.push(INDENT + s.trim());

  return { text: lines.join('\n') + '\n', warnings };
}
