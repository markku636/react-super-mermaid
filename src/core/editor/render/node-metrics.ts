// 節點「內容需要多大」的單一真相。
//
// class 框與 ER 實體框的隔間(標題列 / 成員列 / 屬性列)是本編輯器自己畫的,尺寸只有這裡算得準。
// 先前有三份各自為政的估算:parse 時一份、controller 結構化編輯提交時一份,而排版階段又直接
// 沿用 mermaid dagre 量出來的節點框 —— mermaid 是用它自己的字型與內距量的,結果框比內容高一大截,
// 畫面上每個類別框 / 實體框底下都浮一塊死白。這裡集中定義,排版後也用它把尺寸校正回來。
//
// 常數對齊 scene-renderer 的 fillClassBox / fillErEntity 內聯樣式;改那邊的 padding / font 要一起改。

import type { ErAttribute, NodeData, RequirementData, SceneNode } from '../scene/types';

/** 全形(CJK / 全形標點)視為 1em,其餘約 0.55em。用於免 DOM 的文字寬度估算。 */
const WIDE = /[ᄀ-ᅟ⺀-鿿가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

export function textWidth(text: string, fontPx: number): number {
  let w = 0;
  for (const ch of text) w += WIDE.test(ch) ? fontPx : fontPx * 0.55;
  return w;
}

const widest = (rows: string[], fontPx: number): number =>
  rows.reduce((m, r) => Math.max(m, textWidth(r, fontPx)), 0);

// ── class ──────────────────────────────────────────────────────────────────
const CLASS_TITLE_FONT = 12;
const CLASS_ROW_FONT = 12;
const CLASS_LINE = 1.45;
const CLASS_TITLE_H = Math.round(CLASS_TITLE_FONT * CLASS_LINE) + 8; // padding 4px 上下
const CLASS_ROW_H = Math.round(CLASS_ROW_FONT * CLASS_LINE);
const CLASS_SECTION_PAD = 6; // padding 3px 上下
const CLASS_PAD_X = 16 + 10; // padding 8px 左右 + 一點寬鬆

export interface ClassBody {
  members?: string[];
  methods?: string[];
  stereotype?: string;
  generic?: string;
}

export function classBoxSize(label: string, body: ClassBody | undefined): { w: number; h: number } {
  const members = body?.members ?? [];
  const methods = body?.methods ?? [];
  const titleText = body?.generic ? `${label}<${body.generic}>` : label;
  const titleLines = body?.stereotype ? 2 : 1;
  const w = Math.max(
    92,
    Math.ceil(
      Math.max(
        textWidth(titleText, CLASS_TITLE_FONT) + 4,
        textWidth(body?.stereotype ? `«${body.stereotype}»` : '', CLASS_TITLE_FONT),
        widest([...members, ...methods], CLASS_ROW_FONT),
      ) + CLASS_PAD_X,
    ),
  );
  let h = CLASS_TITLE_H + (titleLines - 1) * CLASS_ROW_H;
  if (members.length) h += CLASS_SECTION_PAD + members.length * CLASS_ROW_H;
  if (methods.length) h += CLASS_SECTION_PAD + methods.length * CLASS_ROW_H;
  // 只有標題的類別:留一點呼吸空間,但不要留出一整個空隔間。
  if (!members.length && !methods.length) h += 8;
  return { w, h: Math.ceil(h) + 2 };
}

// ── ER ─────────────────────────────────────────────────────────────────────
const ER_TITLE_FONT = 13;
const ER_ROW_FONT = 12;
const ER_TITLE_H = Math.round(ER_TITLE_FONT * 1.4) + 10; // padding 5px 上下
const ER_ROW_H = 20; // 對齊 fillErEntity 的 min-height
const ER_PAD_X = 16 + 10;

export function erEntitySize(label: string, attributes: readonly ErAttribute[]): { w: number; h: number } {
  const rows = attributes.map((a) => {
    const keys = a.keys && a.keys.length ? ` ${a.keys.join(',')}` : '';
    const comment = a.comment ? `  ${a.comment}` : '';
    return `${a.type ?? ''} ${a.name}${keys}${comment}`.trim();
  });
  const w = Math.max(
    104,
    Math.ceil(Math.max(textWidth(label, ER_TITLE_FONT) + 4, widest(rows, ER_ROW_FONT)) + ER_PAD_X),
  );
  const h = ER_TITLE_H + attributes.length * ER_ROW_H + (attributes.length ? 0 : 8);
  return { w, h: Math.ceil(h) + 2 };
}

// ── requirement ────────────────────────────────────────────────────────────
const REQ_TITLE_FONT = 12;
const REQ_ROW_FONT = 11;
const REQ_KIND_H = 15; // «Requirement» 那一行
const REQ_TITLE_H = Math.round(REQ_TITLE_FONT * 1.4) + 8;
const REQ_ROW_H = Math.round(REQ_ROW_FONT * 1.45) + 2;
const REQ_PAD_X = 16 + 12;

/** 需求框 / 元素框上要顯示的欄位列(渲染與量測共用,避免兩邊算出不同高度)。 */
export function requirementRows(req: RequirementData): string[] {
  if (req.element) {
    const rows = [`type: ${req.elementType ?? ''}`];
    if (req.docRef) rows.push(`docRef: ${req.docRef}`);
    return rows;
  }
  const rows: string[] = [];
  if (req.reqId) rows.push(`id: ${req.reqId}`);
  if (req.text) rows.push(`text: ${req.text}`);
  if (req.risk) rows.push(`risk: ${req.risk}`);
  if (req.verifyMethod) rows.push(`verify: ${req.verifyMethod}`);
  return rows;
}

/** 需求框上方的類別標示(mermaid 也是這樣畫的:«Requirement» / «Element»)。 */
export function requirementKind(req: RequirementData): string {
  if (req.element) return '«Element»';
  const spaced = req.reqType.replace(/([A-Z])/g, ' $1');
  return `«${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}»`;
}

export function requirementBoxSize(label: string, req: RequirementData): { w: number; h: number } {
  const rows = requirementRows(req);
  const kind = requirementKind(req);
  const w = Math.max(
    132,
    Math.min(
      320,
      Math.ceil(
        Math.max(
          textWidth(label, REQ_TITLE_FONT) + 4,
          textWidth(kind, REQ_ROW_FONT),
          widest(rows, REQ_ROW_FONT),
        ) + REQ_PAD_X,
      ),
    ),
  );
  const h = REQ_KIND_H + REQ_TITLE_H + (rows.length ? 6 + rows.length * REQ_ROW_H : 8);
  return { w, h: Math.ceil(h) + 2 };
}

// ── C4 ─────────────────────────────────────────────────────────────────────
const C4_W = 190;
const C4_TITLE_FONT = 13;
const C4_META_FONT = 10.5;
const C4_ROW = 15;

/** C4 元素框上的文字列(«型別» / 名稱 / [技術] / 說明);渲染與量測共用。 */
export function c4Lines(
  label: string,
  data: { c4Type: string; techn?: string; descr?: string },
): { kind: string; title: string; techn?: string; descr?: string } {
  const t = data.c4Type.replace(/^external_/, '').replace(/_/g, ' ');
  const ext = data.c4Type.startsWith('external_') ? ', external' : '';
  return {
    kind: `«${t}${ext}»`,
    title: label,
    techn: data.techn ? `[${data.techn}]` : undefined,
    descr: data.descr,
  };
}

/** 說明文字在固定寬度下大約會佔幾行(免 DOM 的粗估;寧可多算一行也不要被裁掉)。 */
function wrapRows(text: string | undefined, fontPx: number, innerW: number): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(textWidth(text, fontPx) / innerW));
}

