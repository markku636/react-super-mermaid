// gitGraph 的雙向 round-trip + 版面。
//
// 關鍵觀察:gitGraph 的**父子關係是從指令順序推導出來的**,原始碼裡並沒有寫。所以只要留住
// 「每個 commit 在哪一條分支、排第幾」,就能完整重建整份指令流 —— 而這兩件事正好就是
// 「它在哪一列、在哪個水平位置」。因此橫向拖 = 改順序、縱向拖到別條泳道 = 改分支。
//
// 解析走 mermaid 的 DB(它已經把 branch / seq / type / tags 都算好);cherry-pick 這種
// 目前還原不出來的指令一出現就整份原文回吐,降為唯讀。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene, SceneContainer, SceneNode } from '../../scene/types';
import type { MermaidLike } from '../../../../types';

export const GIT = { x0: 120, y0: 70, dx: 130, laneH: 86, node: 40 } as const;

/** mermaid 的 commit type 代碼。 */
const TYPE_NORMAL = 0;
const TYPE_REVERSE = 1;
const TYPE_HIGHLIGHT = 2;
const TYPE_MERGE = 3;
const TYPE_CHERRY_PICK = 4;

/** 右鍵選單用的記號清單(merge 不在其中 —— 它由「有沒有來源分支」決定,不能隨手切)。 */
export const GIT_COMMIT_TYPES: Array<[number, string]> = [
  [TYPE_NORMAL, '一般提交'],
  [TYPE_HIGHLIGHT, '重點提交(實心)'],
  [TYPE_REVERSE, '回退提交(打叉)'],
];

/** 新增一條分支泳道時的矩形(和 layoutGitgraph 用同一組常數)。 */
export function gitLaneRect(index: number, commitCount: number): { x: number; y: number; w: number; h: number } {
  return {
    x: GIT.x0 - 90,
    y: GIT.y0 + index * GIT.laneH - GIT.laneH / 2,
    w: 90 + Math.max(1, commitCount) * GIT.dx,
    h: GIT.laneH,
  };
}

interface MermaidApiLike {
  mermaidAPI?: { getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown } };
  getDiagramFromText?: (t: string) => Promise<{ db?: unknown }> | { db?: unknown };
}
interface GitCommitLike {
  id?: string;
  message?: string;
  seq?: number;
  type?: number;
  tags?: string[];
  parents?: string[];
  branch?: string;
  customId?: boolean;
}
interface GitDbLike {
  getCommitsArray?: () => GitCommitLike[];
  getBranchesAsObjArray?: () => Array<{ name?: string }>;
}

async function getGitDb(text: string, mermaid: MermaidLike): Promise<GitDbLike | undefined> {
  const api = mermaid as unknown as MermaidApiLike;
  const fn = api.mermaidAPI?.getDiagramFromText ?? api.getDiagramFromText;
  if (typeof fn !== 'function') return undefined;
  try {
    mermaid.initialize?.({ startOnLoad: false });
  } catch {
    /* ignore */
  }
  const diagram = await fn.call(api.mermaidAPI ?? api, text);
  const db = diagram?.db as GitDbLike | undefined;
  if (!db || typeof db.getCommitsArray !== 'function') return undefined;
  return db;
}

function passthrough(text: string, comments: string[], warnings: ParseWarning[]): ParseResult {
  return {
    scene: {
      version: 1,
      diagramType: 'gitgraph',
      meta: { type: 'gitgraph' },
      nodes: [],
      edges: [],
      containers: [],
      raw: { comments, fullSource: text },
      layoutOwner: 'user',
    },
    warnings,
  };
}

