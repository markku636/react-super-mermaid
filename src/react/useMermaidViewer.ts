// 把 core 引擎(載入 / 渲染 / pan-zoom / 搜尋 / 匯出)接到 React 生命週期的內部 hook。
// 對外的 <MermaidViewer> 與命令式 ref handle 都建立在這之上。

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type {
  DiagramCheck,
  DiagramTip,
  ExportRasterOptions,
  MermaidSource,
  MermaidTheme,
  SearchState,
  SvgPanZoomSource,
} from '../types';
import { loadMermaid } from '../core/load-mermaid';
import { loadSvgPanZoom } from '../core/load-svg-pan-zoom';
import { ensureStyles } from '../core/ensure-styles';
import { applyPostProcess, mountSvg, renderToSvg } from '../core/render-pipeline';
import { resolveTheme } from '../core/resolve-theme';
import { attachPanZoom, type PanZoomController } from '../core/pan-zoom';
import { createSearch, type SearchController } from '../core/search';
import { mergeChecks, parseChecks } from '../core/checks/parse';
import { mergeTips, normalizeTips, parseTips } from '../core/tips/parse';
import { attachHoverTips, type GetNodeTip, type HoverTipsController } from '../core/tips/hover';
import {
  annotateChecks,
  type ChecksController,
  type ResolvedCheckGroup,
} from '../core/checks/annotate';
import {
  downloadBlob,
  prepareSvgElement,
  rasterizeToBlob,
  serializeLiveSvg,
  svgBlob,
} from '../core/export';

export type RenderStatus = 'loading' | 'ready' | 'error';

export interface UseMermaidViewerOptions {
  code: string;
  theme: MermaidTheme;
  dark: boolean;
  seed: number;
  fontUrl?: string;
  mermaidConfig?: Record<string, unknown>;
  mermaid?: MermaidSource;
  svgPanZoom?: SvgPanZoomSource;
  panZoom: boolean;
  touchGestures: boolean;
  injectStyles: boolean;
  /** host 傳入的檢查提示(與原始碼解析結果合併,同 target 覆寫)。 */
  checks?: DiagramCheck[];
  /** 是否解析原始碼中的 `%% @check` 指令,預設 true。 */
  checksFromSource?: boolean;
  /** 角標初始是否顯示。 */
  checksVisible?: boolean;
  /** 點擊角標時觸發(host 用來開跳窗)。 */
  onCheckActivate?: (group: ResolvedCheckGroup) => void;
  /** 是否啟用節點懸停提示,預設 true。 */
  nodeTips?: boolean;
  /** host 傳入的懸停提示(與原始碼解析結果合併,同 target 覆寫)。可用 Record 簡寫。 */
  tips?: DiagramTip[] | Record<string, string>;
  /** 是否解析原始碼中的 `%% @tip` 指令,預設 true。 */
  tipsFromSource?: boolean;
  /** 動態決定節點提示;回傳 null = 不顯示,undefined = 交回內建查找。 */
  getNodeTip?: GetNodeTip;
  /** 無授權提示時退回顯示節點完整文字 + id,預設 false。 */
  tipFallbackLabel?: boolean;
  onRender?: (svg: SVGSVGElement) => void;
  onError?: (err: Error) => void;
}

export interface UseMermaidViewerResult {
  stageRef: RefObject<HTMLDivElement>;
  status: RenderStatus;
  error: string;
  zoomPercent: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  reset: () => void;
  actualSize: () => void;
  getZoomPercent: () => number;
  search: (term: string, pan?: boolean) => SearchState;
  next: (pan?: boolean) => SearchState;
  prev: (pan?: boolean) => SearchState;
  clearSearch: () => void;
  exportSvg: () => string;
  exportPng: (opts?: ExportRasterOptions) => Promise<Blob>;
  downloadSvg: (filename?: string) => void;
  downloadPng: (filename?: string, opts?: ExportRasterOptions) => Promise<void>;
  getSvg: () => SVGSVGElement | null;
  /** 本次渲染成功掛上的提示群組(每次重繪後會換新物件)。 */
  checkGroups: ResolvedCheckGroup[];
  /** 合併後的提示清單(含未能在圖上定位的)。 */
  checks: DiagramCheck[];
  /** 高亮某個提示節點;undefined = 清除。 */
  focusCheck: (key: string | undefined) => void;
  /** 把圖平移到某個提示節點並高亮。 */
  panToCheck: (group: ResolvedCheckGroup) => void;
}

