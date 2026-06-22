// 增量場景渲染器:把 EditorScene 畫成手繪 SVG。
// 節點用 rough.js(快取 Drawable,幾何不變只改 transform);邊每次重建(成本低)。
// 互動層拖曳時呼叫 previewMove() 只改 transform + 重繞入射邊,放手後才 render() 重 rough。

import rough from 'roughjs';
import { ensureSketchFont } from '../../themes/sketch';
import { boundingBox } from '../scene/geometry';
import { moveNodes } from '../scene/scene-ops';
import type { EditorScene, SceneNode } from '../scene/types';
import { svgEl, XHTML_NS } from './dom';
import { renderEdge, buildMarkers, updateEdgeGeometry } from './edges';
import { INK, INK_DARK, paletteByIndex, seedFor } from './palette';
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

  constructor(opts: SceneRendererOptions = {}) {
    this.gen = (rough as unknown as { generator(): RoughGeneratorLike }).generator();
    this.dark = opts.dark ?? false;
    this.baseSeed = opts.seed ?? 42;
    this.fontUrl = opts.fontUrl;
    this.look = opts.look ?? 'sketch';
  }

  /** clean 風的柔和陰影濾鏡(貼近 colorful 主題的卡片陰影)。 */
  private appendShadowFilter(): void {
    const sh = svgEl('filter', { id: NODE_SHADOW_ID, x: '-30%', y: '-30%', width: '160%', height: '160%' });
    const fd = svgEl('feDropShadow', {
      dx: 0,
      dy: 2,
      stdDeviation: 3,
      'flood-color': this.dark ? '#000000' : '#1e293b',
      'flood-opacity': this.dark ? '0.55' : '0.16',
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

  private static geomKey(n: SceneNode): string {
    return `${n.shape}|${Math.round(n.w)}|${Math.round(n.h)}|${n.style?.fill ?? ''}|${n.style?.stroke ?? ''}`;
  }

  /** 全量 diff 渲染(新增 / 移除 / 幾何變更重 rough,純位移只改 transform)。 */
  render(scene: EditorScene): void {
    this.scene = scene;
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
    const ink = this.dark ? INK_DARK : INK;
    const PAD = 18;
    const LABEL_H = 22;
    for (const c of scene.containers) {
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
        fill: this.dark ? 'rgba(148,163,184,0.06)' : 'rgba(100,116,139,0.06)',
        stroke: this.dark ? '#64748b' : '#94a3b8',
        'stroke-width': 1.5,
        'stroke-dasharray': '6 5',
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
          `font:600 12px/${LABEL_H}px var(--rsm-editor-font);color:${ink};opacity:0.75;` +
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
