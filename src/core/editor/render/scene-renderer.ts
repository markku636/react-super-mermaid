// 增量場景渲染器:把 EditorScene 畫成手繪 SVG。
// 節點用 rough.js(快取 Drawable,幾何不變只改 transform);邊每次重建(成本低)。
// 互動層拖曳時呼叫 previewMove() 只改 transform + 重繞入射邊,放手後才 render() 重 rough。

import rough from 'roughjs';
import { ensureSketchFont } from '../../themes/sketch';
import { boundingBox } from '../scene/geometry';
import { containerRect, moveNodes } from '../scene/scene-ops';
import type { EditorScene, SceneContainer, SceneNode } from '../scene/types';
import { appendInlineMarkdown, svgEl, XHTML_NS } from './dom';
import { renderEdge, buildMarkers, markerIdFor, updateEdgeGeometry } from './edges';
import { INK, INK_DARK, clusterByIndex, paletteByIndex, seedFor } from './palette';
import { c4Lines, requirementKind, requirementRows, textWidth } from './node-metrics';
import { archIconGroup } from './arch-icon';
import { PLOT, quadrantRects } from '../round-trip/quadrant/model';
import { PIE as PIE_GEO, angleOf as pieAngleOf, sliceAngles as pieSliceAngles } from '../round-trip/pie';
import { XY as XY_PLOT, bandX as xyBandX, yToValue as xyYToValue } from '../round-trip/xychart';
import { BIT as PACKET_BIT } from '../round-trip/packet';
import { CELL as BLOCK_CELL } from '../round-trip/block';
import { DAY_W as GANTT_DAY_W, ORIGIN as GANTT_ORIGIN, ROW_H as GANTT_ROW_H, formatDay as ganttFormatDay } from '../round-trip/gantt/model';

import { GIT, gitLaneIndexAt, gitgraphLinks } from '../round-trip/gitgraph';

/** 甘特圖的版面常數(集中成一個物件,渲染這邊讀起來比一串同名 import 清楚)。 */
const GANTT = { DAY_W: GANTT_DAY_W, ROW_H: GANTT_ROW_H, ORIGIN: GANTT_ORIGIN } as const;

/** 用「泳道」呈現的圖種:容器框要可被點到(改名 / 刪除),其餘圖種維持穿透。 */
const LANE_DIAGRAMS = new Set(['kanban', 'journey', 'gitgraph']);

/** 中日韓字元(含全形標點)。 */
const CJK_RE = /[　-鿿豈-﫿＀-￯]/;

/**
 * 直排的軸標籤。
 *
 * 中日韓文字轉 90 度會整排「躺著」—— 直排的正確排法是每個字立著往下疊,所以 CJK 走
 * writing-mode,西文才維持由下往上轉的慣例。象限圖與 xychart 兩邊共用同一個判斷。
 */
function verticalAxisText(
  s: string,
  x: number,
  y: number,
  ink: string,
  font: string,
  anchor: string,
): SVGElement {
  const cjk = CJK_RE.test(s);
  const t = svgEl('text', {
    x,
    y,
    fill: ink,
    'text-anchor': anchor,
    'dominant-baseline': 'middle',
    style:
      `font:${font} var(--rsm-editor-font);opacity:0.7;pointer-events:none;` +
      (cjk ? 'writing-mode:vertical-rl;text-orientation:upright;letter-spacing:1px;' : ''),
    ...(cjk ? {} : { transform: `rotate(-90 ${x} ${y})` }),
  });
  t.textContent = s;
  return t;
}
import { buildNodeDrawables, type RoughGeneratorLike, type RoughPathInfo } from './shapes';

/** 'sketch' = Excalidraw 手繪抖動;'clean' = 俐落圓角 + 柔和陰影(貼近 colorful 主題)。 */
export type EditorLook = 'sketch' | 'clean';

export interface SceneRendererOptions {
  dark?: boolean;
  seed?: number;
  fontUrl?: string;
  look?: EditorLook;
}

interface NodeCache {
  g: SVGGElement;
  geomKey: string;
  labelKey: string;
}

const NODE_SHADOW_ID = 'rsm-node-shadow';

const ROUGH_LOOKS: Record<EditorLook, { roughness: number; bowing: number; strokeWidth: number; fillStyle: 'solid' }> = {
  sketch: { roughness: 1.05, bowing: 0.8, strokeWidth: 1.6, fillStyle: 'solid' },
  clean: { roughness: 0, bowing: 0, strokeWidth: 1.5, fillStyle: 'solid' },
};

export class SceneRenderer {
  private gen: RoughGeneratorLike;
  private dark: boolean;
  private baseSeed: number;
  private fontUrl?: string;
  private look: EditorLook;

  private defs!: SVGDefsElement;
  private frameLayer!: SVGGElement;
  private containersLayer!: SVGGElement;
  edgesLayer!: SVGGElement;
  nodesLayer!: SVGGElement;
  overlayLayer!: SVGGElement;

  private nodeCache = new Map<string, NodeCache>();
  private edgeEls = new Map<string, SVGGElement>();
  private scene: EditorScene | null = null;
  /** 上一次渲染走的是 sequence 路徑(直接寫入 layers、不經 nodeCache)。切換到非 sequence 圖種時,
   *  diff 渲染靠 nodeCache 找不到這些殘留元素,需先強制清空 layers,否則上一張圖會疊著留下來。 */
  private renderedSequence = false;
  /** sequence:訊息陳述 index → 世界座標矩形(供雙擊編輯訊息文字定位)。 */
  private seqMsgRects = new Map<number, { x: number; y: number; w: number; h: number }>();
  /** sequence:整張圖的世界座標範圍(供 fit;sequence 內容延伸到節點下方,不能只用節點 bbox)。 */
  private seqBounds: { x: number; y: number; w: number; h: number } | null = null;

  /** 取得 sequence 訊息的世界座標矩形(host 開啟文字編輯器定位、拖曳換序時畫選取框用)。 */
  getSeqMsgRect(index: number): { x: number; y: number; w: number; h: number } | undefined {
    return this.seqMsgRects.get(index);
  }

  /** sequence / quadrant 模式下的整張圖範圍(供 fit 用);其他圖種回 null(改用節點 bbox)。 */
  getContentBounds(): { x: number; y: number; w: number; h: number } | null {
    return this.seqBounds;
  }

  /** quadrant:繪圖區的世界座標(含四周軸標籤留白),供 fit 用。 */
  private static quadrantBounds(): { x: number; y: number; w: number; h: number } {
    return { x: PLOT.x - 70, y: PLOT.y - 50, w: PLOT.w + 110, h: PLOT.h + 100 };
  }

  constructor(opts: SceneRendererOptions = {}) {
    this.gen = (rough as unknown as { generator(): RoughGeneratorLike }).generator();
    this.dark = opts.dark ?? false;
    this.baseSeed = opts.seed ?? 42;
    this.fontUrl = opts.fontUrl;
    this.look = opts.look ?? 'sketch';
  }

  /** clean 風的柔和陰影濾鏡(貼近 colorful 主題的卡片陰影)。 */
  private appendShadowFilter(): void {
    const sh = svgEl('filter', { id: NODE_SHADOW_ID, x: '-40%', y: '-40%', width: '180%', height: '180%' });
    // 柔和投影:暗色下原本純黑 0.55 + 模糊不足 → 像一塊醜黑塊。改用偏藍黑、低不透明、加大模糊。
    const fd = svgEl('feDropShadow', {
      dx: 0,
      dy: 1.5,
      stdDeviation: this.dark ? 6 : 4,
      'flood-color': this.dark ? '#0b1220' : '#1e293b',
      'flood-opacity': this.dark ? '0.28' : '0.14',
    });
    sh.appendChild(fd);
    this.defs.appendChild(sh);
  }

  /** 建立圖層結構於 parent(編輯器的 viewport <g>)內。 */
  mount(parent: SVGElement): void {
    void ensureSketchFont(this.fontUrl);
    this.defs = svgEl('defs');
    for (const m of buildMarkers(this.dark)) this.defs.appendChild(m);
    if (this.look === 'clean') this.appendShadowFilter();
    // 圖表外框(象限圖等「有背景的圖種」)。壓在最底層,不參與節點 / 容器的差異渲染。
    this.frameLayer = svgEl('g', { class: 'rsm-frame' });
    this.containersLayer = svgEl('g', { class: 'rsm-containers' });
    this.edgesLayer = svgEl('g', { class: 'rsm-edges' });
    this.nodesLayer = svgEl('g', { class: 'rsm-nodes' });
    this.overlayLayer = svgEl('g', { class: 'rsm-overlay' });
    parent.appendChild(this.defs);
    parent.appendChild(this.frameLayer);
    parent.appendChild(this.containersLayer);
    parent.appendChild(this.edgesLayer);
    parent.appendChild(this.nodesLayer);
    parent.appendChild(this.overlayLayer);
  }

  setDark(dark: boolean): void {
    if (dark === this.dark) return;
    this.dark = dark;
    // 重建 markers + 全部重畫。
    while (this.defs.firstChild) this.defs.removeChild(this.defs.firstChild);
    for (const m of buildMarkers(this.dark)) this.defs.appendChild(m);
    if (this.look === 'clean') this.appendShadowFilter();
    this.nodeCache.clear();
    while (this.nodesLayer.firstChild) this.nodesLayer.removeChild(this.nodesLayer.firstChild);
    if (this.scene) this.render(this.scene);
  }

  getLook(): EditorLook {
    return this.look;
  }

  /** 切換手繪(sketch)/ 簡潔(clean)風:重建 defs(陰影只 clean 用)+ 清快取全部重畫。 */
  setLook(look: EditorLook): void {
    if (look === this.look) return;
    this.look = look;
    while (this.defs.firstChild) this.defs.removeChild(this.defs.firstChild);
    for (const m of buildMarkers(this.dark)) this.defs.appendChild(m);
    if (this.look === 'clean') this.appendShadowFilter();
    this.nodeCache.clear();
    while (this.nodesLayer.firstChild) this.nodesLayer.removeChild(this.nodesLayer.firstChild);
    if (this.scene) this.render(this.scene);
  }

  private buildNodeGroup(node: SceneNode): SVGGElement {
    const g = svgEl('g', { 'data-node-id': node.id, class: 'rsm-node' });
    g.setAttribute('transform', `translate(${node.x},${node.y})`);
    this.fillNodeContent(g, node);
    return g;
  }

