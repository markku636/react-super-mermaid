// 預設排版引擎:重用既有 render-pipeline 把場景序列化的 mermaid 渲染到隱藏 host,
// 讀回 mermaid 自身(dagre)算出的節點座標。零新依賴、mermaid-faithful。

import { assertBrowser } from '../../../env';
import { loadMermaid } from '../../load-mermaid';
import { authorIdFromDomId, nodeLabelText } from '../../node-index';
import { renderToSvg } from '../../render-pipeline';
import { stripHtmlFormattingTags } from '../../strip-html-formatting';
import { boundingBox, type Rect } from '../scene/geometry';
import { fitToContent } from '../render/node-metrics';
import type { EditorScene, SceneNode } from '../scene/types';
import type { LayoutContext, LayoutEngine } from './types';

const PADDING = 40;

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

/**
 * 內建後援排版:依容器分組,每組排成格狀,組與組之間上下堆疊。
 *
 * 只在「向 mermaid 問座標失敗」時用。刻意做得簡單且**確定性** —— 它的工作不是排得漂亮,
 * 而是保證每個元素都在畫面上、各自分開、可以被拖到使用者要的位置。
 */
function gridLayout(scene: EditorScene): EditorScene {
  const GAP_X = 46;
  const GAP_Y = 40;
  const GROUP_GAP = 56;
  const byParent = new Map<string | null, SceneNode[]>();
  for (const n of scene.nodes) {
    const p = n.parentId ?? null;
    byParent.set(p, [...(byParent.get(p) ?? []), n]);
  }
  const placed = new Map<string, { x: number; y: number }>();
  let cursorY = PADDING;
  // 先排根層,再依序排每個容器(容器本身的框由 renderer 依子節點 bbox 算)。
  const groups: Array<string | null> = [null, ...scene.containers.map((c) => c.id)];
  for (const gid of groups) {
    const list = byParent.get(gid) ?? [];
    if (!list.length) continue;
    const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(list.length))));
    const colW = Math.max(...list.map((n) => n.w)) + GAP_X;
    const rowH = Math.max(...list.map((n) => n.h)) + GAP_Y;
    list.forEach((n, i) => {
      placed.set(n.id, {
        x: PADDING + (i % cols) * colW,
        y: cursorY + Math.floor(i / cols) * rowH,
      });
    });
    cursorY += Math.ceil(list.length / cols) * rowH + GROUP_GAP;
  }
  return {
    ...scene,
    nodes: scene.nodes.map((n) => {
      const p = placed.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
    layoutOwner: 'user',
  };
}

export const mermaidSvgLayout: LayoutEngine = {
  async layout(scene: EditorScene, ctx: LayoutContext): Promise<EditorScene> {
    assertBrowser('mermaidSvgLayout');
    // 空場景 / 空白原始碼:mermaid render 會丟 "No diagram type detected"。無需排版,原樣返回
    // (空白畫布提示會顯示),避免載入空 / 純空白圖時拋例外。
    if (scene.nodes.length === 0 || !ctx.code.trim()) return scene;
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
        const spare: Array<{ text: string; box: NonNullable<ReturnType<typeof readBox>> }> = [];
        svg.querySelectorAll<SVGGElement>('g.node[id]').forEach((g) => {
          const box = readBox(g);
          if (!box) return;
          const author = authorIdFromDomId(g.id, renderId);
          if (author) positions.set(author, box);
          spare.push({ text: nodeLabelText(g), box });
        });
        // 退路:用「節點文字含這個 id / label」對。各圖種的 DOM id 規則不一致,萬一 id 還原失敗,
        // 沒有這條退路整張圖會全部疊在原點(比錯位難看得多)。
        for (const n of scene.nodes) {
          if (positions.has(n.id)) continue;
          // pristine 渲染前已剝掉行內 HTML 標籤,比對鍵也得剝 —— 否則含 <b> 的標籤永遠對不上。
          const key = stripHtmlFormattingTags(n.label || n.id).trim();
          const hit = key ? spare.find((s) => s.text.includes(key)) : undefined;
          if (hit) positions.set(n.id, hit.box);
        }
      }
    } finally {
      host.remove();
    }

    if (positions.size === 0) {
      // 有些圖種(C4 等)的渲染器不吐 `g.node[id]`,一個座標都抓不到 —— 原樣返回代表整張圖疊在
      // 原點,比排得不完美難看得多。改用內建的簡單分組排版,至少每個元素都看得到、拖得動。
      return gridLayout(scene);
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
      const placed: SceneNode = {
        ...n,
        x: b.cx - b.w / 2 + shiftX,
        y: b.cy - b.h / 2 + shiftY,
        w: Math.max(b.w, min.w),
        h: Math.max(b.h, min.h),
      };
      // class / er 的隔間框是本編輯器自己畫的:mermaid 是用它自己的字型與內距量的,直接沿用
      // 會讓框比內容高一大截(框底浮一塊死白)。位置照 mermaid 的,尺寸校正回內容尺寸。
      return fitToContent(placed);
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
