import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type {
  ExportRasterOptions,
  MermaidSource,
  MermaidTheme,
  RsmPattern,
  SearchState,
  SvgPanZoomSource,
} from '../types';
import { useMermaidViewer } from './useMermaidViewer';
import { DEFAULT_THEME_OPTIONS, Toolbar, type ThemeOption } from './Toolbar';

/** 圖樣循環順序(快捷鍵 B):無 → 網點 → 網格 → 無。 */
const PATTERN_CYCLE: RsmPattern[] = ['none', 'dots', 'grid'];

export interface MermaidViewerProps {
  /** mermaid 原始碼字串(必填)。 */
  code: string;
  /** 主題,預設 'colorful'。toolbar 會即時切換;傳入新值也會同步。 */
  theme?: MermaidTheme;
  /** 暗色;省略時自動偵測 prefers-color-scheme。 */
  dark?: boolean;
  /** 是否顯示 toolbox(主題 / 縮放 / 搜尋 / 匯出)。預設 true;false = 只顯示圖表。 */
  toolbar?: boolean;
  /** 自訂 toolbar 上的主題選項。 */
  themeOptions?: ThemeOption[];
  /** 是否啟用 pan/zoom。預設 true。 */
  panZoom?: boolean;
  /** 是否啟用搜尋(toolbar 內)。預設 true。 */
  search?: boolean;
  /** 是否啟用匯出 SVG/PNG(toolbar 內)。預設 true。 */
  exportable?: boolean;
  /** 是否顯示背景選擇器(底色色票 + 自訂色 + 網點 / 網格圖樣)。預設 true。 */
  background?: boolean;
  /** 疊加圖樣初始 / 受控值,預設 'dots'(網點);toolbar 變更存內部 state。 */
  pattern?: RsmPattern;
  /**
   * 底色初始 / 受控值(hex,如 `#EFF6FF`);null / 省略 = 透明(跟隨頁面底色)。
   * toolbar 的色票與「自訂」色會更新此值。
   */
  solidColor?: string | null;
  /** 是否顯示全螢幕鈕(以跳窗形式覆蓋整個視窗,支援 RWD)。預設 true。 */
  fullscreen?: boolean;
  /** 進 / 出全螢幕時的回呼。 */
  onFullscreenChange?: (fullscreen: boolean) => void;
  /** 是否綁定鍵盤快捷鍵(/ Ctrl+F 搜尋、+ - 0 1 縮放、F 全螢幕、B 背景)。預設 true。 */
  keyboard?: boolean;
  /** sketch 抖動種子,預設 42。 */
  seed?: number;
  /** sketch 手寫字體來源覆寫。 */
  fontUrl?: string;
  /** 如何取得 mermaid:注入實例 / CDN。省略則動態 import peer。 */
  mermaid?: MermaidSource;
  /** 透傳給 mermaid.initialize 的設定。 */
  mermaidConfig?: Record<string, unknown>;
  /** 如何取得 svg-pan-zoom。省略則動態 import peer。 */
  svgPanZoom?: SvgPanZoomSource;
  /** 是否注入套件內建 CSS,預設 true。 */
  injectStyles?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onRender?: (svg: SVGSVGElement) => void;
  onError?: (err: Error) => void;
}

/** 命令式控制(透過 ref),適合 toolbar={false} 時 host 自建按鈕。 */
export interface MermaidViewerHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  reset: () => void;
  actualSize: () => void;
  getZoomPercent: () => number;
  search: (term: string) => SearchState;
  next: () => SearchState;
  prev: () => SearchState;
  clearSearch: () => void;
  exportSvg: () => string;
  exportPng: (opts?: ExportRasterOptions) => Promise<Blob>;
  downloadSvg: (filename?: string) => void;
  downloadPng: (filename?: string, opts?: ExportRasterOptions) => Promise<void>;
  getSvg: () => SVGSVGElement | null;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
  toggleFullscreen: () => void;
  isFullscreen: () => boolean;
  setPattern: (pattern: RsmPattern) => void;
  cyclePattern: () => void;
  getPattern: () => RsmPattern;
  /** 設定底色(hex);null = 透明 / 跟隨頁面。 */
  setSolidColor: (color: string | null) => void;
  getSolidColor: () => string | null;
}

/** 畫布底色 / 純色背景的預設顏色(對齊 VS Code editor-background)。 */
function defaultSolidColor(dark: boolean): string {
  return dark ? '#1e1e1e' : '#ffffff';
}