  private fillNodeContent(g: SVGGElement, node: SceneNode): void {
    while (g.firstChild) g.removeChild(g.firstChild);
    // 透明 hit rect(rough 線條有縫,確保整個 bbox 可點)。
    const hit = svgEl('rect', { x: 0, y: 0, width: node.w, height: node.h, fill: 'transparent', rx: 6 });
    hit.style.cursor = 'move';
    g.appendChild(hit);

    // 資料點 / 扇形把手:不走外形 + 手繪那一套。它們不是「框」,外形描邊只會多畫一個
    // 沒有意義的方框(圓餅圖的把手尤其明顯:文字外面憑空多一個框)。
    if (node.data?.kind === 'quadrant') {
      this.fillQuadrantPoint(g, node);
      return;
    }
    if (node.data?.kind === 'pie') {
      this.fillPieSlice(g, node);
      return;
    }
    if (node.data?.kind === 'xy') {
      this.fillXyPoint(g, node);
      return;
    }
    if (node.data?.kind === 'architecture') {
      this.fillArchNode(g, node);
      return;
    }
    if (node.data?.kind === 'packet') {
      this.fillPacketField(g, node);
      return;
    }
    if (node.data?.kind === 'gitgraph') {
      this.fillGitCommit(g, node);
      return;
    }
    // 泳道卡片與甘特長條也是自己畫底框的:再讓 rough 畫一次同尺寸的框,四個角就會露出
    // 手繪筆觸多出來的那一小截,看起來像卡片破角。
    if (node.data?.kind === 'gantt') {
      this.fillGanttBar(g, node);
      return;
    }
    if (node.data?.kind === 'kanban' || node.data?.kind === 'journey') {
      this.fillKanbanCard(g, node);
      return;
    }

    // 依節點順序循序取色(非 hash),相鄰節點配色和諧。
    const idx = this.scene ? this.scene.nodes.findIndex((n) => n.id === node.id) : 0;
    // 偽狀態(起點 / 終點 / 分岔匯合)是「記號」不是「狀態」,mermaid 一律畫成墨色實心。
    // 讓它們跟著彩色輪盤走會冒出藍色起點、紫色終點,看起來像三個地位相同的狀態。
    const isPseudo = node.shape === 'stateStart' || node.shape === 'stateEnd' || node.shape === 'fork';
    const ink = this.dark ? INK_DARK : INK;
    const pal = isPseudo ? { fill: ink, stroke: ink } : paletteByIndex(idx >= 0 ? idx : 0);
    const opts = {
      ...ROUGH_LOOKS[this.look],
      seed: seedFor(node.id, this.baseSeed),
      stroke: node.style?.stroke ?? pal.stroke,
      strokeWidth: node.style?.strokeWidth ?? ROUGH_LOOKS[this.look].strokeWidth,
      fill: node.style?.fill ?? pal.fill,
    };
    const dash = node.style?.strokeDasharray;
    // 形狀畫進子群組;clean 風的柔和陰影只套形狀(不套文字,文字才清晰銳利)。
    const shapesG = svgEl('g', { class: 'rsm-node-shapes' });
    if (this.look === 'clean') shapesG.style.filter = `url(#${NODE_SHADOW_ID})`;
    // clean 風把直角方框畫成圓角,視覺更貼近 colorful 主題。
    const shape = this.look === 'clean' && node.shape === 'rectangle' ? 'rounded' : node.shape;
    for (const drawable of buildNodeDrawables(this.gen, shape, node.w, node.h, opts)) {
      for (const pi of this.gen.toPaths(drawable) as RoughPathInfo[]) {
        const isFill = pi.fill && pi.fill !== 'none';
        const path = svgEl('path', { d: pi.d });
        if (isFill) {
          path.setAttribute('fill', pi.fill as string);
          path.setAttribute('stroke', 'none');
        } else {
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', pi.stroke);
          path.setAttribute('stroke-width', String(pi.strokeWidth));
          path.setAttribute('vector-effect', 'non-scaling-stroke');
          if (dash) path.setAttribute('stroke-dasharray', dash);
        }
        path.style.pointerEvents = 'none';
        shapesG.appendChild(path);
      }
    }
    g.appendChild(shapesG);

    // ER 實體 / class:多隔間框(標題列 + 屬性/成員列),貼近「Edit Diagram」預覽外觀。
    if (node.data?.kind === 'er') {
      this.fillErEntity(g, node);
      return;
    }
    if (node.data?.kind === 'class') {
      this.fillClassBox(g, node);
      return;
    }
    if (node.data?.kind === 'requirement') {
      this.fillRequirementBox(g, node);
      return;
    }
    if (node.data?.kind === 'c4') {
      this.fillC4Box(g, node);
      return;
    }

    // label foreignObject(置中):預設深色墨字(節點底色多為淺色);classDef/style 指定 color 時尊重之
    // (例如深底 fill + color:#fff)。
    if (node.label) {
      const fo = svgEl('foreignObject', { x: 0, y: 0, width: node.w, height: node.h });
      fo.style.pointerEvents = 'none';
      const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
      if (node.labelKind === 'markdown') appendInlineMarkdown(div, node.label);
      else div.textContent = node.label.replace(/<br\s*\/?>/g, '\n');
      const textColor = node.style?.color ?? INK;
      div.setAttribute(
        'style',
        'display:flex;align-items:center;justify-content:center;width:100%;height:100%;' +
          'box-sizing:border-box;padding:4px 8px;font:600 14px/1.3 var(--rsm-editor-font);' +
          `color:${textColor};text-align:center;white-space:pre-wrap;word-break:break-word;overflow:hidden;`,
      );
      fo.appendChild(div as unknown as Node);
      g.appendChild(fo);
    }
  }

  /** ER 實體框:標題列(實體名)+ 屬性列。外框矩形已由 fillNodeContent 畫好,這裡疊內容。 */
  private fillErEntity(g: SVGGElement, node: SceneNode): void {
    const attrs = node.data?.kind === 'er' ? node.data.attributes : [];
    const fo = svgEl('foreignObject', { x: 0, y: 0, width: node.w, height: node.h });
    fo.style.pointerEvents = 'none';
    const root = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    root.setAttribute(
      'style',
      'display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;' +
        `overflow:hidden;font:13px/1.4 var(--rsm-editor-font);color:${INK};`,
    );
    const title = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    title.textContent = node.label;
    title.setAttribute(
      'style',
      // 沒有屬性就不畫分隔線 —— 否則框裡會多出一格空隔間(mermaid 對無屬性的實體也只畫一個名稱框)。
      `font-weight:700;text-align:center;padding:5px 8px;${attrs.length ? `border-bottom:1px solid ${INK};` : ''}` +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
    );
    root.appendChild(title as unknown as Node);
    if (attrs.length) {
      // 屬性以「表格列」呈現:平均分配高度填滿框體(對齊 mermaid 把框撐高的尺寸),列間細分隔線。
      const body = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
      body.setAttribute('style', 'flex:1;display:flex;flex-direction:column;overflow:hidden;');
      attrs.forEach((a, i) => {
        const row = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
        const keys = a.keys && a.keys.length ? ` ${a.keys.join(',')}` : '';
        row.textContent = `${a.type ?? ''} ${a.name}${keys}`.trim();
        row.setAttribute(
          'style',
          'flex:1;display:flex;align-items:center;padding:0 8px;min-height:20px;font-size:12px;' +
            `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${i > 0 ? `border-top:1px solid ${INK}22;` : ''}`,
        );
        // 屬性備註(description)以淡色斜體附在後面,對齊 mermaid ER 的備註欄。
        if (a.comment) {
          const c = document.createElementNS(XHTML_NS, 'span') as unknown as HTMLSpanElement;
          c.textContent = `  ${a.comment}`;
          c.setAttribute('style', 'opacity:0.55;font-style:italic;');
          row.appendChild(c as unknown as Node);
        }
        body.appendChild(row as unknown as Node);
      });
      root.appendChild(body as unknown as Node);
    }
    fo.appendChild(root as unknown as Node);
    g.appendChild(fo);
  }

