// 匯出基元:把 SVG 序列化成可攜字串、或經 canvas 點陣化成 PNG/JPEG/WebP Blob。
// 改寫自 super-mermaid 的 webview/main.ts(renderPristineSvg / prepareSvgText /
// rasterize / cannotRasterize)。本檔只做純轉換,不依賴 mermaid;
// 由呼叫端(hook)決定是用 live SVG 還是重繪的 pristine SVG。

import type { ExportRasterOptions, RasterType } from '../types';

export interface PreparedSvg {
  serialized: string;
  width: number;
  height: number;
  /** 含 <foreignObject>(htmlLabels)→ 點陣化可能污染 canvas,呼叫端宜退回 SVG。 */
  hasForeignObject: boolean;
}

const RASTER_MIME: Record<RasterType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function sizeFromViewBox(svgEl: SVGSVGElement): { width: number; height: number } {
  const viewBox = (svgEl.getAttribute('viewBox') ?? '0 0 800 600').split(/[\s,]+/).map(Number);
  return {
    width: Math.max(1, Math.ceil(viewBox[2] || 800)),
    height: Math.max(1, Math.ceil(viewBox[3] || 600)),
  };
}

function finalizePrepared(svgEl: SVGSVGElement): PreparedSvg {
  const { width, height } = sizeFromViewBox(svgEl);
  svgEl.setAttribute('width', String(width));
  svgEl.setAttribute('height', String(height));
  svgEl.removeAttribute('style');
  const serialized = new XMLSerializer().serializeToString(svgEl);
  return { serialized, width, height, hasForeignObject: serialized.includes('<foreignObject') };
}

/** 解析 mermaid 重繪出來的 SVG 字串(htmlLabels 關閉的 pristine 版),整理成可匯出形式。 */
export function prepareSvgString(svgText: string): PreparedSvg | undefined {
  const holder = document.createElement('div');
  holder.innerHTML = svgText;
  const svgEl = holder.querySelector('svg');
  if (!svgEl) {
    return undefined;
  }
  return finalizePrepared(svgEl);
}

/** 整理一個已存在的 SVG 元素(就地設定尺寸、移除 style 後序列化)。 */
export function prepareSvgElement(svg: SVGSVGElement): PreparedSvg {
  return finalizePrepared(svg);
}

/**
 * 從畫面上 live SVG(已上色、可能被 pan/zoom 包了 viewport transform)複製一份、
 * 還原縮放平移後序列化。供同步的 exportSvg() 使用。
 */
export function serializeLiveSvg(svg: SVGSVGElement): PreparedSvg {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // 移除 svg-pan-zoom 注入的 viewport transform,讓匯出回到自然 viewBox 版面。
  const vp = clone.querySelector<SVGGElement>('.svg-pan-zoom_viewport');
  if (vp) {
    vp.removeAttribute('transform');
    vp.style.transform = '';
  }
  return finalizePrepared(clone);
}

const SVG_NS_EXPORT = 'http://www.w3.org/2000/svg';

/** 取 foreignObject 內的文字行(依 <br> 與區塊 <div> / 文字內 \n 斷行)。 */
function extractFoLines(el: Element): string[] {
  const lines: string[] = [];
  let cur = '';
  const flush = (): void => {
    if (cur.trim()) lines.push(cur.trim());
    cur = '';
  };
  const walk = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const parts = (child.textContent ?? '').split('\n');
        cur += parts[0];
        for (let i = 1; i < parts.length; i++) {
          flush();
          cur = parts[i];
        }
      } else if (child.nodeName === 'BR') {
        flush();
      } else if (child.nodeName === 'DIV') {
        flush();
        walk(child);
        flush();
      } else {
        walk(child); // span / strong / em / code → 視為行內
      }
    });
  };
  walk(el);
  flush();
  return lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** 在 foreignObject 子樹找第一個 color: 樣式值(供文字色)。 */