export function useMermaidViewer(opts: UseMermaidViewerOptions): UseMermaidViewerResult {
  const {
    code,
    theme,
    dark,
    seed,
    fontUrl,
    mermaidConfig,
    mermaid,
    svgPanZoom,
    panZoom,
    touchGestures,
    injectStyles,
    checks: checksProp,
    checksFromSource = true,
    checksVisible = true,
    onCheckActivate,
    nodeTips = true,
    tips: tipsProp,
    tipsFromSource = true,
    getNodeTip,
    tipFallbackLabel = false,
    onRender,
    onError,
  } = opts;

  const [status, setStatus] = useState<RenderStatus>('loading');
  const [error, setError] = useState('');
  const [zoomPercent, setZoomPercent] = useState(100);
  const [checkGroups, setCheckGroups] = useState<ResolvedCheckGroup[]>([]);

  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pzRef = useRef<PanZoomController | null>(null);
  const prevCodeRef = useRef<string | null>(null);
  const checksRef = useRef<ChecksController | null>(null);
  const tipsCtlRef = useRef<HoverTipsController | null>(null);

  // 提示解析只跟原始碼有關,memo 起來避免每次 render 重跑正則。
  const sourceChecks = useMemo(
    () => (checksFromSource ? parseChecks(code) : []),
    [code, checksFromSource],
  );
  const checks = useMemo(
    () => mergeChecks(sourceChecks, checksProp),
    [sourceChecks, checksProp],
  );

  // 懸停提示解析也只跟原始碼 / prop 有關,memo 避免每次 render 重跑正則。
  const sourceTips = useMemo(
    () => (tipsFromSource ? parseTips(code) : []),
    [code, tipsFromSource],
  );
  const tips = useMemo(
    () => mergeTips(sourceTips, normalizeTips(tipsProp)),
    [sourceTips, tipsProp],
  );

  // 這些值在 async 渲染流程中被讀取,放 ref 避免列進 effect 依賴而造成整張圖重繪。
  const checksVisibleRef = useRef(checksVisible);
  checksVisibleRef.current = checksVisible;
  const onCheckActivateRef = useRef(onCheckActivate);
  onCheckActivateRef.current = onCheckActivate;
  const getNodeTipRef = useRef(getNodeTip);
  getNodeTipRef.current = getNodeTip;

  // 把易變的設定放進 ref,讓 async loader / 匯出讀到最新值而不必列為 effect 依賴。
  const mermaidSourceRef = useRef<MermaidSource | undefined>(mermaid);
  const cfgRef = useRef<{
    theme: MermaidTheme;
    dark: boolean;
    seed: number;
    fontUrl?: string;
    mermaidConfig?: Record<string, unknown>;
    code: string;
    checks: DiagramCheck[];
    checksVisible: boolean;
  }>({ theme, dark, seed, fontUrl, mermaidConfig, code, checks: [], checksVisible: true });
  mermaidSourceRef.current = mermaid;
  cfgRef.current = { theme, dark, seed, fontUrl, mermaidConfig, code, checks, checksVisible };

  const getSvg = useCallback(() => svgRef.current, []);

  // 搜尋控制器:建立一次,透過 ref 讀當前 SVG 與 pan-zoom。
  const searchRef = useRef<SearchController | null>(null);
  const searchController: SearchController = (searchRef.current ??= createSearch(getSvg, (el) =>
    pzRef.current?.panToElement(el),
  ));

  const syncZoom = useCallback(() => {
    const pct = pzRef.current?.getZoomPercent();
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      setZoomPercent(pct);
    }
  }, []);

  // mermaidConfig 物件每次 render 身分可能改變 → 以序列化值當依賴,避免無謂重繪。
  const mermaidConfigKey = useMemo(
    () => (mermaidConfig ? JSON.stringify(mermaidConfig) : ''),
    [mermaidConfig],
  );

  useEffect(() => {
    let cancelled = false;
    const host = stageRef.current;
    if (!host) {
      return undefined;
    }
    if (injectStyles) {
      ensureStyles();
    }
    const keepView = prevCodeRef.current === code;

    const run = async (): Promise<void> => {
      setStatus('loading');
      setError('');
      try {
        const mermaidInst = await loadMermaid({ source: mermaidSourceRef.current });
        const { svgString, postProcess, id: renderId } = await renderToSvg({
          code,
          theme,
          dark,
          seed,
          fontUrl,
          mermaidConfig,
          mermaid: mermaidInst,
        });
        if (cancelled) {
          return;
        }
        // 切主題(同一張圖)時保留目前縮放 / 位置。
        const prevView = keepView ? (pzRef.current?.capture() ?? null) : null;
        pzRef.current?.destroy();
        pzRef.current = null;
        checksRef.current?.destroy();
        checksRef.current = null;
        tipsCtlRef.current?.destroy();
        tipsCtlRef.current = null;

        const svg = mountSvg(host, svgString, postProcess, { dark, seed });
        if (!svg) {
          throw new Error('mermaid 未輸出 SVG。');
        }
        svgRef.current = svg;

        // 注意順序:必須在 mountSvg(內含 applyPostProcess)之後才掛角標 ——
        // colorize 會重刷節點樣式,先掛會被洗掉。
        if (checks.length > 0) {
          checksRef.current = annotateChecks(svg, checks, {
            renderId,
            visible: checksVisibleRef.current,
            onActivate: (group) => onCheckActivateRef.current?.(group),
          });
          setCheckGroups(checksRef.current.groups);
        } else {
          setCheckGroups([]);
        }

        // 懸停提示:掛在角標之後(有檢查的節點要借角標 <title> 當摘要、懸停角標時要讓路)。
        // tooltip div 放進 .rsm-canvas(stage 的 positioned 父層);headless 情境退回 stage 自身。
        if (nodeTips) {
          tipsCtlRef.current = attachHoverTips(svg, host.parentElement ?? host, {
            renderId,
            tips,
            getTip: (ctx) => getNodeTipRef.current?.(ctx),
            fallbackLabel: tipFallbackLabel,
          });
        }

        if (panZoom) {
          const factory = await loadSvgPanZoom(svgPanZoom);
          if (cancelled) {
            return;
          }
          if (factory) {
            pzRef.current = attachPanZoom(svg, factory, {
              onZoom: syncZoom,
              gestures: touchGestures,
            });
            if (prevView) {
              pzRef.current.restore(prevView);
            }
            syncZoom();
          }
        }

        prevCodeRef.current = code;
        setStatus('ready');
        onRender?.(svg);
        searchController.rerun(false);
      } catch (e) {
        if (cancelled) {
          return;
        }
        // 渲染失敗:保留上一張成功的 SVG(此時尚未覆寫 host),僅回報錯誤。
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err.message);
        setStatus('error');
        onError?.(err);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    code,
    theme,
    dark,
    seed,
    fontUrl,
    mermaidConfigKey,
    panZoom,
    touchGestures,
    injectStyles,
    checks,
    tips,
    nodeTips,
    tipFallbackLabel,
  ]);

  // 角標顯示 / 隱藏不需要重繪整張圖,直接操作既有 controller。
  useEffect(() => {
    checksRef.current?.setVisible(checksVisible);
  }, [checksVisible, checkGroups]);

  // 卸載時清掉 pan-zoom、角標與懸停提示監聽。
  useEffect(() => {
    return () => {
      pzRef.current?.destroy();
      pzRef.current = null;
      checksRef.current?.destroy();
      checksRef.current = null;
      tipsCtlRef.current?.destroy();
      tipsCtlRef.current = null;
    };
  }, []);

  const zoomIn = useCallback(() => pzRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => pzRef.current?.zoomOut(), []);
  const fit = useCallback(() => pzRef.current?.fit(), []);
  const reset = useCallback(() => pzRef.current?.reset(), []);
  const actualSize = useCallback(() => pzRef.current?.actualSize(), []);
  const getZoomPercent = useCallback(() => pzRef.current?.getZoomPercent() ?? 100, []);

  const focusCheck = useCallback((key: string | undefined) => {
    checksRef.current?.focus(key);
  }, []);

  const panToCheck = useCallback((group: ResolvedCheckGroup) => {
    pzRef.current?.panToElement(group.node);
    checksRef.current?.focus(group.key);
  }, []);

  const search = useCallback(
    (term: string, pan = true) => searchController.search(term, pan),
    [searchController],
  );
  const next = useCallback((pan = true) => searchController.next(pan), [searchController]);
  const prev = useCallback((pan = true) => searchController.prev(pan), [searchController]);
  const clearSearch = useCallback(() => searchController.clear(), [searchController]);

  const exportSvg = useCallback((): string => {
    const svg = svgRef.current;
    if (!svg) {
      throw new Error('[react-super-mermaid] 尚無可匯出的圖表。');
    }
    const prepared = serializeLiveSvg(svg);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + prepared.serialized;
  }, []);

  // PNG/JPEG/WebP:盡量重繪一張關閉 htmlLabels 的 pristine SVG(避免 foreignObject 污染 canvas),
  // 再依主題補上色後點陣化;mermaid 不可用時退回 live SVG。
  const exportPng = useCallback(async (rasterOpts: ExportRasterOptions = {}): Promise<Blob> => {
    const svg = svgRef.current;
    if (!svg) {
      throw new Error('[react-super-mermaid] 尚無可匯出的圖表。');
    }
    const cfg = cfgRef.current;
    let prepared = serializeLiveSvg(svg);
    try {
      const mermaidInst = await loadMermaid({ source: mermaidSourceRef.current });
      const { svgString, id: renderId } = await renderToSvg({
        code: cfg.code,
        theme: cfg.theme,
        dark: cfg.dark,
        seed: cfg.seed,
        fontUrl: cfg.fontUrl,
        mermaidConfig: cfg.mermaidConfig,
        mermaid: mermaidInst,
        pristine: true,
      });
      const holder = document.createElement('div');
      holder.innerHTML = svgString;
      const pristineSvg = holder.querySelector('svg');
      if (pristineSvg) {
        applyPostProcess(pristineSvg, resolveTheme(cfg.theme, cfg.dark).postProcess, {
          dark: cfg.dark,
          seed: cfg.seed,
        });
        // 這是獨立重繪的乾淨 SVG,沒有現場那份的角標 —— 要補掛,否則 PNG 會漏掉提示。
        // (需暫時掛進文件,getBBox 在 detached 節點上量不到尺寸。)
        if (cfgRef.current.checks.length > 0 && cfgRef.current.checksVisible) {
          holder.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
          document.body.appendChild(holder);
          try {
            annotateChecks(pristineSvg, cfgRef.current.checks, { renderId });
          } finally {
            holder.remove();
          }
        }
        prepared = prepareSvgElement(pristineSvg);
      }
    } catch {
      // 重繪失敗 → 沿用 live SVG(可能含 foreignObject,rasterize 會在污染時丟錯)。
    }
    return rasterizeToBlob(prepared, { ...rasterOpts, dark: cfg.dark });
  }, []);

  const downloadSvg = useCallback(
    (filename = 'diagram.svg'): void => {
      downloadBlob(svgBlob(exportSvg()), filename);
    },
    [exportSvg],
  );

  const downloadPng = useCallback(
    async (filename = 'diagram.png', rasterOpts: ExportRasterOptions = {}): Promise<void> => {
      const blob = await exportPng(rasterOpts);
      downloadBlob(blob, filename);
    },
    [exportPng],
  );

  return {
    stageRef,
    status,
    error,
    zoomPercent,
    zoomIn,
    zoomOut,
    fit,
    reset,
    actualSize,
    getZoomPercent,
    search,
    next,
    prev,
    clearSearch,
    exportSvg,
    exportPng,
    downloadSvg,
    downloadPng,
    getSvg,
    checkGroups,
    checks,
    focusCheck,
    panToCheck,
  };
}
