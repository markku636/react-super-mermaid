// 增量場景渲染器:把 EditorScene 畫成手繪 SVG。
// 節點用 rough.js(快取 Drawable,幾何不變只改 transform);邊每次重建(成本低)。
// 互動層拖曳時呼叫 previewMove() 只改 transform + 重繞入射邊,放手後才 render() 重 rough。

import rough from 'roughjs';
import { ensureSketchFont } from '../../themes/sketch';
import { boundingBox } from '../scene/geometry';
import { moveNodes } from '../scene/scene-ops';
import type { EditorScene, SceneNode } from '../scene/types';
import { svgEl, XHTML_NS } from './dom';
import { renderEdge, buildMarkers, markerIdFor, updateEdgeGeometry } from './edges';
import { INK, clusterByIndex, paletteByIndex, seedFor } from './palette';
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
  private containersLayer!: SVGGElement;
  edgesLayer!: SVGGElement;
  nodesLayer!: SVGGElement;
  overlayLayer!: SVGGElement;

  private nodeCache = new Map<string, NodeCache>();
  private edgeEls = new Map<string, SVGGElement>();
  private scene: EditorScene | null = null;
  /** sequence:訊息陳述 index → 世界座標矩形(供雙擊編輯訊息文字定位)。 */
  private seqMsgRects = new Map<number, { x: number; y: number; w: number; h: number }>();
  /** sequence:整張圖的世界座標範圍(供 fit;sequence 內容延伸到節點下方,不能只用節點 bbox)。 */
  private seqBounds: { x: number; y: number; w: number; h: number } | null = null;

  /** 取得 sequence 訊息的世界座標矩形(host 開啟文字編輯器定位用)。 */
  getSeqMsgRect(index: number): { x: number; y: number; w: number; h: number } | undefined {
    return this.seqMsgRects.get(index);
  }

  /** sequence 模式下的整張圖範圍(供 fit 用);其他圖種回 null(改用節點 bbox)。 */
  getContentBounds(): { x: number; y: number; w: number; h: number } | null {
    return this.seqBounds;
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
    this.containersLayer = svgEl('g', { class: 'rsm-containers' });
    this.edgesLayer = svgEl('g', { class: 'rsm-edges' });
    this.nodesLayer = svgEl('g', { class: 'rsm-nodes' });
    this.overlayLayer = svgEl('g', { class: 'rsm-overlay' });
    parent.appendChild(this.defs);
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

    // 依節點順序循序取色(非 hash),相鄰節點配色和諧。
    const idx = this.scene ? this.scene.nodes.findIndex((n) => n.id === node.id) : 0;
    const pal = paletteByIndex(idx >= 0 ? idx : 0);
    const opts = {
      ...ROUGH_LOOKS[this.look],
      seed: seedFor(node.id, this.baseSeed),
      stroke: node.style?.stroke ?? pal.stroke,
      fill: node.style?.fill ?? pal.fill,
    };
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

    // label foreignObject(置中):一律深色墨字(節點底色都是淺色)+ 跟隨 look 的字體 → 清晰。
    if (node.label) {
      const fo = svgEl('foreignObject', { x: 0, y: 0, width: node.w, height: node.h });
      fo.style.pointerEvents = 'none';
      const div = document.createElementNS(XHTML_NS, 'div') as unknown as HTMLDivElement;
      div.textContent = node.label.replace(/<br\s*\/?>/g, '\n');
      div.setAttribute(
        'style',
        'display:flex;align-items:center;justify-content:center;width:100%;height:100%;' +
          'box-sizing:border-box;padding:4px 8px;font:600 14px/1.3 var(--rsm-editor-font);' +
          `color:${INK};text-align:center;white-space:pre-wrap;word-break:break-word;overflow:hidden;`,
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
      `font-weight:700;text-align:center;padding:5px 8px;border-bottom:1px solid ${INK};` +
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
    const title = mkSection(
      `font-weight:700;text-align:center;padding:4px 8px;border-bottom:1px solid ${INK};white-space:pre-wrap;`,
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
        row.textContent = genericDisplay(r);
        row.setAttribute('style', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;');
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
    this.nodeCache.clear();
    this.edgeEls.clear();
    this.seqMsgRects.clear();
    for (const layer of [this.containersLayer, this.edgesLayer, this.nodesLayer, this.overlayLayer]) {
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
      o: { dash?: boolean; w?: number; marker?: boolean } = {},
    ): SVGPathElement => {
      const p = svgEl('path', { d: `M${x1},${y1} L${x2},${y2}`, fill: 'none', stroke: ink, 'stroke-width': o.w ?? 1.6 });
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      if (o.dash) p.setAttribute('stroke-dasharray', '5 4');
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

    // 生命線
    for (const c of cols) g.appendChild(line(c.cx, HEAD_Y + HEAD_H, c.cx, bottomY, { dash: true, w: 1 }));

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
        hit.style.cursor = 'text';
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
        nhit.style.cursor = 'text';
        g.appendChild(nhit);
      }
    }

    // 參與者方框:頂端(帶 data-node-id 供選取 / 雙擊改名)+ 底端(裝飾)。
    // clean 風套用與一般節點相同的柔和陰影,視覺一致。
    const shadow = this.look === 'clean' ? `url(#${NODE_SHADOW_ID})` : '';
    const txt = this.dark ? '#e9ecef' : '#1f2937';
    for (const c of cols) {
      const top = svgEl('g', { 'data-node-id': c.id, class: 'rsm-node' });
      const tb = svgEl('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: c.actor ? 16 : 6, fill: fillBox, stroke: ink, 'stroke-width': 1.5 });
      if (shadow) tb.style.filter = shadow;
      top.appendChild(tb);
      top.appendChild(this.seqText(c.cx, c.y + c.h / 2 + 1, c.label, txt, 13, 700, 'middle'));
      g.appendChild(top);
      const bb = svgEl('rect', { x: c.x, y: bottomY + 4, width: c.w, height: HEAD_H, rx: c.actor ? 16 : 6, fill: fillBox, stroke: ink, 'stroke-width': 1.5 });
      if (shadow) bb.style.filter = shadow;
      bb.style.pointerEvents = 'none';
      g.appendChild(bb);
      g.appendChild(this.seqText(c.cx, bottomY + 4 + HEAD_H / 2 + 1, c.label, txt, 13, 700, 'middle'));
    }

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
    const byId = new Map(scene.nodes.map((n) => [n.id, n] as const));
    const PAD = 18;
    const LABEL_H = 22;
    let ci = 0;
    for (const c of scene.containers) {
      // 對齊 Edit Diagram:每個 subgraph 取叢集底色 + 同色標題(色相循序)。
      const cp = clusterByIndex(ci++);
      const rects = c.childNodeIds
        .map((id) => byId.get(id))
        .filter((n): n is SceneNode => Boolean(n))
        .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
      const bb = boundingBox(rects);
      if (!bb) continue;
      const x = bb.x - PAD;
      const y = bb.y - PAD - LABEL_H;
      const w = bb.w + PAD * 2;
      const h = bb.h + PAD * 2 + LABEL_H;
      const box = svgEl('rect', {
        x,
        y,
        width: w,
        height: h,
        rx: 8,
        fill: cp.fill,
        stroke: cp.stroke,
        'stroke-width': 1.5,
      });
      box.style.pointerEvents = 'none';
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
