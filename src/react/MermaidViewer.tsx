import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type {
  ExportRasterOptions,
  MermaidSource,
  MermaidTheme,
  SearchState,
  SvgPanZoomSource,
} from '../types';
import { useMermaidViewer } from './useMermaidViewer';
import { DEFAULT_THEME_OPTIONS, Toolbar, type ThemeOption } from './Toolbar';

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
  /** 是否綁定鍵盤快捷鍵(/ Ctrl+F 搜尋、+ - 0 1 縮放)。預設 true。 */
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
        await vm.downloadPng('diagram.png', { scale: 2 });
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setExporting(false);
      }
    }, [vm, onError]);

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
        }
      };
      root.addEventListener('keydown', onKey);
      return () => root.removeEventListener('keydown', onKey);
    }, [keyboard, searchOpen, openSearch, closeSearch, vm]);

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
      }),
      [vm],
    );

    let countText = '';
    if (matchInfo.total > 0) {
      countText = `${matchInfo.current}/${matchInfo.total}`;
    } else if (query.trim()) {
      countText = '0';
    }

    const rootClassName = ['rsm-root', dark ? 'rsm-dark' : '', className ?? '']
      .filter(Boolean)
      .join(' ');

    return (
      <div
        ref={rootRef}
        className={rootClassName}
        style={style}
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
          <div ref={vm.stageRef} className="rsm-stage" />
        </div>
      </div>
    );
  },
);