function usePrefersDark(explicit?: boolean): boolean {
  const [autoDark, setAutoDark] = useState(false);
  useEffect(() => {
    if (explicit !== undefined || typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setAutoDark(mq.matches);
    const handler = (e: MediaQueryListEvent): void => setAutoDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [explicit]);
  return explicit ?? autoDark;
}

export const MermaidViewer = forwardRef<MermaidViewerHandle, MermaidViewerProps>(
  function MermaidViewer(props, ref): React.JSX.Element {
    const {
      code,
      toolbar = true,
      themeOptions = DEFAULT_THEME_OPTIONS,
      panZoom = true,
      search: searchEnabled = true,
      exportable = true,
      background: backgroundEnabled = true,
      fullscreen: fullscreenEnabled = true,
      onFullscreenChange,
      keyboard = true,
      seed = 42,
      fontUrl,
      mermaid,
      mermaidConfig,
      svgPanZoom,
      injectStyles = true,
      className,
      style,
      onRender,
      onError,
    } = props;

    const dark = usePrefersDark(props.dark);

    // theme:以 prop 為初始 / 受控值,toolbar 變更存內部 state;prop 改變時同步。
    const [theme, setTheme] = useState<MermaidTheme>(props.theme ?? 'colorful');
    useEffect(() => {
      if (props.theme) {
        setTheme(props.theme);
      }
    }, [props.theme]);

    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [matchInfo, setMatchInfo] = useState<SearchState>({ current: 0, total: 0 });
    const [exporting, setExporting] = useState(false);

    // 疊加圖樣:以 prop 為初始 / 受控值,toolbar 變更存內部 state;prop 改變時同步。
    const [pattern, setPatternState] = useState<RsmPattern>(props.pattern ?? 'dots');
    useEffect(() => {
      if (props.pattern) {
        setPatternState(props.pattern);
      }
    }, [props.pattern]);

    // 底色:null = 透明(跟隨頁面);使用者選色票 / 自訂色後釘住。prop 改變時同步。
    const [solidColor, setSolidColorState] = useState<string | null>(props.solidColor ?? null);
    useEffect(() => {
      if (props.solidColor !== undefined) {
        setSolidColorState(props.solidColor);
      }
    }, [props.solidColor]);

    const [isFullscreen, setIsFullscreen] = useState(false);

    const rootRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const vm = useMermaidViewer({
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
    });

    const runSearch = useCallback(
      (term: string, pan: boolean): void => {
        setMatchInfo(vm.search(term, pan));
      },
      [vm],
    );

    const openSearch = useCallback((): void => {
      setSearchOpen(true);
      window.setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 0);
      if (query.trim()) {
        runSearch(query, true);
      }
    }, [query, runSearch]);

    const closeSearch = useCallback((): void => {
      setSearchOpen(false);
      vm.clearSearch();
      setQuery('');
      setMatchInfo({ current: 0, total: 0 });
    }, [vm]);

    const toggleSearch = useCallback((): void => {
      if (searchOpen) {
        closeSearch();
      } else {
        openSearch();
      }
    }, [searchOpen, openSearch, closeSearch]);

    const exportSvg = useCallback((): void => {
      try {
        vm.downloadSvg('diagram.svg');
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    }, [vm, onError]);

    const exportPng = useCallback(async (): Promise<void> => {
      setExporting(true);
      try {
        // 匯出背景跟隨畫布:透明底色 + 無圖樣 → 透明 PNG;否則用自選底色或 paper 填底。
        const paper = solidColor ?? defaultSolidColor(dark);
        const transparent = solidColor === null && pattern === 'none';
        const bgOpt = transparent ? { transparent: true } : { background: paper };
        await vm.downloadPng('diagram.png', { scale: 2, ...bgOpt });
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setExporting(false);
      }
    }, [vm, onError, pattern, solidColor, dark]);

    const cyclePattern = useCallback((): void => {
      setPatternState((prev) => {
        const i = PATTERN_CYCLE.indexOf(prev);
        return PATTERN_CYCLE[(i + 1) % PATTERN_CYCLE.length];
      });
    }, []);

    const setPattern = useCallback((next: RsmPattern): void => {
      setPatternState(next);
    }, []);

    const setSolidColor = useCallback((color: string | null): void => {
      setSolidColorState(color);
    }, []);

    // 全螢幕用「跳窗」實作(position:fixed 覆蓋整個視窗),而非原生 Fullscreen API:
    // 可靠、可跨 iframe、天然支援 RWD,且 Esc / 按鈕皆能關閉。
    const enterFullscreen = useCallback((): void => {
      setIsFullscreen((prev) => {
        if (!prev) {
          onFullscreenChange?.(true);
        }
        return true;
      });
    }, [onFullscreenChange]);

    const exitFullscreen = useCallback((): void => {
      setIsFullscreen((prev) => {
        if (prev) {
          onFullscreenChange?.(false);
        }
        return false;
      });
    }, [onFullscreenChange]);

    const toggleFullscreen = useCallback((): void => {
      setIsFullscreen((prev) => {
        onFullscreenChange?.(!prev);
        return !prev;
      });
    }, [onFullscreenChange]);

    // 進 / 出全螢幕:鎖住背景捲動、綁 window 級 Esc 關閉,並在版面尺寸改變後重新 fit。
    useEffect(() => {
      if (!isFullscreen) {
        return undefined;
      }
      const body = typeof document !== 'undefined' ? document.body : null;
      const prevOverflow = body?.style.overflow ?? '';
      if (body) {
        body.style.overflow = 'hidden';
      }
      const onWinKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault();
          exitFullscreen();
        }
      };
      window.addEventListener('keydown', onWinKey);
      // 等版面套用全螢幕尺寸後再 resize + fit + center。
      const fitId = window.setTimeout(() => vm.reset(), 60);
      // RWD:旋轉螢幕 / 視窗尺寸變動時重新貼合。
      let resizeId = 0;
      const onResize = (): void => {
        window.clearTimeout(resizeId);
        resizeId = window.setTimeout(() => vm.reset(), 150);
      };
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);
      // 把焦點移到 root,讓內部鍵盤快捷鍵(縮放 / 搜尋)在跳窗內可用。
      rootRef.current?.focus();
      return () => {
        window.removeEventListener('keydown', onWinKey);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onResize);
        window.clearTimeout(fitId);
        window.clearTimeout(resizeId);
        if (body) {
          body.style.overflow = prevOverflow;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isFullscreen, exitFullscreen]);

    // 離開全螢幕後也重新 fit(版面從跳窗縮回行內尺寸);跳過首次掛載。
    const fsMountedRef = useRef(false);
    useEffect(() => {
      if (!fsMountedRef.current) {
        fsMountedRef.current = true;
        return undefined;
      }
      if (isFullscreen) {
        return undefined;
      }
      const id = window.setTimeout(() => vm.reset(), 60);
      return () => window.clearTimeout(id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isFullscreen]);

    // 鍵盤快捷鍵:綁在 root(需 focus),避免像 window 那樣劫持 host 全域按鍵。
    useEffect(() => {
      if (!keyboard) {
        return undefined;
      }
      const root = rootRef.current;
      if (!root) {
        return undefined;
      }
      const onKey = (e: KeyboardEvent): void => {
        const target = e.target as HTMLElement | null;
        const typing = target ? /^(input|textarea|select)$/i.test(target.tagName) : false;
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
          e.preventDefault();
          openSearch();
          return;
        }
        if (e.key === '/' && !typing) {
          e.preventDefault();
          openSearch();
          return;
        }
        if (e.key === 'Escape' && searchOpen) {
          closeSearch();
          return;
        }
        if (e.key === 'Escape' && isFullscreen) {
          e.preventDefault();
          exitFullscreen();
          return;
        }
        if (typing) {
          return;
        }
        if (e.key === '+' || e.key === '=') {
          vm.zoomIn();
        } else if (e.key === '-' || e.key === '_') {
          vm.zoomOut();
        } else if (e.key === '0') {
          vm.reset();
        } else if (e.key === '1') {
          vm.actualSize();
        } else if (e.key === 'w' || e.key === 'W') {
          vm.fit();
        } else if (fullscreenEnabled && (e.key === 'f' || e.key === 'F')) {
          e.preventDefault();
          toggleFullscreen();
        } else if (backgroundEnabled && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          cyclePattern();
        }
      };
      root.addEventListener('keydown', onKey);
      return () => root.removeEventListener('keydown', onKey);
    }, [
      keyboard,
      searchOpen,
      openSearch,
      closeSearch,
      vm,
      isFullscreen,
      exitFullscreen,
      toggleFullscreen,
      cyclePattern,
      fullscreenEnabled,
      backgroundEnabled,
    ]);

    useImperativeHandle(
      ref,
      (): MermaidViewerHandle => ({
        zoomIn: vm.zoomIn,
        zoomOut: vm.zoomOut,
        fit: vm.fit,
        reset: vm.reset,
        actualSize: vm.actualSize,
        getZoomPercent: vm.getZoomPercent,
        search: (term: string) => vm.search(term),
        next: () => vm.next(),
        prev: () => vm.prev(),
        clearSearch: vm.clearSearch,
        exportSvg: vm.exportSvg,
        exportPng: vm.exportPng,
        downloadSvg: vm.downloadSvg,
        downloadPng: vm.downloadPng,
        getSvg: vm.getSvg,
        enterFullscreen,
        exitFullscreen,
        toggleFullscreen,
        isFullscreen: () => isFullscreen,
        setPattern,
        cyclePattern,
        getPattern: () => pattern,
        setSolidColor,
        getSolidColor: () => solidColor,
      }),
      [
        vm,
        enterFullscreen,
        exitFullscreen,
        toggleFullscreen,
        isFullscreen,
        setPattern,
        cyclePattern,
        pattern,
        setSolidColor,
        solidColor,
      ],
    );

    let countText = '';
    if (matchInfo.total > 0) {
      countText = `${matchInfo.current}/${matchInfo.total}`;
    } else if (query.trim()) {
      countText = '0';
    }

    const rootClassName = [
      'rsm-root',
      dark ? 'rsm-dark' : '',
      `rsm-pattern-${pattern}`,
      isFullscreen ? 'rsm-fullscreen' : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    // 底色透過 inline CSS 變數覆寫;未選(null)則交給 CSS 退回透明(跟隨頁面)。
    const rootStyle: React.CSSProperties = solidColor
      ? { ...style, ['--rsm-canvas-bg' as string]: solidColor }
      : (style ?? {});

    return (
      <div
        ref={rootRef}
        className={rootClassName}
        style={rootStyle}
        tabIndex={keyboard ? 0 : undefined}
      >
        {toolbar ? (
          <Toolbar
            theme={theme}
            themeOptions={themeOptions}
            onThemeChange={setTheme}
            zoomPercent={vm.zoomPercent}
            onZoomIn={vm.zoomIn}
            onZoomOut={vm.zoomOut}
            onActualSize={vm.actualSize}
            onReset={vm.reset}
            searchEnabled={searchEnabled}
            searchOpen={searchOpen}
            onToggleSearch={toggleSearch}
            exportEnabled={exportable}
            exporting={exporting}
            onExportSvg={exportSvg}
            onExportPng={exportPng}
            backgroundEnabled={backgroundEnabled}
            surface={solidColor}
            onSurfaceChange={setSolidColor}
            pattern={pattern}
            onPatternChange={setPattern}
            fullscreenEnabled={fullscreenEnabled}
            fullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        ) : null}

        {toolbar && searchEnabled && searchOpen ? (
          <div className="rsm-searchbar">
            <input
              ref={searchInputRef}
              className="rsm-input"
              type="text"
              value={query}
              spellCheck={false}
              placeholder="在圖中搜尋…（Enter 下一個 / Shift+Enter 上一個）"
              onChange={(e) => {
                setQuery(e.target.value);
                runSearch(e.target.value, true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setMatchInfo(e.shiftKey ? vm.prev() : vm.next());
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeSearch();
                }
              }}
            />
            <span className="rsm-count">{countText}</span>
            <button type="button" className="rsm-btn" onClick={() => setMatchInfo(vm.prev())}>
              上一個
            </button>
            <button type="button" className="rsm-btn" onClick={() => setMatchInfo(vm.next())}>
              下一個
            </button>
            <div className="rsm-searchbar-spacer" />
            <button type="button" className="rsm-btn" onClick={closeSearch}>
              ✕ 關閉
            </button>
          </div>
        ) : null}

        <div className="rsm-canvas">
          {vm.status === 'loading' ? <div className="rsm-overlay">圖表渲染中…</div> : null}
          {vm.status === 'error' ? (
            <div className="rsm-overlay rsm-error">圖表載入失敗：{vm.error}</div>
          ) : null}
          {isFullscreen ? (
            <button
              type="button"
              className="rsm-fs-close"
              onClick={exitFullscreen}
              title="離開全螢幕（Esc）"
              aria-label="離開全螢幕"
            >
              ✕
            </button>
          ) : null}
          <div ref={vm.stageRef} className="rsm-stage" />
        </div>
      </div>
    );
  },
);
