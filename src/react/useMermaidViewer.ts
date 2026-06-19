// 把 core 引擎(載入 / 渲染 / pan-zoom / 搜尋 / 匯出)接到 React 生命週期的內部 hook。
// 對外的 <MermaidViewer> 與命令式 ref handle 都建立在這之上。

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type {
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
  injectStyles: boolean;
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
    injectStyles,
    onRender,
    onError,
  } = opts;

  const [status, setStatus] = useState<RenderStatus>('loading');
  const [error, setError] = useState('');
  const [zoomPercent, setZoomPercent] = useState(100);

  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pzRef = useRef<PanZoomController | null>(null);
  const prevCodeRef = useRef<string | null>(null);

  // 把易變的設定放進 ref,讓 async loader / 匯出讀到最新值而不必列為 effect 依賴。
  const mermaidSourceRef = useRef<MermaidSource | undefined>(mermaid);
  const cfgRef = useRef<{
    theme: MermaidTheme;
    dark: boolean;
    seed: number;
    fontUrl?: string;
    mermaidConfig?: Record<string, unknown>;
    code: string;
  }>({ theme, dark, seed, fontUrl, mermaidConfig, code });
  mermaidSourceRef.current = mermaid;
  cfgRef.current = { theme, dark, seed, fontUrl, mermaidConfig, code };

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
        const { svgString, postProcess } = await renderToSvg({
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

        const svg = mountSvg(host, svgString, postProcess, { dark, seed });
        if (!svg) {
          throw new Error('mermaid 未輸出 SVG。');
        }
        svgRef.current = svg;

        if (panZoom) {
          const factory = await loadSvgPanZoom(svgPanZoom);
          if (cancelled) {
            return;
          }
          if (factory) {
            pzRef.current = attachPanZoom(svg, factory, { onZoom: syncZoom });
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
  }, [code, theme, dark, seed, fontUrl, mermaidConfigKey, panZoom, injectStyles]);

  // 卸載時清掉 pan-zoom 監聽。
  useEffect(() => {
    return () => {
      pzRef.current?.destroy();
      pzRef.current = null;
    };
  }, []);

  const zoomIn = useCallback(() => pzRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => pzRef.current?.zoomOut(), []);
  const fit = useCallback(() => pzRef.current?.fit(), []);
  const reset = useCallback(() => pzRef.current?.reset(), []);
  const actualSize = useCallback(() => pzRef.current?.actualSize(), []);
  const getZoomPercent = useCallback(() => pzRef.current?.getZoomPercent() ?? 100, []);

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
      const { svgString } = await renderToSvg({
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
  };
}
