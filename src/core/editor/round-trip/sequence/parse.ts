// sequenceDiagram 文字 → 場景。**行為基礎(line-based)解析**:sequence 語法逐行,自己解析最可控
// 且無損(未模型化的行以 raw 逐字保留)。不需 mermaid DOM。參與者鏡像成 nodes 供選取。

import type { ParseResult, ParseWarning } from '../../adapters/types';
import type { EditorScene, SeqParticipant, SeqStatement, SceneNode } from '../../scene/types';
import type { MermaidLike } from '../../../../types';

const ARROW = /^(<<-->>|<<->>|-->>|--x|--\)|-->|->>|-x|-\)|->)$/;
// 訊息行:from arrow [+/-]to : text
const MSG_RE = /^(\S+?)\s*(<<-->>|<<->>|-->>|--x|--\)|-->|->>|-x|-\)|->)\s*([+-]?)(\S+?)\s*:\s*([\s\S]*)$/;
const PARTICIPANT_RE = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i;
const NOTE_RE = /^note\s+(left of|right of|over)\s+(.+?)\s*:\s*([\s\S]*)$/i;
const FRAG_RE = /^(loop|alt|else|opt|par|and|critical|option|break|rect|box)\b\s*(.*)$/i;
const ACT_RE = /^(activate|deactivate)\s+(\S+)$/i;

function frontmatterSplit(src: string): { frontmatter?: string; body: string } {
  if (src.startsWith('---')) {
    const end = src.indexOf('\n---', 3);
    if (end !== -1) {
      const after = src.indexOf('\n', end + 1);
      return { frontmatter: src.slice(0, after === -1 ? src.length : after), body: after === -1 ? '' : src.slice(after + 1) };
    }
  }
  return { body: src };
}

export async function sequenceToScene(text: string, _mermaid: MermaidLike): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  const { frontmatter, body } = frontmatterSplit(text);
  const lines = body.split('\n');

  let autonumber = false;
  const partsById = new Map<string, SeqParticipant>();
  const order: string[] = [];
  const comments: string[] = [];
  const statements: SeqStatement[] = [];
  const ensureParticipant = (id: string, actor = false): void => {
    const key = id.trim();
    if (!key || partsById.has(key)) return;
    partsById.set(key, { id: key, label: key, actor });
    order.push(key);
  };

  let started = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!started) {
      if (/^sequenceDiagram\b/i.test(line)) {
        started = true;
        continue;
      }
      // header 之前的非空行(罕見)→ 忽略,仍視為已開始。
      started = true;
    }
    if (line.startsWith('%%')) {
      comments.push(line);
      continue;
    }
    if (/^autonumber\b/i.test(line)) {
      autonumber = true;
      continue;
    }
    const pm = line.match(PARTICIPANT_RE);
    if (pm) {
      const id = pm[2].trim();
      ensureParticipant(id, pm[1].toLowerCase() === 'actor');
      const p = partsById.get(id);
      if (p) {
        if (pm[3]) p.label = pm[3].trim();
        if (pm[1].toLowerCase() === 'actor') p.actor = true;
      }
      continue;
    }
    const nm = line.match(NOTE_RE);
    if (nm) {
      const placement = nm[1].toLowerCase() as 'left of' | 'right of' | 'over';
      for (const a of nm[2].split(',')) ensureParticipant(a.trim());
      statements.push({ kind: 'note', placement, actors: nm[2].trim(), text: nm[3] });
      continue;
    }
    const mm = line.match(MSG_RE);
    if (mm && ARROW.test(mm[2])) {
      ensureParticipant(mm[1].trim());
      ensureParticipant(mm[4].trim());
      statements.push({
        kind: 'message',
        from: mm[1].trim(),
        to: mm[4].trim(),
        arrow: mm[2],
        text: mm[5],
        activate: mm[3] === '+' ? '+' : mm[3] === '-' ? '-' : undefined,
      });
      continue;
    }
    if (/^end$/i.test(line)) {
      statements.push({ kind: 'end' });
      continue;
    }
    const fm = line.match(FRAG_RE);
    if (fm) {
      statements.push({ kind: 'fragment', keyword: fm[1].toLowerCase(), label: fm[2] ?? '' });
      continue;
    }
    const am = line.match(ACT_RE);
    if (am) {
      ensureParticipant(am[2].trim());
      statements.push({ kind: am[1].toLowerCase() === 'activate' ? 'activate' : 'deactivate', actor: am[2].trim() });
      continue;
    }
    // 未模型化 → 逐字保留(不丟資料)。
    statements.push({ kind: 'raw', text: line });
  }

  const participants = order.map((id) => partsById.get(id) as SeqParticipant);
  // 參與者鏡像成 nodes(供選取 / rename)。座標 = 渲染器的「頂端參與者框」欄位佈局,
  // 兩者一致 → 命中測試 / 選取框與畫面對齊(GAP/HEAD_Y/HEAD_H 須與 scene-renderer 同步)。
  const GAP = 56;
  let px = 40;
  const nodes: SceneNode[] = participants.map((p, i) => {
    const w = Math.max(96, p.label.length * 9 + 28);
    const node: SceneNode = {
      id: p.id,
      shape: p.actor ? 'actor' : 'participant',
      label: p.label,
      x: px,
      y: 12,
      w,
      h: 40,
      data: { kind: 'sequence', actor: p.actor },
      sourceIndex: i,
    };
    px += w + GAP;
    return node;
  });

  return {
    scene: {
      version: 1,
      diagramType: 'sequence',
      meta: { type: 'sequence', autonumber },
      nodes,
      edges: [],
      containers: [],
      sequence: { autonumber, participants, statements },
      frontmatter,
      raw: { comments },
      layoutOwner: 'engine',
    },
    warnings,
  };
}