function findFoColor(el: Element): string | null {
  const stack: Element[] = [el];
  while (stack.length) {
    const e = stack.shift() as Element;
    const m = (e.getAttribute('style') ?? '').match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
    if (m) return m[1].trim();
    stack.push(...Array.from(e.children));
  }
  return null;
}

/**
 * 把 <foreignObject>(HTML 標籤)就地換成 SVG <text>,讓 canvas 點陣化不被污染
 * (Chromium 對含 foreignObject 的 SVG img 會 taint canvas → toBlob 失敗)。
 * 失真:粗體 / 斜體 / 隔間分隔線簡化為純文字置中;僅供 PNG 匯出(SVG 匯出保留 foreignObject)。
 */
export function flattenForeignObjects(svg: SVGSVGElement): void {
  for (const fo of Array.from(svg.querySelectorAll('foreignObject'))) {
    const x = parseFloat(fo.getAttribute('x') ?? '0');
    const y = parseFloat(fo.getAttribute('y') ?? '0');
    const w = parseFloat(fo.getAttribute('width') ?? '0');
    const h = parseFloat(fo.getAttribute('height') ?? '0');
    const lines = extractFoLines(fo);
    if (!lines.length) {
      fo.remove();
      continue;
    }
    const color = findFoColor(fo) ?? '#1f2937';
    // 巢狀 div = 結構化(ER/class 隔間)→ 用較小字避免溢出;單純標籤 → 對齊編輯器 14px/600。
    const structured = fo.querySelectorAll('div').length > 1;
    const fontSize = structured ? 13 : 14;
    const lineH = fontSize * 1.35;
    const text = document.createElementNS(SVG_NS_EXPORT, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', color);
    text.setAttribute('font-family', 'system-ui,-apple-system,"Segoe UI","Microsoft JhengHei",sans-serif');
    text.setAttribute('font-size', String(fontSize));
    text.setAttribute('font-weight', structured ? '400' : '600');
    const cx = x + w / 2;
    const startY = y + h / 2 - ((lines.length - 1) * lineH) / 2 + fontSize / 3;
    lines.forEach((ln, i) => {
      const tspan = document.createElementNS(SVG_NS_EXPORT, 'tspan');
      tspan.setAttribute('x', String(cx));
      tspan.setAttribute('y', String(startY + i * lineH));
      tspan.textContent = ln;
      text.appendChild(tspan);
    });
    fo.parentNode?.replaceChild(text, fo);
  }
}

export function svgBlob(serialized: string): Blob {
  const xml = serialized.startsWith('<?xml')
    ? serialized
    : '<?xml version="1.0" encoding="UTF-8"?>\n' + serialized;
  return new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
}

/** 把整理好的 SVG 經 Image + canvas 點陣化成 Blob。 */
export async function rasterizeToBlob(
  prepared: PreparedSvg,
  opts: ExportRasterOptions & { dark?: boolean } = {},
): Promise<Blob> {
  const scale = opts.scale ?? 2;
  const type = opts.type ?? 'png';
  const mime = RASTER_MIME[type];
  const transparent = opts.transparent === true;

  const blob = new Blob([prepared.serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('無法點陣化 SVG(圖片載入失敗)。'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(prepared.width * scale));
    canvas.height = Math.max(1, Math.round(prepared.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('取不到 Canvas 2D context。');
    }
    // JPEG 無 alpha,一律填背景;其餘格式僅在非透明時填。
    if (!transparent || mime === 'image/jpeg') {
      ctx.fillStyle = opts.background ?? (opts.dark ? '#1e1e1e' : '#ffffff');
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, prepared.width, prepared.height);
    return await canvasToBlob(canvas, mime, type === 'png' ? undefined : (opts.quality ?? 0.92));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          // toBlob 回 null 多半是 <foreignObject> 污染了 canvas。
          reject(new Error('匯出失敗:此圖含 HTML 標籤(foreignObject),請改用 SVG 匯出。'));
        }
      },
      mime,
      quality,
    );
  });
}

/** 觸發瀏覽器下載一個 Blob。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 給瀏覽器一點時間開始下載再回收 URL。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