export async function gitgraphDbToScene(text: string, mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  const comments = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('%%'));
  let db: GitDbLike | undefined;
  try {
    db = await getGitDb(text, mermaid);
  } catch (err) {
    warnings.push({ message: `mermaid 解析失敗:${(err as Error).message}` });
  }
  if (!db) {
    warnings.push({ message: 'mermaid 解析 API 不可用。' });
    return passthrough(text, comments, warnings);
  }

  const commits = [...(db.getCommitsArray?.() ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  if (commits.some((c) => c.type === TYPE_CHERRY_PICK)) {
    warnings.push({ message: '含 cherry-pick 指令,目前還原不出來,已改為唯讀以免改壞原檔。' });
    return passthrough(text, comments, warnings);
  }
  if (commits.length === 0) return passthrough(text, comments, warnings);

  // 分支的顯示順序:以「第一次出現」為準(main 通常就是第一條)。
  const lanes: string[] = [];
  for (const c of commits) {
    const b = c.branch ?? 'main';
    if (!lanes.includes(b)) lanes.push(b);
  }
  for (const b of db.getBranchesAsObjArray?.() ?? []) {
    if (b.name && !lanes.includes(b.name)) lanes.push(b.name);
  }

  const containers: SceneContainer[] = lanes.map((name, i) => ({
    id: name,
    label: name,
    x: GIT.x0 - 90,
    y: GIT.y0 + i * GIT.laneH - GIT.laneH / 2,
    w: 90 + Math.max(1, commits.length) * GIT.dx,
    h: GIT.laneH,
    parentId: null,
    childNodeIds: [],
    sourceIndex: i,
  }));

  const nodes: SceneNode[] = commits.map((c, i) => {
    const lane = Math.max(0, lanes.indexOf(c.branch ?? 'main'));
    return {
      id: c.id ?? `c${i}`,
      shape: 'gitCommit',
      // 自訂 id 才是使用者寫的文字;mermaid 自動產生的 id(customId=false 的 merge)不顯示。
      label: c.type === TYPE_MERGE && c.customId === false ? '' : (c.id ?? ''),
      x: GIT.x0 + i * GIT.dx - GIT.node / 2,
      y: GIT.y0 + lane * GIT.laneH - GIT.node / 2,
      w: GIT.node,
      h: GIT.node,
      parentId: lanes[lane],
      data: {
        kind: 'gitgraph',
        commitType: c.type ?? TYPE_NORMAL,
        tags: c.tags ?? [],
        // merge 的來源分支 = 第二個 parent 所在的分支。
        mergeFrom:
          c.type === TYPE_MERGE
            ? commits.find((p) => p.id === (c.parents ?? [])[1])?.branch
            : undefined,
      },
      sourceIndex: i,
      pinned: true,
    };
  });

  const scene: EditorScene = {
    version: 1,
    diagramType: 'gitgraph',
    meta: { type: 'gitgraph' },
    nodes,
    edges: [],
    containers,
    raw: { comments },
    layoutOwner: 'user',
  };
  return { scene, warnings };
}

/** 依 y 找出它落在哪一條泳道(拖到列與列之間時取最近的一條)。 */
export function gitLaneIndexAt(y: number, laneCount: number): number {
  return laneOf(y, laneCount);
}

function laneOf(y: number, laneCount: number): number {
  const rel = (y + GIT.node / 2 - GIT.y0) / GIT.laneH;
  return Math.max(0, Math.min(laneCount - 1, Math.round(rel)));
}

/** 依 x 排序、依 y 判分支:這兩件事就是整份指令流的全部資訊。 */
function commitsInOrder(scene: EditorScene): Array<{ node: SceneNode; branch: string }> {
  const lanes = [...scene.containers].sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
  const names = lanes.map((l) => l.id);
  return [...scene.nodes]
    .sort((a, b) => a.x - b.x || (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0))
    .map((node) => ({ node, branch: names[laneOf(node.y, names.length)] ?? names[0] ?? 'main' }));
}

const TYPE_KEYWORD: Record<number, string | undefined> = {
  [TYPE_REVERSE]: 'REVERSE',
  [TYPE_HIGHLIGHT]: 'HIGHLIGHT',
};

export function sceneToGitgraph(scene: EditorScene): SerializeResult {
  if (scene.nodes.length === 0 && scene.raw?.fullSource) {
    return { text: scene.raw.fullSource, warnings: [] };
  }
  const warnings: DataLossWarning[] = [];
  const lines: string[] = [];
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('gitGraph');
  for (const c of scene.raw?.comments ?? []) {
    const t = c.trim();
    if (t.startsWith('%%') && !t.startsWith('%%{')) lines.push(`   ${t}`);
  }

  const ordered = commitsInOrder(scene);
  const firstBranch = ordered[0]?.branch ?? 'main';
  const created = new Set<string>([firstBranch]);
  let current = firstBranch;

  for (const { node, branch } of ordered) {
    if (branch !== current) {
      // `branch X` 會「從目前分支建立並切過去」,已存在的分支則用 checkout。
      lines.push(`   ${created.has(branch) ? 'checkout' : 'branch'} ${branch}`);
      created.add(branch);
      current = branch;
    }
    const d = node.data?.kind === 'gitgraph' ? node.data : undefined;
    const tag = d?.tags?.length ? ` tag: "${d.tags[0].replace(/"/g, '')}"` : '';
    if (d?.commitType === TYPE_MERGE) {
      const from = d.mergeFrom;
      if (!from || from === branch || !created.has(from)) {
        // 拖曳把 merge 排到來源分支還不存在的位置 → 降級成一般 commit,並講明白。
        warnings.push({
          message: `合併節點「${node.label || node.id}」的來源分支尚未建立,已改成一般 commit`,
          elementId: node.id,
        });
        lines.push(`   commit${node.label ? ` id: "${node.label}"` : ''}${tag}`);
        continue;
      }
      lines.push(`   merge ${from}${tag}`);
      continue;
    }
    const type = TYPE_KEYWORD[d?.commitType ?? TYPE_NORMAL];
    lines.push(
      `   commit${node.label ? ` id: "${node.label}"` : ''}${type ? ` type: ${type}` : ''}${tag}`,
    );
  }
  return { text: lines.join('\n') + '\n', warnings };
}

/**
 * 依「順序 + 分支」推導出實際的父子連線,給渲染器畫。
 * 規則與 git 本身一致:接到同分支上一個提交;該分支的第一個提交接到「分支出來的那一點」;
 * merge 再多接一條來源分支的最後一個提交。
 */
export function gitgraphLinks(scene: EditorScene): Array<{ from: string; to: string; merge: boolean }> {
  const ordered = commitsInOrder(scene);
  const links: Array<{ from: string; to: string; merge: boolean }> = [];
  const tip = new Map<string, string>();
  let current = ordered[0]?.branch ?? 'main';
  for (const { node, branch } of ordered) {
    if (!tip.has(branch) && branch !== current && tip.has(current)) {
      // 分支點:新分支從目前分支的 tip 長出來。
      tip.set(branch, tip.get(current) as string);
    }
    const parent = tip.get(branch);
    if (parent) links.push({ from: parent, to: node.id, merge: false });
    const d = node.data?.kind === 'gitgraph' ? node.data : undefined;
    if (d?.commitType === TYPE_MERGE && d.mergeFrom && d.mergeFrom !== branch) {
      const other = tip.get(d.mergeFrom);
      if (other) links.push({ from: other, to: node.id, merge: true });
    }
    tip.set(branch, node.id);
    current = branch;
  }
  return links;
}

/** 「整理」= 依目前順序與分支,重新等距排回各自的泳道。 */
export function layoutGitgraph(scene: EditorScene): EditorScene {
  const lanes = [...scene.containers].sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
  const names = lanes.map((l) => l.id);
  const ordered = commitsInOrder(scene);
  const nodes = ordered.map(({ node, branch }, i) => ({
    ...node,
    x: GIT.x0 + i * GIT.dx - GIT.node / 2,
    y: GIT.y0 + Math.max(0, names.indexOf(branch)) * GIT.laneH - GIT.node / 2,
    parentId: branch,
  }));
  const containers = lanes.map((l, i) => ({
    ...l,
    x: GIT.x0 - 90,
    y: GIT.y0 + i * GIT.laneH - GIT.laneH / 2,
    w: 90 + Math.max(1, nodes.length) * GIT.dx,
    h: GIT.laneH,
    childNodeIds: ordered.filter((o) => o.branch === l.id).map((o) => o.node.id),
  }));
  return { ...scene, nodes, containers, layoutOwner: 'user' };
}
