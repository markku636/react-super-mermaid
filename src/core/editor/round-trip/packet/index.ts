// packet-beta 的雙向 round-trip + 版面。
//
// 封包圖是一條連續的位元帶:每個欄位接在前一個之後,起始位元完全由前面欄位的寬度累加決定。
// 所以編輯模型是:**欄位的寬度就是它佔幾個 bit,左右順序就是它的先後**。拉右緣改寬度、
// 左右拖改順序,序列化時再把起始位元重新累加出來 —— 位元編號永遠自動保持連續,
// 不會出現「改了一個欄位、後面全部對不上」這種只有手寫才會犯的錯。
//
// 編輯畫布刻意畫成**一條不換行的長帶**(mermaid 渲染時每 32 bit 換行)。換行會把一個欄位
// 切成兩段,拖曳時就沒有一個明確的「這個欄位的矩形」可以抓。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneNode } from '../../scene/types';

export const BIT = { w: 26, h: 62, x0: 60, y0: 90 } as const;

const RANGE_RE = /^(\d+)\s*(?:-\s*(\d+))?\s*:\s*"?(.*?)"?\s*$/;
const REL_RE = /^\+\s*(\d+)\s*:\s*"?(.*?)"?\s*$/;

export function packetToScene(text: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const comments: string[] = [];
  const nodes: SceneNode[] = [];
  let title: string | undefined;
  let seenHeader = false;
  /** 原本寫的是相對寬度(+N)還是絕對範圍?整份沿用作者的寫法。 */
  let relative = false;
  let bit = 0;
  let idx = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%')) {
      comments.push(line);
      continue;
    }
    if (!seenHeader && /^packet(-beta)?$/i.test(line)) {
      seenHeader = true;
      continue;
    }
    const t = /^title\s+(.*)$/i.exec(line);
    if (t) {
      title = t[1].trim();
      continue;
    }
    const rel = REL_RE.exec(line);
    const abs = rel ? null : RANGE_RE.exec(line);
    if (!rel && !abs) {
      warnings.push({ message: `略過看不懂的一行:${line}` });
      continue;
    }
    let start: number;
    let end: number;
    let label: string;
    if (rel) {
      relative = true;
      start = bit;
      end = bit + Number(rel[1]) - 1;
      label = rel[2];
    } else {
      start = Number(abs![1]);
      end = abs![2] === undefined ? start : Number(abs![2]);
      label = abs![3];
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      warnings.push({ message: `略過看不懂的位元範圍:${line}` });
      continue;
    }
    bit = end + 1;
    nodes.push({
      id: `f${idx}`,
      shape: 'packetField',
      label,
      x: BIT.x0 + start * BIT.w,
      y: BIT.y0,
      w: (end - start + 1) * BIT.w,
      h: BIT.h,
      data: { kind: 'packet' },
      sourceIndex: idx++,
      pinned: true,
    });
  }

  if (!seenHeader) warnings.push({ message: '找不到 packet-beta 標頭,已以空圖處理。' });

  const scene: EditorScene = {
    version: 1,
    diagramType: 'packet',
    meta: { type: 'packet', title, relative },
    nodes,
    edges: [],
    containers: [],
    raw: { comments, fullSource: seenHeader ? undefined : text },
    layoutOwner: 'user',
  };
  return { scene, warnings };
}

/** 依目前的 x 排序,並把每個欄位的寬度換算成位元數(至少 1 bit)。 */
function fieldsInOrder(scene: EditorScene): Array<{ node: SceneNode; bits: number }> {
  return [...scene.nodes]
    .sort((a, b) => a.x - b.x || (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0))
    .map((node) => ({ node, bits: Math.max(1, Math.round(node.w / BIT.w)) }));
}

export function sceneToPacket(scene: EditorScene): SerializeResult {
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const meta = scene.meta.type === 'packet' ? scene.meta : { title: undefined, relative: false };
  const lines: string[] = [];
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('packet-beta');
  if (meta.title) lines.push(`title ${meta.title}`);
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(t);
  }

  let bit = 0;
  for (const { node, bits } of fieldsInOrder(scene)) {
    const label = (node.label || node.id).replace(/"/g, '');
    if (meta.relative) {
      lines.push(`+${bits}: "${label}"`);
    } else {
      const end = bit + bits - 1;
      // 單一 bit 的欄位 mermaid 允許寫成 `16: "…"`(不必寫成 16-16)。
      lines.push(`${bit === end ? bit : `${bit}-${end}`}: "${label}"`);
    }
    bit += bits;
  }
  return { text: lines.join('\n') + '\n', warnings };
}

/** 「整理」= 依目前順序把欄位接成一條連續的位元帶(寬度不變)。 */
export function layoutPacket(scene: EditorScene): EditorScene {
  let bit = 0;
  const nodes = fieldsInOrder(scene).map(({ node, bits }) => {
    const x = BIT.x0 + bit * BIT.w;
    bit += bits;
    return { ...node, x, y: BIT.y0, w: bits * BIT.w, h: BIT.h };
  });
  return { ...scene, nodes, layoutOwner: 'user' };
}
