// 預設排版引擎:重用既有 render-pipeline 把場景序列化的 mermaid 渲染到隱藏 host,
// 讀回 mermaid 自身(dagre)算出的節點座標。零新依賴、mermaid-faithful。

import { assertBrowser } from '../../../env';
import { loadMermaid } from '../../load-mermaid';
import { renderToSvg } from '../../render-pipeline';
import { boundingBox, type Rect } from '../scene/geometry';
import type { EditorScene, SceneNode } from '../scene/types';
import type { LayoutContext, LayoutEngine } from './types';

// mermaid 11 的 flowchart 節點 DOM id 形如 `<renderId>-flowchart-<作者id>-<n>`
// (例:rsm-1-flowchart-A-0)。先剝掉已知的 renderId 前綴,再用 `<型別>-<作者id>-<n>`
// 取出作者 id(作者 id 可含連字號,故用貪婪 (.+) 搭配尾端 -<數字>)。
const NODE_ID_RE = /^[A-Za-z][\w]*-(.+)-\d+$/;

const PADDING = 40;

function authorIdFromDomId(domId: string, renderId: string): string | undefined {
  const prefix = `${renderId}-`;
  const rest = domId.startsWith(prefix) ? domId.slice(prefix.length) : domId;
  const m = rest.match(NODE_ID_RE);
  return m ? m[1] : undefined;
}

/** 取元素在 SVG root 座標系中的中心點與尺寸(假設無縮放,mermaid useMaxWidth:false 成立)。 */
function readBox(g: SVGGraphicsElement): { cx: number; cy: number; w: number; h: number } | null {
  let bb: DOMRect;
  try {
    bb = g.getBBox();
  } catch {
    return null;
  }
  const ctm = g.getCTM();
  if (!ctm) return { cx: bb.x + bb.width / 2, cy: bb.y + bb.height / 2, w: bb.width, h: bb.height };
  const c = new DOMPoint(bb.x + bb.width / 2, bb.y + bb.height / 2).matrixTransform(ctm);
  return { cx: c.x, cy: c.y, w: bb.width, h: bb.height };
}

export const mermaidSvgLayout: LayoutEngine = {
  async layout(scene: EditorScene, ctx: LayoutContext): Promise<EditorScene> {
    assertBrowser('mermaidSvgLayout');
    const mermaid = await loadMermaid({ source: ctx.mermaid });

    // pristine 渲染(htmlLabels:false)→ 節點是 <rect>,getBBox 可靠。
    const { svgString, id: renderId } = await renderToSvg({
      code: ctx.code,
      theme: 'default',
      dark: false,
      seed: 42,
      mermaid,
      pristine: true,
    });

    // 掛到隱藏但仍會排版的 host(visibility:hidden,非 display:none)。
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;width:2000px;height:2000px;';
    host.innerHTML = svgString;
    document.body.appendChild(host);

    const positions = new Map<string, { cx: number; cy: number; w: number; h: number }>();
    try {
      const svg = host.querySelector('svg');
      if (svg) {
        svg.querySelectorAll<SVGGElement>('g.node[id]').forEach((g) => {
          const author = authorIdFromDomId(g.id, renderId);
          if (!author) return;
          const box = readBox(g);
          if (box) positions.set(author, box);
        });
      }
    } finally {
      host.remove();
    }

    if (positions.size === 0) {
      // 抓不到座標 → 原樣返回(讓互動層用既有/預設座標),避免破壞。
      return scene;
    }

    // 正規化:平移使最小左上角落在 (PADDING, PADDING)。
    let minX = Infinity;
    let minY = Infinity;
    for (const [, b] of positions) {
      minX = Math.min(minX, b.cx - b.w / 2);
      minY = Math.min(minY, b.cy - b.h / 2);
    }
    const shiftX = PADDING - minX;
    const shiftY = PADDING - minY;

    // mermaid 以自身字型量節點;編輯器標籤用較大的 14px → 短標籤(如 "DB")可能在抓到的
    // 框內換行。對每個節點以編輯器字型估一個下限,只把過窄/過矮者撐大(不縮小 mermaid 佈局)。
    const labelMin = (label: string): { w: number; h: number } => {
      const lines = label.split(/<br\s*\/?>|\n/);
      const longest = lines.reduce((m, s) => Math.max(m, s.length), 0);
      return { w: longest * 9 + 22, h: lines.length * 19 + 14 };
    };
    const nodes: SceneNode[] = scene.nodes.map((n) => {
      const b = positions.get(n.id);
      if (!b) return n;
      const min = n.label ? labelMin(n.label) : { w: 0, h: 0 };
      return {
        ...n,
        x: b.cx - b.w / 2 + shiftX,
        y: b.cy - b.h / 2 + shiftY,
        w: Math.max(b.w, min.w),
        h: Math.max(b.h, min.h),
      };
    });

    // 容器幾何:由子節點 bounding box + padding 推得(比抓 cluster id 穩健)。
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const containers = scene.containers.map((c) => {
      const childRects: Rect[] = c.childNodeIds
        .map((cid) => byId.get(cid))
        .filter((n): n is SceneNode => Boolean(n))
        .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
      const bb = boundingBox(childRects);
      if (!bb) return c;
      const pad = 24;
      return { ...c, x: bb.x - pad, y: bb.y - pad - 18, w: bb.w + pad * 2, h: bb.h + pad * 2 + 18 };
    });

    return { ...scene, nodes, containers, layoutOwner: 'user' };
  },
};
