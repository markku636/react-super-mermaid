// flowchart 語法的單一雙向真相來源:shape ↔ bracket、arrow ↔ 連線語法。
// parse 與 serialize 都引用同一張表,避免兩邊漂移。

import type { ArrowHead, LineKind, NodeShape } from '../../scene/types';

/** 節點外形 → 包裹括號(serialize 用)。`{left}LABEL{right}`。 */
export interface ShapeBrackets {
  left: string;
  right: string;
}

/** Scene NodeShape → mermaid 括號。順序即 serialize 偏好。 */
export const SHAPE_TO_BRACKETS: Record<string, ShapeBrackets> = {
  rectangle: { left: '[', right: ']' },
  rounded: { left: '(', right: ')' },
  stadium: { left: '([', right: '])' },
  subroutine: { left: '[[', right: ']]' },
  cylinder: { left: '[(', right: ')]' },
  circle: { left: '((', right: '))' },
  doubleCircle: { left: '(((', right: ')))' },
  diamond: { left: '{', right: '}' },
  hexagon: { left: '{{', right: '}}' },
  odd: { left: '>', right: ']' },
  trapezoid: { left: '[/', right: '\\]' },
  trapezoidAlt: { left: '[\\', right: '/]' },
  parallelogram: { left: '[/', right: '/]' },
  parallelogramAlt: { left: '[\\', right: '\\]' },
  ellipse: { left: '(-', right: '-)' },
};

/**
 * mermaid FlowVertex.type → Scene NodeShape(parse 用)。
 * 對映 mermaid 的 FlowVertexTypeParam 詞彙表。
 */
export const FLOW_TYPE_TO_SHAPE: Record<string, NodeShape> = {
  square: 'rectangle',
  rect: 'rectangle',
  round: 'rounded',
  stadium: 'stadium',
  subroutine: 'subroutine',
  cylinder: 'cylinder',
  circle: 'circle',
  doublecircle: 'doubleCircle',
  diamond: 'diamond',
  hexagon: 'hexagon',
  odd: 'odd',
  trapezoid: 'trapezoid',
  inv_trapezoid: 'trapezoidAlt',
  lean_right: 'parallelogram',
  lean_left: 'parallelogramAlt',
  ellipse: 'ellipse',
};

export function shapeFromFlowType(type: string | undefined): NodeShape {
  if (!type) return 'rectangle';
  return FLOW_TYPE_TO_SHAPE[type] ?? 'rectangle';
}

// ── 箭頭 / 線條 ──
//
// mermaid 連線由「線體 + 端頭」組成:
//   線體: --(normal) / ==(thick) / -.(dotted) / ~~~(invisible)
//   端頭: >(arrow) / o(circle/dot) / x(cross) / 無(open)
// serialize 由 lineKind + arrowStart/arrowEnd 組出語法字串。

/** 線體基礎符號(無端頭時的「無箭頭」線)。 */
const LINE_BODY: Record<LineKind, { mid: string; plain: string }> = {
  // mid = 帶箭頭時的線體(接端頭符號前的部分);plain = 無箭頭整條線。
  solid: { mid: '--', plain: '---' },
  thick: { mid: '==', plain: '===' },
  dotted: { mid: '-.', plain: '-.-' },
  invisible: { mid: '~~', plain: '~~~' },
};

const HEAD_SYMBOL: Partial<Record<ArrowHead, string>> = {
  arrow: '>',
  dot: 'o',
  cross: 'x',
};

/**
 * 組出 source→target 的連線運算子(不含 label)。
 * 例:solid+arrowEnd=arrow → `-->`;dotted+arrow → `-.->`;thick+arrow → `==>`;
 *     solid+none → `---`;solid+dot → `--o`;雙向 arrow → `<-->`。
 */
export function buildLinkOperator(edge: {
  lineKind: LineKind;
  arrowStart: ArrowHead;
  arrowEnd: ArrowHead;
  minLen?: number;
}): string {
  const body = LINE_BODY[edge.lineKind];
  const startSym = HEAD_SYMBOL[edge.arrowStart] ?? '';
  const endSym = HEAD_SYMBOL[edge.arrowEnd] ?? '';
  const hasHead = Boolean(startSym || endSym);
  // 額外秩距:minLen=2 → 多一節線體(mermaid 用線長控制 rank 距離)。
  const extra = Math.max(0, (edge.minLen ?? 1) - 1);

  if (!hasHead) {
    // 無箭頭:用 plain 線體,依秩距加長。
    const seg = body.plain;
    if (edge.lineKind === 'dotted') {
      // 點線無箭頭:-.- / -..- …
      return '-' + '.'.repeat(1 + extra) + '-';
    }
    return seg + body.mid[0].repeat(extra);
  }

  // 有箭頭:startSym + 線體 + endSym;加長線體表示秩距。
  // 點線帶箭頭的合法 mermaid 是 `-.->`(dash-dot-dash-head),故線體需為 `-.-`(收尾補 dash)。
  let mid = body.mid;
  if (edge.lineKind === 'dotted') {
    mid = '-' + '.'.repeat(1 + extra) + '-';
  } else {
    mid = body.mid + body.mid[body.mid.length - 1].repeat(extra);
  }
  return `${startSym}${mid}${endSym}`;
}

/**
 * 由 mermaid FlowEdge 的 {type, stroke, length} 重建 Scene 箭頭描述(parse 用)。
 * stroke: 'normal'|'thick'|'dotted'|'invisible';type 編碼端頭。
 */
export function arrowFromFlowEdge(edge: {
  type?: string;
  stroke?: string;
  length?: number;
}): { lineKind: LineKind; arrowStart: ArrowHead; arrowEnd: ArrowHead; minLen: number } {
  const lineKind: LineKind =
    edge.stroke === 'thick'
      ? 'thick'
      : edge.stroke === 'dotted'
        ? 'dotted'
        : edge.stroke === 'invisible'
          ? 'invisible'
          : 'solid';

  const type = edge.type ?? 'arrow_point';
  // mermaid type 命名:arrow_point(>) / arrow_circle(o) / arrow_cross(x) / arrow_open(無端頭)
  // 雙向以 double_ 前綴或兩端同符號表示。
  let arrowEnd: ArrowHead = 'arrow';
  let arrowStart: ArrowHead = 'none';
  const headOf = (s: string): ArrowHead =>
    s.includes('circle') ? 'dot' : s.includes('cross') ? 'cross' : s.includes('open') ? 'open' : 'arrow';

  if (type.startsWith('double_') || type.startsWith('arrow_double')) {
    const h = headOf(type);
    arrowStart = h;
    arrowEnd = h;
  } else if (type.includes('open')) {
    arrowEnd = 'open';
  } else {
    arrowEnd = headOf(type);
  }

  return { lineKind, arrowStart, arrowEnd, minLen: Math.max(1, edge.length ?? 1) };
}
