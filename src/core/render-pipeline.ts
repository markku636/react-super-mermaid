// 渲染管線(框架無關),供 React hook 與一次性 renderDiagram() 共用。
// 順序:ensureStyles → resolveTheme →(sketch 先載字)→ initialize → render → 後處理。

import { assertBrowser } from '../env';
import type { MermaidLike, MermaidTheme, RenderDiagramOptions, RenderResult } from '../types';
import { stripCheckDirectives } from './checks/parse';
import { boostLegibility, colorizeDiagram } from './themes/colorize';
import { ensureSketchFont, SKETCH_FONT, sketchifyDiagram } from './themes/sketch';
import { ensureStyles } from './ensure-styles';
import { loadMermaid } from './load-mermaid';
import { resolveTheme, type PostProcess } from './resolve-theme';

// mermaid.render 需要唯一且合法的 id,用模組級流水號確保不衝突(無 DOM,SSR 安全)。
let renderSeq = 0;

export interface RenderToSvgArgs {
  code: string;
  theme: MermaidTheme;
  dark: boolean;
  seed: number;
  fontUrl?: string;
  mermaidConfig?: Record<string, unknown>;
  mermaid: MermaidLike;
  /** 強制關閉 htmlLabels(供匯出 pristine SVG 用,避免 foreignObject)。 */
  pristine?: boolean;
}

export interface RenderedSvg {
  svgString: string;
  id: string;
  postProcess: PostProcess;
}

function buildConfig(args: RenderToSvgArgs): Record<string, unknown> {
  const resolved = resolveTheme(args.theme, args.dark);
  const htmlLabels = args.pristine ? false : true;
  const config: Record<string, unknown> = {
    startOnLoad: false,
    theme: resolved.base,
    securityLevel: 'loose',
    htmlLabels,
    flowchart: { htmlLabels, useMaxWidth: false },
  };
  if (args.theme === 'colorful') {
    config.flowchart = { htmlLabels, useMaxWidth: false, nodeSpacing: 60, rankSpacing: 65, padding: 12 };
  }
  if (resolved.look === 'handDrawn') {
    config.look = 'handDrawn';
    config.handDrawnSeed = args.seed;
    config.fontFamily = SKETCH_FONT;
  }
  // host 自訂設定最後覆蓋(flowchart 做一層淺合併)。
  if (args.mermaidConfig) {
    const userFlowchart = (args.mermaidConfig.flowchart as Record<string, unknown>) ?? {};
    Object.assign(config, args.mermaidConfig);
    config.flowchart = { ...(config.flowchart as Record<string, unknown>), ...userFlowchart };
  }
  return config;
}

/** 解析設定 → 載字(sketch)→ initialize → render,回傳 mermaid 的 SVG 字串。 */
export async function renderToSvg(args: RenderToSvgArgs): Promise<RenderedSvg> {
  const resolved = resolveTheme(args.theme, args.dark);
  if (resolved.look === 'handDrawn') {
    // 先載入手寫字體再 render,確保 mermaid 量測文字寬度時用的就是 Virgil。
    await ensureSketchFont(args.fontUrl);
  }
  args.mermaid.initialize(buildConfig(args));
  renderSeq += 1;
  const id = `rsm-${renderSeq}`;
  // 檢查提示指令在這個唯一咽喉點剝除,viewer / renderDiagram / 編輯器排版三條路徑同時受惠。
  // (原始碼本身不動 —— 編輯器 round-trip 讀的是原始碼,提示不會在來回轉換中遺失。)
  const { svg } = await args.mermaid.render(id, stripCheckDirectives(args.code));
  return { svgString: svg, id, postProcess: args.pristine ? 'none' : resolved.postProcess };
}

/** 把 mermaid SVG 字串塞入 host、套後處理、設定填滿尺寸,回傳 live SVG 元素。 */
export function mountSvg(
  host: HTMLElement,
  svgString: string,
  postProcess: PostProcess,
  opts: { dark: boolean; seed: number },
): SVGSVGElement | null {
  host.innerHTML = svgString;
  const svg = host.querySelector('svg');
  if (!svg) {
    return null;
  }
  applyPostProcess(svg, postProcess, opts);
  svg.style.maxWidth = 'none';
  svg.style.width = '100%';
  svg.style.height = '100%';
  return svg;
}

export function applyPostProcess(
  svg: SVGSVGElement,
  postProcess: PostProcess,
  opts: { dark: boolean; seed: number },
): void {
  if (postProcess === 'colorful') {
    colorizeDiagram(svg, { dark: opts.dark });
  } else if (postProcess === 'sketch') {
    // 原生 handDrawn 不作用於 sequenceDiagram,這裡補手繪後處理;非序列圖會自動略過。
    sketchifyDiagram(svg, { dark: opts.dark, seed: opts.seed });
  }
  // 字體清晰度:所有主題(含原生 neutral/forest/dark)都套用,只加粗不改色,安全。
  boostLegibility(svg);
}

/**
 * 一次性渲染:載入 mermaid、渲染、後處理並(若有 container)注入頁面。
 * 不附 pan/zoom — 適合靜態美化輸出。互動請用 createViewer / <MermaidViewer>。
 */
export async function renderDiagram(opts: RenderDiagramOptions): Promise<RenderResult> {
  assertBrowser('renderDiagram');
  const dark = opts.dark ?? false;
  const seed = opts.seed ?? 42;
  if (opts.injectStyles !== false) {
    ensureStyles();
  }
  const mermaid = await loadMermaid({ source: opts.mermaid });
  const { svgString, id, postProcess } = await renderToSvg({
    code: opts.code,
    theme: opts.theme ?? 'colorful',
    dark,
    seed,
    fontUrl: opts.fontUrl,
    mermaidConfig: opts.mermaidConfig,
    mermaid,
  });

  const host =
    typeof opts.container === 'string'
      ? document.querySelector<HTMLElement>(opts.container)
      : (opts.container ?? document.createElement('div'));
  if (!host) {
    throw new Error(`[react-super-mermaid] 找不到 container:${String(opts.container)}`);
  }
  const svg = mountSvg(host, svgString, postProcess, { dark, seed });
  if (!svg) {
    throw new Error('[react-super-mermaid] mermaid 未輸出 SVG。');
  }
  return { svg, svgString, id };
}
