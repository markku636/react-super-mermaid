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

  // 參與者:有別名 / 是 actor 才顯式宣告(其餘由訊息推斷,保持順序與冪等)。
  // 但若參與者順序與「首次出現於訊息」不同,仍須顯式宣告以保序。
  for (const p of seq.participants) {
    const kw = p.actor ? 'actor' : 'participant';
    if (p.label !== p.id) lines.push(`${INDENT}${kw} ${p.id} as ${p.label}`);
    else if (p.actor) lines.push(`${INDENT}actor ${p.id}`);
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
