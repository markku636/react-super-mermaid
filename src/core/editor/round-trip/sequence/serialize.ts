// 場景 → sequenceDiagram 文字。依 scene.sequence 的陳述串確定性重建(含片段縮排)。無損。

import type { DataLossWarning, SerializeResult } from '../../adapters/types';
import type { EditorScene } from '../../scene/types';

const INDENT = '    ';
// 增加縮排的片段起始關鍵字。
const OPENERS = new Set(['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect', 'box']);
// 與起始同層、但內容縮排的中段關鍵字。
const MIDDLE = new Set(['else', 'and', 'option']);

export function sceneToSequence(scene: EditorScene): SerializeResult {
  const warnings: DataLossWarning[] = [];
  const seq = scene.sequence;
  const lines: string[] = [];

  if (scene.frontmatter) lines.push(scene.frontmatter.replace(/\n+$/, ''));
  for (const c of scene.raw?.comments ?? []) {
    if (c.trim().startsWith('%%{')) lines.push(c.trim());
  }
  lines.push('sequenceDiagram');
  if (!seq) return { text: lines.join('\n') + '\n', warnings };

  if (seq.autonumber) lines.push(`${INDENT}autonumber`);

  // 參與者:有別名 / 是 actor 一律顯式宣告(別名 + actor 外形都要)。其餘(id===label 的純參與者)
  // 預設由訊息推斷以保持輸出精簡;但若「拖曳換序」後的順序無法靠訊息首次出現推斷出來,
  // 就把純參與者也顯式宣告以鎖序(否則 mermaid 會依首次出現重排,換序不持久)。
  const declaredIds = new Set(seq.participants.filter((p) => p.label !== p.id || p.actor).map((p) => p.id));
  // mermaid 有效順序 = 已宣告者(依此陣列序) ++ 未宣告者(依訊息首次出現) ++ 從未被引用者(陣列序)。
  const appearance: string[] = [];
  const seen = new Set<string>();
  const mark = (pid?: string): void => {
    const k = pid?.trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      appearance.push(k);
    }
  };
  for (const s of seq.statements) {
    if (s.kind === 'message') {
      mark(s.from);
      mark(s.to);
    } else if (s.kind === 'note') {
      for (const a of s.actors.split(',')) mark(a.trim());
    } else if (s.kind === 'activate' || s.kind === 'deactivate') {
      mark(s.actor);
    }
  }
  const effective: string[] = [];
  const placed = new Set<string>();
  for (const p of seq.participants) if (declaredIds.has(p.id)) (placed.add(p.id), effective.push(p.id));
  for (const id of appearance) if (!placed.has(id)) (placed.add(id), effective.push(id));
  for (const p of seq.participants) if (!placed.has(p.id)) (placed.add(p.id), effective.push(p.id));
  const wantOrder = seq.participants.map((p) => p.id);
  const lockOrder = effective.length !== wantOrder.length || effective.some((id, i) => id !== wantOrder[i]);
  for (const p of seq.participants) {
    const kw = p.actor ? 'actor' : 'participant';
    if (p.label !== p.id) lines.push(`${INDENT}${kw} ${p.id} as ${p.label}`);
    else if (p.actor) lines.push(`${INDENT}actor ${p.id}`);
    else if (lockOrder) lines.push(`${INDENT}participant ${p.id}`);
  }

  let depth = 1;
  const pad = (): string => INDENT.repeat(Math.max(1, depth));
  for (const s of seq.statements) {
    switch (s.kind) {
      case 'message': {
        const act = s.activate === '+' ? '+' : s.activate === '-' ? '-' : '';
        lines.push(`${pad()}${s.from}${s.arrow}${act}${s.to}: ${s.text}`);
        break;
      }
      case 'note':
        lines.push(`${pad()}Note ${s.placement} ${s.actors}: ${s.text}`);
        break;
      case 'fragment': {
        const kw = s.keyword;
        if (MIDDLE.has(kw)) {
          // else/and/option 與其起始同層(暫退一層輸出再回來)。
          const here = Math.max(1, depth - 1);
          lines.push(`${INDENT.repeat(here)}${kw}${s.label ? ' ' + s.label : ''}`);
        } else {
          lines.push(`${pad()}${kw}${s.label ? ' ' + s.label : ''}`);
          if (OPENERS.has(kw)) depth += 1;
        }
        break;
      }
      case 'end':
        depth = Math.max(1, depth - 1);
        lines.push(`${pad()}end`);
        break;
      case 'activate':
        lines.push(`${pad()}activate ${s.actor}`);
        break;
      case 'deactivate':
        lines.push(`${pad()}deactivate ${s.actor}`);
        break;
      case 'raw':
        lines.push(`${pad()}${s.text}`);
        break;
    }
  }

  return { text: lines.join('\n') + '\n', warnings };
}