  /** class 框:標題(+«stereotype»)/ 成員 / 方法 三隔間,以分隔線區隔。 */
  private fillClassBox(g: SVGGElement, node: SceneNode): void {
    const data = node.data?.kind === 'class' ? node.data : undefined;
    const fo = svgEl('foreignObject', { x: 0, y: 0, width: node.w, height: node.h });
    fo.style.pointerEvents = 'none';
    const root = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    root.setAttribute(
      'style',
      'display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;' +
        `overflow:hidden;font:12px/1.45 var(--rsm-editor-font);color:${INK};`,
    );
    const mkSection = (style: string): HTMLDivElement => {
      const d = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
      d.setAttribute('style', style);
      return d;
    };
    // mermaid 泛型語法 ~T~ 在顯示時呈現為 <T>(序列化仍保留 ~T~)。
    const genericDisplay = (s: string): string => s.replace(/~([^~]+)~/g, '<$1>');
    // 沒有成員也沒有方法就不畫分隔線 —— 否則只有類別名的框裡會多出一整格空隔間。
    const hasBody = (data?.members?.length ?? 0) > 0 || (data?.methods?.length ?? 0) > 0;
    const title = mkSection(
      `font-weight:700;text-align:center;padding:4px 8px;${hasBody ? `border-bottom:1px solid ${INK};` : ''}white-space:pre-wrap;`,
    );
    const nameWithGeneric = data?.generic ? `${node.label}~${data.generic}~` : node.label;
    title.textContent = (data?.stereotype ? `«${data.stereotype}»\n` : '') + genericDisplay(nameWithGeneric);
    root.appendChild(title as unknown as Node);
    const addRows = (rows: string[], borderTop: boolean, fill: boolean): void => {
      if (!rows.length) return;
      // 最後一個隔間 flex:1 撐到框底(UML 標準外觀,消除框底浮空空白)。
      const sec = mkSection(
        `flex:${fill ? '1 1 auto' : '0 0 auto'};padding:3px 8px;${borderTop ? `border-top:1px solid ${INK};` : ''}`,
      );
      for (const r of rows) {
        const row = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
        // classifier:抽象(*)→ 斜體、靜態($)→ 底線(UML 慣例),顯示時去掉標記。
        let text = r;
        let extra = '';
        const afterParen = text.match(/\)([*$])(\s|$)/);
        const trailing = afterParen ? null : text.match(/([*$])\s*$/);
        const mark = afterParen?.[1] ?? trailing?.[1];
        if (mark === '*') extra = 'font-style:italic;';
        else if (mark === '$') extra = 'text-decoration:underline;';
        if (afterParen) text = text.replace(/\)[*$]/, ')');
        else if (trailing) text = text.replace(/[*$]\s*$/, '');
        row.textContent = genericDisplay(text);
        row.setAttribute('style', `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${extra}`);
        sec.appendChild(row as unknown as Node);
      }
      root.appendChild(sec as unknown as Node);
    };
    const hasMembers = (data?.members?.length ?? 0) > 0;
    const hasMethods = (data?.methods?.length ?? 0) > 0;
    addRows(data?.members ?? [], false, !hasMethods);
    addRows(data?.methods ?? [], hasMembers, true);
    fo.appendChild(root as unknown as Node);
    g.appendChild(fo);
  }

  /** 象限圖外框:四個象限底色 + 名稱、兩軸端點文字、中線、標題。 */
  private renderQuadrantFrame(scene: EditorScene): void {
    const meta = scene.meta.type === 'quadrant' ? scene.meta.quadrant : undefined;
    const ink = this.dark ? INK_DARK : INK;
    const g = this.frameLayer;
    const text = (
      s: string,
      x: number,
      y: number,
      opts: { size?: number; weight?: number; anchor?: string; opacity?: number } = {},
    ): void => {
      if (!s) return;
      const t = svgEl('text', {
        x,
        y,
        fill: ink,
        'text-anchor': opts.anchor ?? 'middle',
        'dominant-baseline': 'middle',
        style:
          `font:${opts.weight ?? 500} ${opts.size ?? 13}px var(--rsm-editor-font);` +
          `opacity:${opts.opacity ?? 0.85};pointer-events:none;`,
      });
      t.textContent = s;
      g.appendChild(t);
    };

    quadrantRects().forEach((r, i) => {
      // 用叢集色(飽和色的低透明度)而不是節點的淺色 fill:淺粉彩壓在深色底上會糊成一片灰褐,
      // 四個象限就分不出來了。叢集色本來就是為了「淺底深底都成立」設計的。
      const pal = clusterByIndex(i);
      g.appendChild(
        svgEl('rect', {
          x: r.x,
          y: r.y,
          width: r.w,
          height: r.h,
          fill: pal.fill,
          stroke: 'none',
        }),
      );
      // 象限名放在該象限的上緣內側,不會和資料點打架。
      text(meta?.quadrants[i] ?? '', r.x + r.w / 2, r.y + 20, { size: 14, weight: 600, opacity: 0.75 });
    });

    // 外框 + 十字中線。
    g.appendChild(
      svgEl('rect', {
        x: PLOT.x,
        y: PLOT.y,
        width: PLOT.w,
        height: PLOT.h,
        fill: 'none',
        stroke: ink,
        'stroke-opacity': 0.35,
      }),
    );
    for (const d of [
      `M${PLOT.x + PLOT.w / 2},${PLOT.y} L${PLOT.x + PLOT.w / 2},${PLOT.y + PLOT.h}`,
      `M${PLOT.x},${PLOT.y + PLOT.h / 2} L${PLOT.x + PLOT.w},${PLOT.y + PLOT.h / 2}`,
    ]) {
      g.appendChild(svgEl('path', { d, stroke: ink, 'stroke-opacity': 0.25, 'stroke-dasharray': '4 4', fill: 'none' }));
    }

    if (meta?.title) text(meta.title, PLOT.x + PLOT.w / 2, PLOT.y - 28, { size: 17, weight: 700, opacity: 1 });
    // x 軸:左右端文字置於下緣;y 軸:上下端文字直排於左緣。
    if (meta?.xAxis) {
      text(meta.xAxis.left, PLOT.x + 4, PLOT.y + PLOT.h + 22, { anchor: 'start', opacity: 0.7 });
      text(meta.xAxis.right ?? '', PLOT.x + PLOT.w - 4, PLOT.y + PLOT.h + 22, { anchor: 'end', opacity: 0.7 });
    }
    if (meta?.yAxis) {
      const rot = (s: string, y: number, anchor: string): void => {
        if (!s) return;
        g.appendChild(verticalAxisText(s, PLOT.x - 24, y, ink, '500 13px', anchor));
      };
      rot(meta.yAxis.bottom, PLOT.y + PLOT.h - 4, 'start');
      rot(meta.yAxis.top ?? '', PLOT.y + 4, 'end');
    }
  }

  /** 甘特圖外框:日期刻度 + 每日格線 + section 帶(長條本身是節點)。 */
  private renderGanttFrame(scene: EditorScene): void {
    const meta = scene.meta.type === 'gantt' ? scene.meta.gantt : undefined;
    const epoch = meta?.epoch ?? 0;
    const ink = this.dark ? INK_DARK : INK;
    const g = this.frameLayer;
    if (scene.nodes.length === 0) return;

    const right = Math.max(...scene.nodes.map((n) => n.x + n.w)) + GANTT.DAY_W * 2;
    const bottom = Math.max(...scene.nodes.map((n) => n.y + n.h)) + GANTT.ROW_H;
    const days = Math.ceil((right - GANTT.ORIGIN.x) / GANTT.DAY_W);
    const top = GANTT.ORIGIN.y - 26;

    // 每日格線 + 每 7 天標一次日期(每天都標會擠成一團)。
    for (let d = 0; d <= days; d += 1) {
      const x = GANTT.ORIGIN.x + d * GANTT.DAY_W;
      const week = d % 7 === 0;
      g.appendChild(
        svgEl('path', {
          d: `M${x},${top} L${x},${bottom}`,
          stroke: ink,
          'stroke-opacity': week ? 0.22 : 0.08,
          fill: 'none',
        }),
      );
      if (week) {
        const t = svgEl('text', {
          x,
          y: top - 8,
          fill: ink,
          'text-anchor': 'middle',
          style: 'font:500 11px var(--rsm-editor-font);opacity:0.7;pointer-events:none;',
        });
        t.textContent = ganttFormatDay(epoch + d * 86400000);
        g.appendChild(t);
      }
    }

    // section 帶:淡色底 + 左側名稱。
    [...scene.containers]
      .sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0))
      .forEach((c, i) => {
        const pal = clusterByIndex(i);
        g.appendChild(
          svgEl('rect', {
            x: GANTT.ORIGIN.x - 60,
            y: c.y,
            width: right - GANTT.ORIGIN.x + 60,
            height: c.h,
            fill: pal.fill,
            stroke: 'none',
            'data-container-id': c.id,
          }),
        );
        if (!c.label) return;
        const fo = svgEl('foreignObject', { x: GANTT.ORIGIN.x - 58, y: c.y + 2, width: 56, height: 20 });
        fo.style.pointerEvents = 'none';
        const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
        div.textContent = c.label;
        div.setAttribute(
          'style',
          `font:700 11px/20px var(--rsm-editor-font);color:${pal.stroke};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`,
        );
        fo.appendChild(div as unknown as Node);
        g.appendChild(fo);
      });

    if (meta?.title) {
      const t = svgEl('text', {
        x: GANTT.ORIGIN.x,
        y: top - 34,
        fill: ink,
        style: 'font:700 16px var(--rsm-editor-font);pointer-events:none;',
      });
      t.textContent = meta.title;
      g.appendChild(t);
    }
    this.seqBounds = {
      x: GANTT.ORIGIN.x - 80,
      y: top - 50,
      w: right - GANTT.ORIGIN.x + 120,
      h: bottom - top + 70,
    };
  }

  /** xychart 外框:座標軸 + 刻度 + 長條 / 折線(資料點本身是節點)。 */
  private renderXyFrame(scene: EditorScene): void {
    const meta = scene.meta.type === 'xychart' ? scene.meta.xy : undefined;
    if (!meta) return;
    const ink = this.dark ? INK_DARK : INK;
    const g = this.frameLayer;
    const n = Math.max(1, meta.categories.length);
    const pointOf = (si: number, i: number): SceneNode | undefined =>
      scene.nodes.find((x) => x.data?.kind === 'xy' && x.data.series === si && x.data.index === i);

    // 水平刻度線(5 等分)+ 值標。
    for (let k = 0; k <= 4; k += 1) {
      const y = XY_PLOT.y + (XY_PLOT.h * k) / 4;
      g.appendChild(
        svgEl('path', {
          d: `M${XY_PLOT.x},${y} L${XY_PLOT.x + XY_PLOT.w},${y}`,
          stroke: ink,
          'stroke-opacity': k === 4 ? 0.4 : 0.12,
          fill: 'none',
        }),
      );
      const t = svgEl('text', {
        x: XY_PLOT.x - 10,
        y,
        fill: ink,
        'text-anchor': 'end',
        'dominant-baseline': 'middle',
        style: 'font:500 11px var(--rsm-editor-font);opacity:0.65;pointer-events:none;',
      });
      t.textContent = String(Math.round((meta.yMax - ((meta.yMax - meta.yMin) * k) / 4) * 100) / 100);
      g.appendChild(t);
    }
    // 類別標籤。
    meta.categories.forEach((c, i) => {
      const t = svgEl('text', {
        x: xyBandX(i, n),
        y: XY_PLOT.y + XY_PLOT.h + 18,
        fill: ink,
        'text-anchor': 'middle',
        style: 'font:500 11px var(--rsm-editor-font);opacity:0.75;pointer-events:none;',
      });
      t.textContent = c;
      g.appendChild(t);
    });

    // 系列:bar 畫長條、line 畫折線(都直接吃節點目前的位置,所以拖曳當下就看得到結果)。
    const barSeries = meta.series.filter((s) => s.kind === 'bar').length;
    let barSlot = 0;
    meta.series.forEach((series, si) => {
      const pal = paletteByIndex(si);
      if (series.kind === 'bar') {
        const band = XY_PLOT.w / n;
        const bw = Math.max(6, (band * 0.62) / Math.max(1, barSeries));
        const offset = (barSlot - (barSeries - 1) / 2) * bw;
        barSlot += 1;
        series.values.forEach((_, i) => {
          const p = pointOf(si, i);
          if (!p) return;
          const cy = p.y + p.h / 2;
          const base = XY_PLOT.y + XY_PLOT.h;
          g.appendChild(
            svgEl('rect', {
              x: xyBandX(i, n) + offset - bw / 2,
              y: Math.min(cy, base),
              width: bw,
              height: Math.abs(base - cy),
              rx: 2,
              fill: pal.stroke,
              'fill-opacity': 0.75,
            }),
          );
        });
        return;
      }
      const pts = series.values
        .map((_, i) => pointOf(si, i))
        .filter((p): p is SceneNode => Boolean(p))
        .map((p) => `${p.x + p.w / 2},${p.y + p.h / 2}`);
      if (pts.length > 1) {
        g.appendChild(
          svgEl('path', {
            d: `M${pts.join(' L')}`,
            stroke: pal.stroke,
            'stroke-width': 2.4,
            fill: 'none',
            'stroke-linejoin': 'round',
          }),
        );
      }
    });

    if (meta.title) {
      const t = svgEl('text', {
        x: XY_PLOT.x + XY_PLOT.w / 2,
        y: XY_PLOT.y - 26,
        fill: ink,
        'text-anchor': 'middle',
        style: 'font:700 16px var(--rsm-editor-font);pointer-events:none;',
      });
      t.textContent = meta.title;
      g.appendChild(t);
    }
    // 兩軸的名稱原本解析進來就擱著沒畫 —— 少了它,「80」是萬元還是件數只能用猜的。
    if (meta.xTitle) {
      const t = svgEl('text', {
        x: XY_PLOT.x + XY_PLOT.w / 2,
        y: XY_PLOT.y + XY_PLOT.h + 46,
        fill: ink,
        'text-anchor': 'middle',
        style: 'font:600 12px var(--rsm-editor-font);opacity:0.72;pointer-events:none;',
      });
      t.textContent = meta.xTitle;
      g.appendChild(t);
    }
    if (meta.yTitle) {
      const cy = XY_PLOT.y + XY_PLOT.h / 2;
      g.appendChild(verticalAxisText(meta.yTitle, XY_PLOT.x - 54, cy, ink, '600 12px', 'middle'));
    }
    this.seqBounds = {
      x: XY_PLOT.x - 80,
      y: XY_PLOT.y - 50,
      w: XY_PLOT.w + 120,
      h: XY_PLOT.h + 116,
    };
  }

  /** xychart 資料點:小圓點 + 數值(值即位置,拖著就是在改它)。 */
  private fillXyPoint(g: SVGGElement, node: SceneNode): void {
    const meta = this.scene?.meta.type === 'xychart' ? this.scene.meta.xy : undefined;
    const si = node.data?.kind === 'xy' ? node.data.series : 0;
    const pal = paletteByIndex(si);
    g.appendChild(
      svgEl('circle', {
        cx: node.w / 2,
        cy: node.h / 2,
        r: 5.5,
        fill: pal.stroke,
        stroke: this.dark ? '#0b1220' : '#ffffff',
        'stroke-width': 2,
      }),
    );
    if (!meta) return;
    const value = xyYToValue(node.y + node.h / 2, meta.yMin, meta.yMax);
    const fo = svgEl('foreignObject', { x: -30 + node.w / 2, y: -16, width: 60, height: 16 });
    fo.style.pointerEvents = 'none';
    fo.style.overflow = 'visible';
    const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    div.textContent = String(value);
    div.setAttribute(
      'style',
      `text-align:center;font:600 11px/16px var(--rsm-editor-font);color:${this.dark ? INK_DARK : INK};white-space:nowrap;`,
    );
    fo.appendChild(div as unknown as Node);
    g.appendChild(fo);
  }

  /** 圓餅圖外框:標題 + 各扇形(扇形本身畫在這裡,節點只是它的質心把手)。 */
  private renderPieFrame(scene: EditorScene): void {
    const meta = scene.meta.type === 'pie' ? scene.meta : undefined;
    const ink = this.dark ? INK_DARK : INK;
    const g = this.frameLayer;
    // 順序由角度決定 —— 與序列化同一套判定,畫面才會等於存檔內容。
    const ordered = [...scene.nodes].sort(
      (a, b) => pieAngleOf(a.x + a.w / 2, a.y + a.h / 2) - pieAngleOf(b.x + b.w / 2, b.y + b.h / 2),
    );
    const values = ordered.map((n) => (n.data?.kind === 'pie' ? n.data.value : 0));
    const total = values.reduce((s, v) => s + Math.max(0, v), 0);
    const angles = pieSliceAngles(values);
    const arc = (from: number, to: number): string => {
      // 整圈用兩段半圓畫(單一 arc 起訖同點會退化成什麼都畫不出來)。
      if (to - from >= Math.PI * 2 - 1e-6) {
        return (
          `M${PIE_GEO.cx},${PIE_GEO.cy - PIE_GEO.r} A${PIE_GEO.r},${PIE_GEO.r} 0 1 1 ${PIE_GEO.cx},${PIE_GEO.cy + PIE_GEO.r}` +
          ` A${PIE_GEO.r},${PIE_GEO.r} 0 1 1 ${PIE_GEO.cx},${PIE_GEO.cy - PIE_GEO.r} Z`
        );
      }
      const x1 = PIE_GEO.cx + Math.cos(from) * PIE_GEO.r;
      const y1 = PIE_GEO.cy + Math.sin(from) * PIE_GEO.r;
      const x2 = PIE_GEO.cx + Math.cos(to) * PIE_GEO.r;
      const y2 = PIE_GEO.cy + Math.sin(to) * PIE_GEO.r;
      const large = to - from > Math.PI ? 1 : 0;
      return `M${PIE_GEO.cx},${PIE_GEO.cy} L${x1},${y1} A${PIE_GEO.r},${PIE_GEO.r} 0 ${large} 1 ${x2},${y2} Z`;
    };
    ordered.forEach((n, i) => {
      const pal = paletteByIndex(i);
      g.appendChild(
        svgEl('path', {
          d: arc(angles[i].from, angles[i].to),
          fill: pal.fill,
          stroke: this.dark ? '#23232e' : '#ffffff',
          'stroke-width': 2,
        }),
      );
    });
    if (meta?.title) {
      const t = svgEl('text', {
        x: PIE_GEO.cx,
        y: PIE_GEO.cy - PIE_GEO.r - 28,
        fill: ink,
        'text-anchor': 'middle',
        style: 'font:700 17px var(--rsm-editor-font);pointer-events:none;',
      });
      t.textContent = meta.title;
      g.appendChild(t);
    }
    // 百分比曾經另外標在扇形上,結果和把手上的「名稱 + 數值」幾乎疊在同一點。
    // 現在一律併進把手那一塊(見 fillPieSlice),一個扇形只有一處文字。
    void total;
    this.seqBounds = {
      x: PIE_GEO.cx - PIE_GEO.r - 60,
      y: PIE_GEO.cy - PIE_GEO.r - 60,
      w: PIE_GEO.r * 2 + 120,
      h: PIE_GEO.r * 2 + 110,
    };
  }

  /** 圓餅扇形的把手:名稱 + 數值 + 佔比,收在一枚白色小牌上(扇形本身畫在外框層)。 */
  private fillPieSlice(g: SVGGElement, node: SceneNode): void {
    const d = node.data?.kind === 'pie' ? node.data : undefined;
    const value = d?.value ?? 0;
    const total = (this.scene?.nodes ?? []).reduce(
      (s, n) => s + (n.data?.kind === 'pie' ? Math.max(0, n.data.value) : 0),
      0,
    );
    const share = total > 0 ? Math.round((Math.max(0, value) / total) * 1000) / 10 : null;
    const fo = svgEl('foreignObject', { x: -20, y: 0, width: node.w + 40, height: node.h });
    fo.style.pointerEvents = 'none';
    fo.style.overflow = 'visible';
    const wrap = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    wrap.setAttribute('style', 'display:flex;align-items:center;justify-content:center;height:100%;');
    const root = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    root.setAttribute(
      'style',
      // 牌子貼著文字大小(而不是撐滿節點框),小扇形上才不會蓋掉半塊派。
      'display:inline-flex;flex-direction:column;align-items:center;gap:1px;' +
        // 牌子壓在彩色扇形上 → 底色與墨色都固定,不跟著主題翻面。
        `text-align:center;color:${INK};background:rgba(255,255,255,0.88);border-radius:8px;` +
        'padding:4px 10px;box-shadow:0 1px 3px rgba(15,23,42,0.18);',
    );
    const name = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    name.textContent = node.label;
    name.setAttribute('style', 'font:700 12px/1.3 var(--rsm-editor-font);word-break:break-word;');
    root.appendChild(name as unknown as Node);
    const val = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    val.textContent = share === null ? String(value) : `${value} · ${share}%`;
    val.setAttribute('style', 'font:11px/1.2 var(--rsm-editor-font);opacity:0.7;white-space:nowrap;');
    root.appendChild(val as unknown as Node);
    wrap.appendChild(root as unknown as Node);
    fo.appendChild(wrap as unknown as Node);
    g.appendChild(fo);
  }

  /** 封包位元帶:位元刻度尺 + 標題(欄位本身是節點)。 */
  private renderPacketFrame(scene: EditorScene): void {
    const meta = scene.meta.type === 'packet' ? scene.meta : undefined;
    const ink = this.dark ? INK_DARK : INK;
    const g = this.frameLayer;
    if (scene.nodes.length === 0) return;
    const totalBits = Math.max(
      ...scene.nodes.map((n) => Math.round((n.x - PACKET_BIT.x0 + n.w) / PACKET_BIT.w)),
    );
    // 每 8 bit 一個刻度(位元組界線),讀起來才有依據。
    for (let b = 0; b <= totalBits; b += 8) {
      const x = PACKET_BIT.x0 + b * PACKET_BIT.w;
      g.appendChild(
        svgEl('path', {
          d: `M${x},${PACKET_BIT.y0 - 18} L${x},${PACKET_BIT.y0 + PACKET_BIT.h + 8}`,
          stroke: ink,
          'stroke-opacity': 0.25,
          fill: 'none',
        }),
      );
      const t = svgEl('text', {
        x,
        y: PACKET_BIT.y0 - 24,
        fill: ink,
        'text-anchor': 'middle',
        style: 'font:500 11px var(--rsm-editor-font);opacity:0.7;pointer-events:none;',
      });
      t.textContent = String(b);
      g.appendChild(t);
    }
    if (meta?.title) {
      const t = svgEl('text', {
        x: PACKET_BIT.x0,
        y: PACKET_BIT.y0 - 48,
        fill: ink,
        style: 'font:700 16px var(--rsm-editor-font);pointer-events:none;',
      });
      t.textContent = meta.title;
      g.appendChild(t);
    }
    this.seqBounds = {
      x: PACKET_BIT.x0 - 40,
      y: PACKET_BIT.y0 - 70,
      w: totalBits * PACKET_BIT.w + 80,
      h: PACKET_BIT.h + 110,
    };
  }

  /**
   * 積木圖的網格底線。
   *
   * 積木圖唯一要講的事就是「這塊在哪一格」,可是畫面上原本什麼參考線都沒有 —— 拖動時
   * 完全看不出自己會落到哪一格。這裡把 `columns N` 的格線畫成極淡的底圖當作對位參考。
   */
  private renderBlockFrame(scene: EditorScene): void {
    const cols = scene.meta.type === 'block' ? Math.max(1, scene.meta.columns) : 1;
    if (scene.nodes.length === 0) return;
    const ink = this.dark ? INK_DARK : INK;
    const g = this.frameLayer;
    const stepX = BLOCK_CELL.w + BLOCK_CELL.gapX;
    const stepY = BLOCK_CELL.h + BLOCK_CELL.gapY;
    const rows = Math.max(
      1,
      Math.ceil((Math.max(...scene.nodes.map((n) => n.y + n.h)) - BLOCK_CELL.y0 + 1) / stepY),
    );
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        g.appendChild(
          svgEl('rect', {
            x: BLOCK_CELL.x0 + c * stepX,
            y: BLOCK_CELL.y0 + r * stepY,
            width: BLOCK_CELL.w,
            height: BLOCK_CELL.h,
            rx: 8,
            fill: ink,
            'fill-opacity': 0.035,
            stroke: ink,
            'stroke-opacity': 0.12,
            'stroke-dasharray': '4 4',
          }),
        );
      }
    }
  }

  /**
   * gitGraph 的骨架:每條分支一條水平軸線,加上「從順序推導出來的」父子連線。
   * 連線畫在背景層而非 edges 層 —— 它們是衍生值(拖動就會重算),不是使用者畫的邊。
   */
  private renderGitgraphFrame(scene: EditorScene): void {
    const g = this.frameLayer;
    const laneY = new Map<string, number>();
    const laneColor = new Map<string, string>();
    const lanes = [...scene.containers].sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
    lanes.forEach((c, i) => {
      laneY.set(c.id, c.y + c.h / 2);
      laneColor.set(c.id, clusterByIndex(i).stroke);
    });
    const right = Math.max(GIT.x0, ...scene.nodes.map((n) => n.x + n.w)) + GIT.dx / 2;
    for (const c of lanes) {
      const y = laneY.get(c.id) as number;
      g.appendChild(
        svgEl('path', {
          d: `M${c.x + 12},${y} L${right},${y}`,
          stroke: laneColor.get(c.id) as string,
          'stroke-opacity': 0.35,
          'stroke-width': 2,
          fill: 'none',
        }),
      );
    }
    const center = (id: string): { x: number; y: number } | undefined => {
      const n = scene.nodes.find((v) => v.id === id);
      return n ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : undefined;
    };
    // 讓「符合畫面」把泳道整條算進去 —— 只框節點的話,左端的分支名稱會被切在畫面外。
    if (lanes.length) {
      const x = Math.min(...lanes.map((c) => c.x));
      const y = Math.min(...lanes.map((c) => c.y));
      this.seqBounds = {
        x: x - 12,
        y: y - 12,
        w: Math.max(...lanes.map((c) => c.x + c.w), right) - x + 24,
        h: Math.max(...lanes.map((c) => c.y + c.h)) - y + 24,
      };
    }
    for (const link of gitgraphLinks(scene)) {
      const a = center(link.from);
      const b = center(link.to);
      if (!a || !b) continue;
      // 同一條泳道就是直線;跨泳道(分支 / 合併)走 S 形貝茲,和 mermaid 畫的一樣。
      const d =
        Math.abs(a.y - b.y) < 1
          ? `M${a.x},${a.y} L${b.x},${b.y}`
          : `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`;
      g.appendChild(
        svgEl('path', {
          d,
          stroke: this.dark ? INK_DARK : INK,
          'stroke-opacity': link.merge ? 0.4 : 0.55,
          'stroke-width': 2,
          'stroke-dasharray': link.merge ? '5 3' : '',
          fill: 'none',
        }),
      );
    }
  }

  /** git 提交:實心圓點 + 下方 id;合併是雙環,tag 掛成小旗標。 */
  private fillGitCommit(g: SVGGElement, node: SceneNode): void {
    const d = node.data?.kind === 'gitgraph' ? node.data : undefined;
    const ink = this.dark ? INK_DARK : INK;
    // 顏色跟著「它現在落在哪一條泳道」走,而不是 parentId —— 拖到別條分支時顏色要立刻跟上,
    // 而 parentId 要等「整理排版」才會回填。
    const lane = gitLaneIndexAt(node.y, this.scene?.containers.length ?? 1);
    const pal = clusterByIndex(lane);
    const cx = node.w / 2;
    const cy = node.h / 2;
    const merge = d?.commitType === 3;
    const highlight = d?.commitType === 2;
    const reverse = d?.commitType === 1;
    g.appendChild(
      svgEl('circle', {
        cx,
        cy,
        r: merge ? 11 : 9,
        fill: highlight ? pal.stroke : this.dark ? '#1e222b' : '#ffffff',
        stroke: pal.stroke,
        'stroke-width': highlight ? 2.4 : 2,
      }),
    );
    // 合併=雙環(和 mermaid 的 merge 記號一致);REVERSE=打叉。
    if (merge) {
      g.appendChild(
        svgEl('circle', { cx, cy, r: 5, fill: pal.stroke, stroke: 'none' }),
      );
    } else if (reverse) {
      g.appendChild(
        svgEl('path', {
          d: `M${cx - 4},${cy - 4} L${cx + 4},${cy + 4} M${cx + 4},${cy - 4} L${cx - 4},${cy + 4}`,
          stroke: pal.stroke,
          'stroke-width': 2,
          fill: 'none',
        }),
      );
    }
    // 標籤畫成一枚小色片(而不是 🏷 emoji —— 系統 UI 字型不一定畫得出來)。
    const tag = d?.tags?.[0];
    if (tag) {
      const w = Math.max(24, textWidth(tag, 10.5) + 12);
      g.appendChild(
        svgEl('rect', {
          x: cx - w / 2,
          y: cy - 34,
          width: w,
          height: 17,
          rx: 4,
          fill: pal.stroke,
          stroke: 'none',
        }),
      );
      const t = svgEl('text', {
        x: cx,
        y: cy - 22,
        fill: '#ffffff',
        'text-anchor': 'middle',
        style: 'font:600 10.5px var(--rsm-editor-font);pointer-events:none;',
      });
      t.textContent = tag;
      g.appendChild(t);
    }
    if (node.label) {
      const t = svgEl('text', {
        x: cx,
        y: node.h + 13,
        fill: ink,
        'text-anchor': 'middle',
        style: 'font:11.5px var(--rsm-editor-font);opacity:0.85;pointer-events:none;',
      });
      t.textContent = node.label;
      g.appendChild(t);
    }
  }

  /** 封包欄位:實心格 + 欄名 + 位元範圍。 */
  private fillPacketField(g: SVGGElement, node: SceneNode): void {
    const idx = this.scene ? this.scene.nodes.findIndex((n) => n.id === node.id) : 0;
    const pal = paletteByIndex(idx >= 0 ? idx : 0);
    g.appendChild(
      svgEl('rect', {
        x: 0,
        y: 0,
        width: node.w,
        height: node.h,
        rx: 3,
        fill: pal.fill,
        stroke: pal.stroke,
        'stroke-width': 1.4,
      }),
    );
    const startBit = Math.round((node.x - PACKET_BIT.x0) / PACKET_BIT.w);
    const bits = Math.max(1, Math.round(node.w / PACKET_BIT.w));
    const fo = svgEl('foreignObject', { x: 2, y: 0, width: Math.max(0, node.w - 4), height: node.h });
    fo.style.pointerEvents = 'none';
    const root = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    root.setAttribute(
      'style',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:100%;' +
        // 文字壓在淺色欄位底上 → 墨色固定深色。
        `overflow:hidden;text-align:center;color:${INK};`,
    );
    const name = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    name.textContent = node.label;
    name.setAttribute('style', 'font:600 12px/1.25 var(--rsm-editor-font);word-break:break-word;');
    root.appendChild(name as unknown as Node);
    const range = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    range.textContent = bits === 1 ? `${startBit}` : `${startBit}–${startBit + bits - 1}`;
    range.setAttribute('style', 'font:10.5px/1.2 var(--rsm-editor-font);opacity:0.7;');
    root.appendChild(range as unknown as Node);
    fo.appendChild(root as unknown as Node);
    g.appendChild(fo);
  }

  /** architecture 服務:圖示方塊 + 下方名稱;junction 只畫一個小點。 */
  private fillArchNode(g: SVGGElement, node: SceneNode): void {
    const d = node.data?.kind === 'architecture' ? node.data : undefined;
    const idx = this.scene ? this.scene.nodes.findIndex((n) => n.id === node.id) : 0;
    const pal = paletteByIndex(idx >= 0 ? idx : 0);
    const ink = this.dark ? INK_DARK : INK;
    if (d?.junction) {
      g.appendChild(
        svgEl('circle', { cx: node.w / 2, cy: node.h / 2, r: 7, fill: ink, stroke: 'none' }),
      );
      return;
    }
    // 方塊就是整個節點 —— 先前只在節點中央畫一個 56px 的小框,連線卻接在(看不見的)節點外框上,
    // 於是每條線都停在方塊外面一段距離,看起來根本沒接上。
    g.appendChild(
      svgEl('rect', {
        x: 0,
        y: 0,
        width: node.w,
        height: node.h,
        rx: 12,
        fill: pal.fill,
        stroke: pal.stroke,
        'stroke-width': 1.6,
      }),
    );
    const iconG = archIconGroup(d?.icon, pal.stroke, node.w / 2, node.h / 2, Math.min(node.w, node.h) * 0.62);
    if (iconG) g.appendChild(iconG);
    else {
      // 不認得的圖示名:退回首字母,至少看得出彼此不同。
      const t = svgEl('text', {
        x: node.w / 2,
        y: node.h / 2,
        fill: pal.stroke,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        style: 'font:700 22px var(--rsm-editor-font);pointer-events:none;',
      });
      t.textContent = (d?.icon ?? node.label ?? '?').trim().charAt(0).toUpperCase();
      g.appendChild(t);
    }

    // 名稱掛在方塊下方(節點外),節點框才等於畫出來的方塊。
    const fo = svgEl('foreignObject', { x: -30, y: node.h + 4, width: node.w + 60, height: 40 });
    fo.style.pointerEvents = 'none';
    fo.style.overflow = 'visible';
    const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    div.textContent = node.label;
    div.setAttribute(
      'style',
      `text-align:center;font:600 12px/1.3 var(--rsm-editor-font);color:${ink};word-break:break-word;`,
    );
    fo.appendChild(div as unknown as Node);
    g.appendChild(fo);
  }

  /** 甘特長條:實心圓角條 + 條上任務名;milestone 畫成菱形。 */
  private fillGanttBar(g: SVGGElement, node: SceneNode): void {
    const d = node.data?.kind === 'gantt' ? node.data : undefined;
    const idx = this.scene ? this.scene.nodes.findIndex((n) => n.id === node.id) : 0;
    const pal = paletteByIndex(idx >= 0 ? idx : 0);
    const crit = d?.flags.includes('crit');
    const done = d?.flags.includes('done');
    if (d?.flags.includes('milestone')) {
      const c = node.h / 2;
      g.appendChild(
        svgEl('path', {
          d: `M${node.w / 2},0 L${node.w / 2 + c},${c} L${node.w / 2},${node.h} L${node.w / 2 - c},${c} Z`,
          fill: crit ? '#EF4444' : pal.stroke,
          stroke: 'none',
        }),
      );
    } else {
      g.appendChild(
        svgEl('rect', {
          x: 0,
          y: 0,
          width: node.w,
          height: node.h,
          rx: 4,
          fill: done ? pal.fill : pal.stroke,
          'fill-opacity': done ? 1 : 0.85,
          stroke: crit ? '#EF4444' : pal.stroke,
          'stroke-width': crit ? 2 : 1,
        }),
      );
    }
    if (!node.label) return;
    // 名稱優先寫在長條**裡面**(甘特圖本來就這樣讀);放不下才靠到右側,
    // 否則長條一多,右邊那排字就會壓到隔壁的條。里程碑是個小菱形,一律外掛。
    const milestone = d?.flags.includes('milestone') ?? false;
    const inside = !milestone && textWidth(node.label, 12) + 18 <= node.w;
    // 寫在長條**裡面**的字是壓在節點配色上,而節點配色是固定的淺色盤 —— 不能跟著主題翻面,
    // 否則深色模式下 done 的淺底長條會變成淺字寫在淺底上(整條字直接消失)。
    // done = 淺色填滿 → 深墨;其餘 = 飽和色填滿 → 反白。寫在外面的才用主題墨色(那是畫布底)。
    const insideInk = done ? INK : '#ffffff';
    // 里程碑是菱形,右頂點在 w/2 + h/2 —— 從 w 開始寫字會貼到菱形上。
    const outsideX = milestone ? node.w / 2 + node.h / 2 + 8 : node.w + 6;
    const fo = svgEl('foreignObject', {
      x: inside ? 9 : outsideX,
      y: 0,
      width: inside ? Math.max(0, node.w - 18) : 220,
      height: node.h,
    });
    fo.style.pointerEvents = 'none';
    fo.style.overflow = 'visible';
    const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    div.textContent = node.label;
    div.setAttribute(
      'style',
      `display:flex;align-items:center;height:100%;font:${inside ? '600 ' : ''}12px/1.3 var(--rsm-editor-font);` +
        `color:${inside ? insideInk : this.dark ? INK_DARK : INK};white-space:nowrap;`,
    );
    fo.appendChild(div as unknown as Node);
    g.appendChild(fo);
  }

  /** 象限圖資料點:小圓 + 下方標籤(標籤不吃指標事件,才不會擋住拖曳)。 */
  private fillQuadrantPoint(g: SVGGElement, node: SceneNode): void {
    const d = node.data?.kind === 'quadrant' ? node.data : undefined;
    const idx = this.scene ? this.scene.nodes.findIndex((n) => n.id === node.id) : 0;
    const pal = paletteByIndex(idx >= 0 ? idx : 0);
    const r = Math.max(4, Math.min(14, d?.radius ?? 7));
    g.appendChild(
      svgEl('circle', {
        cx: node.w / 2,
        cy: node.h / 2,
        r,
        fill: d?.color ?? pal.stroke,
        stroke: d?.strokeColor ?? (this.dark ? '#0b1220' : '#ffffff'),
        'stroke-width': 2,
      }),
    );
    if (!node.label) return;
    const fo = svgEl('foreignObject', { x: -60 + node.w / 2, y: node.h / 2 + r, width: 120, height: 22 });
    fo.style.pointerEvents = 'none';
    fo.style.overflow = 'visible';
    const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    div.textContent = node.label;
    div.setAttribute(
      'style',
      `text-align:center;font:600 12px/1.5 var(--rsm-editor-font);color:${this.dark ? INK_DARK : INK};` +
        'white-space:nowrap;overflow:visible;',
    );
    fo.appendChild(div as unknown as Node);
    g.appendChild(fo);
  }

  /**
   * 卡片式節點:白底卡 + 標題 + 一列附註。看板與旅程圖共用同一張卡
   * (看板附註是負責人 / 票號 / 優先序;旅程圖是心情臉譜 + 參與角色)。
   */
  private fillKanbanCard(g: SVGGElement, node: SceneNode): void {
    const d = node.data?.kind === 'kanban' ? node.data : undefined;
    const j = node.data?.kind === 'journey' ? node.data : undefined;
    const ink = this.dark ? INK_DARK : INK;
    const idx = this.scene ? this.scene.nodes.findIndex((n) => n.id === node.id) : 0;
    const pal = paletteByIndex(idx >= 0 ? idx : 0);
    const card = svgEl('rect', {
      x: 0,
      y: 0,
      width: node.w,
      height: node.h,
      rx: 6,
      fill: this.dark ? '#1e222b' : '#ffffff',
      stroke: pal.stroke,
      'stroke-width': 1.3,
    });
    if (this.look === 'clean') card.style.filter = `url(#${NODE_SHADOW_ID})`;
    card.style.pointerEvents = 'none';
    g.appendChild(card);
    // 左緣色條:一眼看出卡片彼此不同,也讓「拖到另一欄」有視覺連續性。
    const bar = svgEl('rect', { x: 0, y: 0, width: 4, height: node.h, rx: 2, fill: pal.stroke });
    bar.style.pointerEvents = 'none';
    g.appendChild(bar);

    const meta: string[] = [];
    if (d?.assigned) meta.push(`@${d.assigned}`);
    if (d?.ticket) meta.push(d.ticket);
    if (d?.priority) meta.push(d.priority);
    // 旅程圖:1..5 的心情分數用臉譜呈現(和 mermaid 的旅程圖一樣看得出情緒)。
    if (j) {
      meta.push(`${['😞', '🙁', '😐', '🙂', '😀'][Math.max(1, Math.min(5, j.score)) - 1]} ${j.score}`);
      if (j.actors.length) meta.push(j.actors.join(', '));
    }
    const fo = svgEl('foreignObject', { x: 8, y: 0, width: Math.max(0, node.w - 14), height: node.h });
    fo.style.pointerEvents = 'none';
    const root = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    root.setAttribute(
      'style',
      'display:flex;flex-direction:column;justify-content:center;gap:3px;height:100%;padding:6px 2px;' +
        `box-sizing:border-box;overflow:hidden;color:${ink};`,
    );
    const title = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    title.textContent = node.label;
    title.setAttribute('style', 'font:600 12.5px/1.4 var(--rsm-editor-font);word-break:break-word;');
    root.appendChild(title as unknown as Node);
    if (meta.length) {
      const m = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
      m.textContent = meta.join(' · ');
      m.setAttribute('style', 'font:10.5px/1.3 var(--rsm-editor-font);opacity:0.65;white-space:nowrap;');
      root.appendChild(m as unknown as Node);
    }
    fo.appendChild(root as unknown as Node);
    g.appendChild(fo);
  }

  /** C4 元素框:«型別» + 名稱 +(技術)+ 說明;person 型別在框上方多一顆頭像圓。 */
  private fillC4Box(g: SVGGElement, node: SceneNode): void {
    const d = node.data?.kind === 'c4' ? node.data : undefined;
    if (!d) return;
    // 文字畫在淺色節點底上 → 墨色固定用深色。跟著主題走的話,深色模式會變成淺字寫在淺底上。
    const ink = INK;
    const parts = c4Lines(node.label, d);
    if (d.c4Type.includes('person')) {
      const idx = this.scene ? this.scene.nodes.findIndex((n) => n.id === node.id) : 0;
      const pal = paletteByIndex(idx >= 0 ? idx : 0);
      // 頭 + 肩:先前只畫一個和底色同色的空心圓,看起來像框裡飄了個圈,而不是「這是個人」。
      const cx = node.w / 2;
      g.appendChild(svgEl('circle', { cx, cy: 11, r: 6, fill: pal.stroke, stroke: 'none' }));
      g.appendChild(
        svgEl('path', {
          d: `M${cx - 11},${23} a11,9 0 0 1 22,0 Z`,
          fill: pal.stroke,
          stroke: 'none',
        }),
      );
    }
    const top = d.c4Type.includes('person') ? 20 : 0;
    const fo = svgEl('foreignObject', { x: 0, y: top, width: node.w, height: Math.max(0, node.h - top) });
    fo.style.pointerEvents = 'none';
    const root = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    root.setAttribute(
      'style',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;' +
        `width:100%;height:100%;box-sizing:border-box;padding:4px 10px;overflow:hidden;text-align:center;color:${ink};`,
    );
    const line = (text: string | undefined, style: string): void => {
      if (!text) return;
      const el = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
      el.textContent = text;
      el.setAttribute('style', style);
      root.appendChild(el as unknown as Node);
    };
    line(parts.kind, `font:10.5px/1.35 var(--rsm-editor-font);opacity:0.65;white-space:nowrap;`);
    line(parts.title, `font:700 13px/1.35 var(--rsm-editor-font);word-break:break-word;`);
    line(parts.techn, `font:10.5px/1.35 var(--rsm-editor-font);opacity:0.7;white-space:nowrap;`);
    line(parts.descr, `font:10.5px/1.4 var(--rsm-editor-font);opacity:0.85;word-break:break-word;`);
    fo.appendChild(root as unknown as Node);
    g.appendChild(fo);
  }

  /** 需求框 / 元素框:«型別» + 名稱 + 欄位列(對齊 mermaid requirementDiagram 的外觀)。 */
  private fillRequirementBox(g: SVGGElement, node: SceneNode): void {
    const req = node.data?.kind === 'requirement' ? node.data.req : undefined;
    if (!req) return;
    // 文字畫在淺色節點底上 → 墨色固定用深色。跟著主題走的話,深色模式會變成淺字寫在淺底上。
    const ink = INK;
    const fo = svgEl('foreignObject', { x: 0, y: 0, width: node.w, height: node.h });
    fo.style.pointerEvents = 'none';
    const root = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    root.setAttribute(
      'style',
      'display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;' +
        `overflow:hidden;font:11px/1.45 var(--rsm-editor-font);color:${ink};`,
    );
    const head = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    head.textContent = requirementKind(req);
    head.setAttribute('style', 'text-align:center;opacity:0.7;font-size:10px;padding-top:3px;white-space:nowrap;');
    root.appendChild(head as unknown as Node);
    const title = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    title.textContent = node.label;
    const rows = requirementRows(req);
    title.setAttribute(
      'style',
      `font:700 12px/1.4 var(--rsm-editor-font);text-align:center;padding:1px 8px 5px;` +
        `${rows.length ? `border-bottom:1px solid ${ink};` : ''}white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`,
    );
    root.appendChild(title as unknown as Node);
    if (rows.length) {
      const body = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
      body.setAttribute('style', 'flex:1;padding:3px 8px;overflow:hidden;');
      for (const r of rows) {
        const row = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
        row.textContent = r;
        row.setAttribute('style', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;');
        body.appendChild(row as unknown as Node);
      }
      root.appendChild(body as unknown as Node);
    }
    fo.appendChild(root as unknown as Node);
    g.appendChild(fo);
  }

  /** sequence 圖小工具:foreignObject 文字(CJK 友善)。 */
  private seqText(
    x: number,
    y: number,
    text: string,
    color: string,
    size: number,
    weight: number,
    anchor: 'start' | 'middle' | 'end' = 'start',
  ): SVGGElement {
    const W = 220;
    const fx = anchor === 'middle' ? x - W / 2 : anchor === 'end' ? x - W : x;
    const fo = svgEl('foreignObject', { x: fx, y: y - 9, width: W, height: 18 });
    fo.style.pointerEvents = 'none';
    fo.style.overflow = 'visible';
    const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
    div.textContent = text;
    div.setAttribute(
      'style',
      `font:${weight} ${size}px/1.2 var(--rsm-editor-font);color:${color};` +
        `text-align:${anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left'};white-space:nowrap;`,
    );
    fo.appendChild(div as unknown as Node);
    return fo as unknown as SVGGElement;
  }

  /** sequence 圖專屬渲染:參與者欄 + 生命線 + 依序堆疊的訊息 + note + 片段框。 */
  private renderSequence(scene: EditorScene): void {
    const seq = scene.sequence;
    if (!seq) return;
    this.renderedSequence = true;
    this.nodeCache.clear();
    this.edgeEls.clear();
    this.seqMsgRects.clear();
    // 不清 overlayLayer:那一層的子群組是 Overlay 建構時建好、之後一直持有參考的,
    // 從這裡砍掉等於把它們從文件上摘下來,Overlay 之後所有 showSelection / showGuides
    // 都寫進脫離 DOM 的節點 —— 拖曳照樣生效,但選取框、吸附線、橡皮筋一個都看不到,
    // 使用者只會覺得「拖了沒反應」。殘留的舊視覺由 Overlay 自己的 clearXxx 與
    // controller 每次渲染後的 refreshOverlay 收拾。
    for (const layer of [this.containersLayer, this.edgesLayer, this.nodesLayer]) {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
    }
    const g = this.nodesLayer;
    const ink = this.dark ? '#c9d1d9' : '#334155';
    const fillBox = this.dark ? '#26262b' : '#ffffff';
    const ROW_H = 44;
    // 欄位 = 參與者節點(座標與命中測試一致)。
    const cols = scene.nodes
      .filter((n) => n.data?.kind === 'sequence')
      .map((n) => ({
        id: n.id,
        label: n.label,
        actor: n.data?.kind === 'sequence' ? n.data.actor : false,
        x: n.x,
        w: n.w,
        cx: n.x + n.w / 2,
        y: n.y,
        h: n.h,
      }));
    const HEAD_Y = cols[0]?.y ?? 12;
    const HEAD_H = cols[0]?.h ?? 40;
    const colById = new Map(cols.map((c) => [c.id, c] as const));
    const cxOf = (id: string): number => colById.get(id)?.cx ?? 40;
    const rightEdge = cols.length ? cols[cols.length - 1].x + cols[cols.length - 1].w : 200;

    const ROW0 = HEAD_Y + HEAD_H + 36;
    let row = 0;
    const OPENERS = new Set(['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect', 'box']);
    interface Drawn {
      kind: 'msg' | 'note';
      y: number;
      s: import('../scene/types').SeqStatement;
      idx: number;
    }
    interface Frag {
      kw: string;
      label: string;
      y0: number;
      y1?: number;
      dividers: Array<{ y: number; kw: string; label: string }>;
    }
    const drawn: Drawn[] = [];
    const fragStack: Frag[] = [];
    const frags: Frag[] = [];
    let sidx = -1;
    for (const s of seq.statements) {
      sidx += 1;
      if (s.kind === 'message') {
        drawn.push({ kind: 'msg', y: ROW0 + row * ROW_H, s, idx: sidx });
        row += 1;
      } else if (s.kind === 'note') {
        drawn.push({ kind: 'note', y: ROW0 + row * ROW_H, s, idx: sidx });
        row += 1;
      } else if (s.kind === 'fragment') {
        if (OPENERS.has(s.keyword)) {
          const f: Frag = { kw: s.keyword, label: s.label, y0: ROW0 + row * ROW_H, dividers: [] };
          row += 1;
          fragStack.push(f);
          frags.push(f);
        } else {
          const top = fragStack[fragStack.length - 1];
          if (top) top.dividers.push({ y: ROW0 + row * ROW_H, kw: s.keyword, label: s.label });
          row += 1;
        }
      } else if (s.kind === 'end') {
        const f = fragStack.pop();
        if (f) {
          f.y1 = ROW0 + row * ROW_H;
          row += 1;
        }
      }
    }
    const bottomY = ROW0 + row * ROW_H + 6;

    const line = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      o: { dash?: boolean; w?: number; marker?: boolean; stroke?: string; opacity?: number } = {},
    ): SVGPathElement => {
      const p = svgEl('path', { d: `M${x1},${y1} L${x2},${y2}`, fill: 'none', stroke: o.stroke ?? ink, 'stroke-width': o.w ?? 1.6 });
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      if (o.dash) p.setAttribute('stroke-dasharray', '5 4');
      if (o.opacity != null) p.style.opacity = String(o.opacity);
      const mk = markerIdFor('arrow', this.dark);
      if (o.marker && mk) p.setAttribute('marker-end', `url(#${mk})`);
      p.style.pointerEvents = 'none';
      return p;
    };

    // 片段框(墊底)
    for (const f of frags) {
      if (f.y1 == null) f.y1 = bottomY;
      const fx = 20;
      const fw = rightEdge + 20;
      const box = svgEl('rect', { x: fx, y: f.y0 - 14, width: fw - fx, height: f.y1 - f.y0 + 24, rx: 4, fill: 'none', stroke: ink, 'stroke-width': 1, 'stroke-dasharray': '3 3' });
      box.style.opacity = '0.6';
      box.style.pointerEvents = 'none';
      g.appendChild(box);
      const tagW = Math.max(40, f.kw.length * 8 + 24);
      const tag = svgEl('rect', { x: fx, y: f.y0 - 14, width: tagW, height: 18, fill: this.dark ? '#3a3a40' : '#e2e8f0', stroke: ink, 'stroke-width': 1 });
      tag.style.pointerEvents = 'none';
      g.appendChild(tag);
      g.appendChild(this.seqText(fx + 5, f.y0 - 1, `${f.kw}${f.label ? ' ' + f.label : ''}`, ink, 11, 700, 'start'));
      for (const d of f.dividers) {
        g.appendChild(line(fx, d.y - 14, fw, d.y - 14, { dash: true, w: 1 }));
        g.appendChild(this.seqText(fx + 5, d.y - 1, `[${d.label || d.kw}]`, ink, 11, 600, 'start'));
      }
    }

    // 生命線:淡色比照該欄參與者的色票(而非整張圖同一種灰),弱化「一排黑虛線」的呆板感。
    cols.forEach((c, i) => {
      g.appendChild(line(c.cx, HEAD_Y + HEAD_H, c.cx, bottomY, { dash: true, w: 1, stroke: paletteByIndex(i).stroke, opacity: 0.55 }));
    });

    // 啟用區(activation bars):依訊息 +/- 簡寫配對,在生命線上畫窄矩形。
    const actStack = new Map<string, number[]>();
    const actBars: Array<{ actor: string; y0: number; y1: number }> = [];
    for (const d of drawn) {
      if (d.kind === 'msg' && d.s.kind === 'message') {
        const s = d.s;
        if (s.activate === '+') {
          const st = actStack.get(s.to) ?? [];
          st.push(d.y);
          actStack.set(s.to, st);
        } else if (s.activate === '-') {
          const st = actStack.get(s.from);
          if (st && st.length) actBars.push({ actor: s.from, y0: st.pop() as number, y1: d.y });
        }
      }
    }
    for (const [actor, st] of actStack) for (const y0 of st) actBars.push({ actor, y0, y1: bottomY });
    for (const ab of actBars) {
      const cx = cxOf(ab.actor);
      g.appendChild(
        svgEl('rect', {
          x: cx - 5,
          y: ab.y0,
          width: 10,
          height: Math.max(8, ab.y1 - ab.y0),
          fill: fillBox,
          stroke: ink,
          'stroke-width': 1,
        }),
      );
    }

    // 訊息 + note
    let autoNum = 0;
    for (const d of drawn) {
      if (d.kind === 'msg' && d.s.kind === 'message') {
        const s = d.s;
        const x1 = cxOf(s.from);
        const x2 = cxOf(s.to);
        const dashed = s.arrow.includes('--');
        // autonumber:在來源端畫一個編號圓圈(對齊 mermaid 行為)。
        if (seq.autonumber) {
          autoNum += 1;
          const nx = s.from === s.to ? x1 : x1 + (x2 > x1 ? 9 : -9);
          g.appendChild(svgEl('circle', { cx: nx, cy: d.y, r: 9, fill: this.dark ? '#26262b' : '#ffffff', stroke: ink, 'stroke-width': 1 }));
          g.appendChild(this.seqText(nx, d.y + 1, String(autoNum), ink, 10, 700, 'middle'));
        }
        let rect: { x: number; y: number; w: number; h: number };
        if (s.from === s.to) {
          const r = 20;
          g.appendChild(svgEl('path', { d: `M${x1},${d.y} h${r} v18 h${-r}`, fill: 'none', stroke: ink, 'stroke-width': 1.6 }));
          const back = line(x1 + r, d.y + 18, x1, d.y + 18, { marker: true });
          g.appendChild(back);
          if (s.text) g.appendChild(this.seqText(x1 + r + 6, d.y + 4, s.text, ink, 12, 400, 'start'));
          rect = { x: x1, y: d.y - 10, w: 140, h: 34 };
        } else {
          g.appendChild(line(x1, d.y, x2, d.y, { dash: dashed, marker: true }));
          if (s.text) g.appendChild(this.seqText((x1 + x2) / 2, d.y - 6, s.text, ink, 12, 400, 'middle'));
          rect = { x: Math.min(x1, x2), y: d.y - 18, w: Math.abs(x2 - x1), h: 26 };
        }
        // 雙擊可編輯訊息文字:透明命中區 + 記錄世界座標供 host 定位編輯器。
        this.seqMsgRects.set(d.idx, rect);
        const hit = svgEl('rect', {
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
          fill: 'transparent',
          'data-seq-msg': String(d.idx),
        });
        // 游標講的是「按下去主要會發生什麼」= 上下拖改順序。改文字是雙擊,不是主要手勢,
        // 掛 text 游標會讓人以為這裡只能編輯,反而藏住了拖曳。
        hit.style.cursor = 'ns-resize';
        g.appendChild(hit);
      } else if (d.kind === 'note' && d.s.kind === 'note') {
        const s = d.s;
        const ids = s.actors.split(',').map((a) => a.trim()).filter(Boolean);
        const xs = ids.map(cxOf);
        const minx = Math.min(...xs);
        const maxx = Math.max(...xs);
        const nw = s.placement === 'over' ? maxx - minx + 80 : 120;
        const nx = s.placement === 'over' ? minx - 40 : s.placement === 'left of' ? minx - 130 : maxx + 10;
        const w = Math.max(80, nw);
        const nbox = svgEl('rect', { x: nx, y: d.y - 12, width: w, height: 26, rx: 2, fill: this.dark ? '#3d3a22' : '#fff7d6', stroke: ink, 'stroke-width': 1 });
        nbox.style.pointerEvents = 'none';
        g.appendChild(nbox);
        g.appendChild(this.seqText(nx + w / 2, d.y + 1, s.text, ink, 11, 400, 'middle'));
        // 雙擊可編輯 note 文字:與訊息共用 data-seq-msg 命中機制。
        const nrect = { x: nx, y: d.y - 12, w, h: 26 };
        this.seqMsgRects.set(d.idx, nrect);
        const nhit = svgEl('rect', { x: nrect.x, y: nrect.y, width: nrect.w, height: nrect.h, fill: 'transparent', 'data-seq-msg': String(d.idx) });
        nhit.style.cursor = 'ns-resize'; // 筆記與訊息同一套手勢(見上方訊息命中區的說明)
        g.appendChild(nhit);
      }
    }

    // 參與者方框:頂端 + 底端「都」帶 data-node-id(同一個 id)供選取 / 拖曳換序 / 雙擊改名 ——
    // 兩者缺一都會讓使用者在其中一顆框上拖曳時穿透命中背景,onPointerDown 落入「空白處」
    // 分支變成平移整張畫布,體感就是「拖了但沒反應,而且畫面還亂飄」。
    // 左右拖曳換序、cursor 用 ew-resize 明講「只能左右」,不是通用的 move。
    // 配色比照 flowchart 節點依序取 paletteByIndex(彩色卡片),不再全部同一片 fillBox ——
    // 之前參與者一律灰白,是這個編輯器裡唯一沒有色彩變化的圖種,跟其它圖種的觀感不一致。
    // 文字固定用 INK(深色),因為色票 fill 一律是淺色,不必再分深色模式。
    const shadow = this.look === 'clean' ? `url(#${NODE_SHADOW_ID})` : '';
    cols.forEach((c, i) => {
      const pal = paletteByIndex(i);
      const top = svgEl('g', { 'data-node-id': c.id, class: 'rsm-node' });
      const tb = svgEl('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: c.actor ? 16 : 6, fill: pal.fill, stroke: pal.stroke, 'stroke-width': 1.5 });
      if (shadow) tb.style.filter = shadow;
      tb.style.cursor = 'ew-resize';
      top.appendChild(tb);
      top.appendChild(this.seqText(c.cx, c.y + c.h / 2 + 1, c.label, INK, 13, 700, 'middle'));
      g.appendChild(top);
      const bottom = svgEl('g', { 'data-node-id': c.id, class: 'rsm-node' });
      const bb = svgEl('rect', { x: c.x, y: bottomY + 4, width: c.w, height: HEAD_H, rx: c.actor ? 16 : 6, fill: pal.fill, stroke: pal.stroke, 'stroke-width': 1.5 });
      if (shadow) bb.style.filter = shadow;
      bb.style.cursor = 'ew-resize';
      bottom.appendChild(bb);
      bottom.appendChild(this.seqText(c.cx, bottomY + 4 + HEAD_H / 2 + 1, c.label, INK, 13, 700, 'middle'));
      g.appendChild(bottom);
    });

    // 整張 sequence 的世界範圍(含底部參與者框 + 片段框左緣),供 fit 用。
    const minX = Math.min(10, cols[0]?.x ?? 40);
    const maxX = rightEdge + 20;
    this.seqBounds = { x: minX, y: 0, w: maxX - minX, h: bottomY + 8 + HEAD_H };
  }

  private static geomKey(n: SceneNode): string {
    return `${n.shape}|${Math.round(n.w)}|${Math.round(n.h)}|${n.style?.fill ?? ''}|${n.style?.stroke ?? ''}`;
  }

  /** 全量 diff 渲染(新增 / 移除 / 幾何變更重 rough,純位移只改 transform)。 */
  render(scene: EditorScene): void {
    this.scene = scene;
    if (scene.diagramType === 'sequence' && scene.sequence) {
      this.renderSequence(scene);
      return;
    }
    this.seqBounds = null;
    // 象限圖:先畫圖表外框(四象限 + 兩軸 + 標題),點才有可讀的參照。
    // 它是「背景」而非場景元素,所以有自己的圖層、每次重畫、也不進節點快取。
    while (this.frameLayer.firstChild) this.frameLayer.removeChild(this.frameLayer.firstChild);
    if (scene.diagramType === 'quadrant') {
      this.renderQuadrantFrame(scene);
      this.seqBounds = SceneRenderer.quadrantBounds();
    }
    if (scene.diagramType === 'gantt') this.renderGanttFrame(scene);
    if (scene.diagramType === 'pie') this.renderPieFrame(scene);
    if (scene.diagramType === 'xychart') this.renderXyFrame(scene);
    if (scene.diagramType === 'packet') this.renderPacketFrame(scene);
    if (scene.diagramType === 'gitgraph') this.renderGitgraphFrame(scene);
    if (scene.diagramType === 'block') this.renderBlockFrame(scene);
    // 上一次是 sequence 渲染(內容直接寫入 layers、未進 nodeCache)→ diff 渲染清不掉,
    // 先把全部 layers + 快取硬清空,避免上一張 sequence 圖殘留疊在新圖底下。
    if (this.renderedSequence) {
      this.renderedSequence = false;
      this.nodeCache.clear();
      this.edgeEls.clear();
      this.seqMsgRects.clear();
      // 同上:overlayLayer 的子群組屬於 Overlay,清了就再也回不來(見 renderSequence 的說明)。
      for (const layer of [this.containersLayer, this.edgesLayer, this.nodesLayer]) {
        while (layer.firstChild) layer.removeChild(layer.firstChild);
      }
    }
    const liveNodeIds = new Set(scene.nodes.map((n) => n.id));

    // 移除消失的節點群組。
    for (const [id, cache] of this.nodeCache) {
      if (!liveNodeIds.has(id)) {
        cache.g.remove();
        this.nodeCache.delete(id);
      }
    }

    for (const node of scene.nodes) {
      const geomKey = SceneRenderer.geomKey(node);
      const labelKey = node.label;
      const existing = this.nodeCache.get(node.id);
      if (!existing) {
        const g = this.buildNodeGroup(node);
        this.nodesLayer.appendChild(g);
        this.nodeCache.set(node.id, { g, geomKey, labelKey });
        continue;
      }
      if (existing.geomKey !== geomKey || existing.labelKey !== labelKey) {
        this.fillNodeContent(existing.g, node);
        existing.geomKey = geomKey;
        existing.labelKey = labelKey;
      }
      existing.g.setAttribute('transform', `translate(${node.x},${node.y})`);
    }

    // 邊:全量重建(成本低且永遠正確)。
    while (this.edgesLayer.firstChild) this.edgesLayer.removeChild(this.edgesLayer.firstChild);
    this.edgeEls.clear();
    for (const edge of scene.edges) {
      const g = renderEdge(scene, edge, this.dark);
      this.edgesLayer.appendChild(g);
      this.edgeEls.set(edge.id, g);
    }

    this.renderContainers(scene);
  }

  /** subgraph / 容器框:於渲染時依子節點 bbox 即時計算外框(子節點移動後框會跟著更新)。 */
  private renderContainers(scene: EditorScene): void {
    while (this.containersLayer.firstChild) this.containersLayer.removeChild(this.containersLayer.firstChild);
    if (scene.containers.length === 0) return;
    const LABEL_H = 22;
    // 外框幾何一律問 scene-ops(連線錨點、符合畫面、匯出 SVG 都用同一個)。這裡曾經自己抄一份
    // 同樣的算式,於是任何一邊改內距,畫出來的框就會和點擊 / 裁切範圍差一截。
    const effRect = (c: SceneContainer) => containerRect(scene, c.id);
    let ci = 0;
    for (const c of scene.containers) {
      // 對齊 Edit Diagram:每個 subgraph 取叢集底色 + 同色標題(色相循序)。
      const cp = clusterByIndex(ci++);
      const box0 = effRect(c);
      if (!box0) continue;
      const { x, y, w, h } = box0;
      const box = svgEl('rect', {
        x,
        y,
        width: w,
        height: h,
        rx: 8,
        fill: cp.fill,
        stroke: cp.stroke,
        'stroke-width': 1.5,
        'data-container-id': c.id,
      });
      // git 的分支泳道是整條橫貫畫面的長條;同樣的粉彩鋪滿那麼大一片會蓋過提交本身,壓淡一些。
      if (scene.diagramType === 'gitgraph') box.setAttribute('fill-opacity', '0.4');
      // 泳道圖的欄要可以被右鍵點到(改名 / 刪欄);其他圖種的容器框維持穿透,
      // 免得擋住框內節點的點擊。
      box.style.pointerEvents = LANE_DIAGRAMS.has(scene.diagramType) ? 'auto' : 'none';
      this.containersLayer.appendChild(box);
      if (c.label) {
        const fo = svgEl('foreignObject', { x, y: y + 2, width: w, height: LABEL_H });
        fo.style.pointerEvents = 'none';
        const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
        div.textContent = c.label;
        div.setAttribute(
          'style',
          `font:700 12px/${LABEL_H}px var(--rsm-editor-font);color:${cp.stroke};` +
            'padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
        );
        fo.appendChild(div as unknown as Node);
        this.containersLayer.appendChild(fo);
      }
    }
  }

  /** 拖曳預覽:只改選取節點 transform + 重繞入射邊,不寫模型。 */
  previewMove(ids: Set<string>, dx: number, dy: number): void {
    if (!this.scene) return;
    const preview = moveNodes(this.scene, ids, dx, dy);
    for (const id of ids) {
      const cache = this.nodeCache.get(id);
      const node = preview.nodes.find((n) => n.id === id);
      if (cache && node) cache.g.setAttribute('transform', `translate(${node.x},${node.y})`);
    }
    for (const edge of preview.edges) {
      if (!ids.has(edge.source) && !ids.has(edge.target)) continue;
      const g = this.edgeEls.get(edge.id);
      if (g) updateEdgeGeometry(g, preview, edge);
    }
    this.showDropTarget(preview, ids);
  }

  /**
   * 「放開會落在哪裡」的即時提示。
   *
   * 位置即資料的那幾種圖(看板欄 / 旅程階段 / git 分支 / 積木格),放手的瞬間就會改寫原始碼,
   * 可是拖的過程中畫面上完全沒有東西告訴使用者會落到哪一格 —— 只能拖完看結果、錯了再拖回來。
   * 這裡把即將落入的那一格描一圈,拖曳時同步跟著走。
   */
  private showDropTarget(preview: EditorScene, ids: Set<string>): void {
    this.clearDropTarget();
    const node = preview.nodes.find((n) => ids.has(n.id));
    if (!node) return;
    const type = preview.diagramType;
    let rect: { x: number; y: number; w: number; h: number } | null = null;
    if (type === 'kanban' || type === 'journey' || type === 'gitgraph') {
      // 泳道類:節點中心落在哪一條泳道,就框那一條。
      const cx = node.x + node.w / 2;
      const cy = node.y + node.h / 2;
      const hit = preview.containers
        .map((c) => containerRect(preview, c.id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .find((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
      rect = hit ?? null;
    } else if (type === 'block') {
      const stepX = BLOCK_CELL.w + BLOCK_CELL.gapX;
      const stepY = BLOCK_CELL.h + BLOCK_CELL.gapY;
      const col = Math.max(0, Math.round((node.x - BLOCK_CELL.x0) / stepX));
      const row = Math.max(0, Math.round((node.y - BLOCK_CELL.y0) / stepY));
      rect = {
        x: BLOCK_CELL.x0 + col * stepX,
        y: BLOCK_CELL.y0 + row * stepY,
        w: node.w,
        h: BLOCK_CELL.h,
      };
    }
    if (!rect) return;
    const ink = this.dark ? INK_DARK : INK;
    const box = svgEl('rect', {
      class: 'rsm-drop-target',
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      rx: 8,
      fill: ink,
      'fill-opacity': 0.06,
      stroke: ink,
      'stroke-opacity': 0.45,
      'stroke-width': 2,
      'stroke-dasharray': '6 4',
    });
    box.style.pointerEvents = 'none';
    this.frameLayer.appendChild(box);
  }

  /** 移除落點提示(放手 / 取消拖曳時)。 */
  clearDropTarget(): void {
    this.frameLayer.querySelectorAll('.rsm-drop-target').forEach((el) => el.remove());
  }

  /** 縮放預覽:就地重 rough 該節點 + 重繞入射邊,不寫模型。 */
  previewResize(id: string, rect: { x: number; y: number; w: number; h: number }): void {
    if (!this.scene) return;
    const cache = this.nodeCache.get(id);
    const node = this.scene.nodes.find((n) => n.id === id);
    if (!cache || !node) return;
    const preview: SceneNode = { ...node, ...rect };
    this.fillNodeContent(cache.g, preview);
    cache.g.setAttribute('transform', `translate(${rect.x},${rect.y})`);
    cache.geomKey = ''; // 強制下次 render 重建。
    const previewScene = { ...this.scene, nodes: this.scene.nodes.map((n) => (n.id === id ? preview : n)) };
    for (const edge of previewScene.edges) {
      if (edge.source !== id && edge.target !== id) continue;
      const g = this.edgeEls.get(edge.id);
      if (g) updateEdgeGeometry(g, previewScene, edge);
    }
  }

  getNodeGroup(id: string): SVGGElement | undefined {
    return this.nodeCache.get(id)?.g;
  }
}