export function c4BoxSize(
  label: string,
  data: { c4Type: string; techn?: string; descr?: string },
): { w: number; h: number } {
  const parts = c4Lines(label, data);
  const w = Math.max(C4_W, Math.ceil(textWidth(label, C4_TITLE_FONT) + 32));
  const inner = w - 24;
  // 人物圖示頂端多留一點高度(頭像圓)。圓半徑 10 + 上緣 2 → 內容從 y=20 起算,
  // 這裡只需補上圓突出框內的那一段,補太多框上方就會空一塊。
  const head = data.c4Type.includes('person') ? 20 : 0;
  const rows =
    wrapRows(parts.kind, C4_META_FONT, inner) +
    wrapRows(parts.title, C4_TITLE_FONT, inner) +
    wrapRows(parts.techn, C4_META_FONT, inner) +
    wrapRows(parts.descr, C4_META_FONT, inner);
  return { w, h: Math.max(74, head + 16 + rows * C4_ROW) };
}

/**
 * 依節點內容算出它「該有」的尺寸。只有隔間框(class / er / requirement)有自己的內容模型;
 * 其餘外形交給排版引擎 / 使用者拖曳決定,回傳 null 表示「不要動它」。
 */
export function contentSize(node: { label: string; data?: NodeData }): { w: number; h: number } | null {
  const d = node.data;
  if (d?.kind === 'class') return classBoxSize(node.label, d);
  if (d?.kind === 'er') return erEntitySize(node.label, d.attributes);
  if (d?.kind === 'requirement') return requirementBoxSize(node.label, d.req);
  if (d?.kind === 'c4') return c4BoxSize(node.label, d);
  return null;
}

/** 把一個節點的尺寸校正成內容尺寸,並維持原本的中心點(排版引擎給的位置不變)。 */
export function fitToContent(node: SceneNode): SceneNode {
  const size = contentSize(node);
  if (!size) return node;
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  return { ...node, x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h };
}
