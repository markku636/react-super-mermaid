import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type {
  DiagramCheck,
  DiagramTip,
  ElkLinkConfig,
  ExportRasterOptions,
  MermaidSource,
  MermaidTheme,
  RsmPattern,
  SearchState,
  SvgPanZoomSource,
} from '../types';
import type { ResolvedCheckGroup } from '../core/checks/annotate';
import type { GetNodeTip } from '../core/tips/hover';
import { useMermaidViewer } from './useMermaidViewer';
import { DEFAULT_THEME_OPTIONS, Toolbar, type ThemeOption } from './Toolbar';
import { CheckList, CheckPopover, type CheckResolveElkLink } from './CheckPanel';

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
  /** 是否啟用觸控手勢(雙指捏合縮放 + 拖曳平移)。需 panZoom=true。預設 true。 */
  touchGestures?: boolean;
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
  /**
   * 檢查提示(「這一步異常時怎麼查」)。與原始碼裡的 `%% @check` 指令合併,
   * 同一個 target 以此處為準。
   */
  checks?: DiagramCheck[];
  /** 是否解析原始碼中的 `%% @check` 指令,預設 true。 */
  checksFromSource?: boolean;
  /** 角標初始是否顯示,預設 true(工具列與 H 鍵可切換)。 */
  defaultChecksVisible?: boolean;
  /** 使用者點開某則提示時觸發。 */
  onCheckSelect?: (check: DiagramCheck) => void;
  /** 內建 Kibana Discover 連結設定(host 已知 data view UUID 時免後端)。 */
  elk?: ElkLinkConfig;
  /** 覆寫 ELK 連結產生方式;需要打後端解析 data view 的 host 走這條。 */
  onResolveElkLink?: CheckResolveElkLink;
  /**
   * 節點懸停提示(tooltip):滑鼠停在節點上顯示說明。內容來源 = 原始碼 `%% @tip` 指令
   * + `tips` prop + 檢查提示摘要。預設 true;false = 完全關閉。
   */
  nodeTips?: boolean;
  /**
   * 懸停提示(與原始碼裡的 `%% @tip` 指令合併,同一個 target 以此處為準)。
   * 可用 `{ 節點id: 文字 }` 簡寫。
   */
  tips?: DiagramTip[] | Record<string, string>;
  /** 是否解析原始碼中的 `%% @tip` 指令,預設 true。 */
  tipsFromSource?: boolean;
  /** 動態決定節點提示;回傳 null = 該節點不顯示,undefined = 交回內建查找。 */
  getNodeTip?: GetNodeTip;
  /** 無授權提示時退回顯示「節點完整文字 + id」,預設 false。 */
  tipFallbackLabel?: boolean;
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
  /** 合併後的檢查提示清單。 */
  getChecks: () => DiagramCheck[];
  /** 顯示 / 隱藏節點角標。 */
  showChecks: (visible: boolean) => void;
  /** 平移到某個提示節點並高亮;target 找不到時無動作。 */
  focusCheck: (target: string) => void;
  openChecklist: () => void;
  closeChecklist: () => void;
}

/** 畫布底色 / 純色背景的預設顏色(對齊 VS Code editor-background)。 */
function defaultSolidColor(dark: boolean): string {
  return dark ? '#1e1e1e' : '#ffffff';
}

/**
 * 依「實際畫布亮度」挑網點 / 網格線的墨色 —— 讓圖樣永遠跟底色對比、看得見。
 * 舊版把墨色綁在主題前景色(--rsm-fg),所以「深色主題 + 使用者選了淺底色」會變成
 * 淺墨疊淺底→看不見。這裡改成:有底色就量它的相對亮度,沒底色(透明)就看頁面亮暗。
 * 深底→淺墨(slate-200);淺底→深墨(slate-900),濃度對齊 VS Code 的點陣手感。
 */
function patternInk(surface: string | null, dark: boolean): { dot: string; line: string } {
  const m = surface ? /^#([0-9a-fA-F]{6})$/.exec(surface) : null;
  let lightCanvas: boolean;
  if (m) {
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    lightCanvas = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
  } else {
    lightCanvas = !dark;
  }
  const ink = lightCanvas ? '15, 23, 42' : '226, 232, 240';
  // 網點是 1px 小圓、墨量天生比連續網格線少,故點略濃於線,兩者視覺份量才相當。
  return { dot: `rgba(${ink}, 0.34)`, line: `rgba(${ink}, 0.2)` };
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
      touchGestures = true,
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
      checks: checksProp,
      checksFromSource = true,
      defaultChecksVisible = true,
      onCheckSelect,
      elk,
      onResolveElkLink,
      nodeTips = true,
      tips,
      tipsFromSource = true,
      getNodeTip,
      tipFallbackLabel = false,
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

    // 檢查提示:角標顯示與否、目前開啟的跳窗、側邊清單是否展開。
    const [checksVisible, setChecksVisible] = useState(defaultChecksVisible);
    const [activeGroup, setActiveGroup] = useState<ResolvedCheckGroup | null>(null);
    const [anchor, setAnchor] = useState({ left: 0, top: 0 });
    const [checklistOpen, setChecklistOpen] = useState(false);

    const rootRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // 把角標的螢幕座標換算成畫布內的相對座標(跳窗是畫布的絕對定位子元素)。
    const measureAnchor = useCallback((group: ResolvedCheckGroup): void => {
      const canvas = canvasRef.current;
      const badge = group.badge;
      if (!canvas || typeof badge.getBoundingClientRect !== 'function') {
        return;
      }
      const c = canvas.getBoundingClientRect();
      const b = badge.getBoundingClientRect();
      setAnchor({ left: b.right - c.left + 8, top: b.top - c.top });
    }, []);

    const openCheck = useCallback(
      (group: ResolvedCheckGroup): void => {
        setActiveGroup(group);
        measureAnchor(group);
        onCheckSelect?.(group.checks[0]);
      },
      [measureAnchor, onCheckSelect],
    );

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
      touchGestures,
      injectStyles,
      checks: checksProp,
      checksFromSource,
      checksVisible,
      onCheckActivate: openCheck,
      nodeTips,
      tips,
      tipsFromSource,
      getNodeTip,
      tipFallbackLabel,
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

    const closeCheck = useCallback((): void => {
      setActiveGroup(null);
      vm.focusCheck(undefined);
    }, [vm]);

    const toggleChecks = useCallback((): void => {
      setChecksVisible((v) => {
        if (v) {
          // 藏起角標時一併收掉跳窗,否則會留一張沒有錨點的卡片浮在畫布上。
          setActiveGroup(null);
        }
        return !v;
      });
    }, []);

    const toggleChecklist = useCallback((): void => {
      setChecklistOpen((o) => !o);
    }, []);

    // 圖被縮放 / 拖曳 / 視窗改變後,角標的螢幕位置就變了 —— 跳窗要跟著重算,否則會飄離節點。
    // zoom 由 vm.zoomPercent 觸發;平移沒有事件可掛,改在畫布的 pointerup 收尾時重算。
    useEffect(() => {
      if (!activeGroup) {
        return undefined;
      }
      measureAnchor(activeGroup);
      const canvas = canvasRef.current;
      const onSettle = (): void => measureAnchor(activeGroup);
      window.addEventListener('resize', onSettle);
      canvas?.addEventListener('pointerup', onSettle);
      return () => {
        window.removeEventListener('resize', onSettle);
        canvas?.removeEventListener('pointerup', onSettle);
      };
    }, [activeGroup, measureAnchor, vm.zoomPercent]);

    // 重繪(換主題 / 換碼)後舊的 group 物件已失效,關掉跳窗避免指向被移除的 DOM。
    useEffect(() => {
      setActiveGroup(null);
    }, [vm.checkGroups]);

    // 跳窗 / 清單開著時,Esc 額外掛到 document 上。
    // 主要的鍵盤處理綁在 viewer root,需要焦點留在 .rsm-root 內才收得到 —— 但焦點很容易跑掉
    // (點畫布空白處、瀏覽器不聚焦被點的 SVG 元素…),那時使用者按 Esc 會沒反應、只能去找 ✕。
    // 這層只處理 Esc,不攔其他按鍵,不會干擾 host 的全域快捷鍵。
    useEffect(() => {
      if (!activeGroup && !checklistOpen) {
        return undefined;
      }
      const onDocKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') {
          return;
        }
        // 焦點已在 viewer 內時交給 root 的處理器,避免同一次按鍵關掉兩層。
        if (rootRef.current?.contains(document.activeElement)) {
          return;
        }
        e.preventDefault();
        if (activeGroup) {
          closeCheck();
        } else {
          setChecklistOpen(false);
        }
      };
      document.addEventListener('keydown', onDocKey);
      return () => document.removeEventListener('keydown', onDocKey);
    }, [activeGroup, checklistOpen, closeCheck]);

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
        // Esc 逐層收合:跳窗 → 清單 → 搜尋 → 全螢幕,一次只關一層。
        if (e.key === 'Escape' && activeGroup) {
          e.preventDefault();
          closeCheck();
          return;
        }
        if (e.key === 'Escape' && checklistOpen) {
          e.preventDefault();
          setChecklistOpen(false);
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
        if (vm.checkGroups.length > 0 && (e.key === 'h' || e.key === 'H')) {
          e.preventDefault();
          toggleChecks();
          return;
        }
        if (vm.checkGroups.length > 0 && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          toggleChecklist();
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
      activeGroup,
      checklistOpen,
      closeCheck,
      toggleChecks,
      toggleChecklist,
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
        getChecks: () => vm.checks,
        showChecks: (visible: boolean) => {
          setChecksVisible(visible);
          if (!visible) {
            setActiveGroup(null);
          }
        },
        focusCheck: (target: string) => {
          const group = vm.checkGroups.find((g) => g.checks.some((c) => c.target === target));
          if (group) {
            vm.panToCheck(group);
          }
        },
        openChecklist: () => setChecklistOpen(true),
        closeChecklist: () => setChecklistOpen(false),
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
    // 網點 / 網格墨色一律依「實際畫布亮度」算,確保任何底色(預設或自訂)上都看得見。
    const ink = patternInk(solidColor, dark);
    const rootStyle: React.CSSProperties = {
      ...(style ?? {}),
      ['--rsm-grid-dot' as string]: ink.dot,
      ['--rsm-grid-line' as string]: ink.line,
      ...(solidColor ? { ['--rsm-canvas-bg' as string]: solidColor } : {}),
    };

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
            checkCount={vm.checkGroups.length}
            checksVisible={checksVisible}
            onToggleChecks={toggleChecks}
            checklistOpen={checklistOpen}
            onToggleChecklist={toggleChecklist}
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

        <div ref={canvasRef} className="rsm-canvas">
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

          {activeGroup && checksVisible ? (
            <CheckPopover
              group={activeGroup}
              anchor={anchor}
              elk={elk}
              onResolveElkLink={onResolveElkLink}
              onClose={closeCheck}
            />
          ) : null}

          {checklistOpen ? (
            <CheckList
              groups={vm.checkGroups}
              activeKey={activeGroup?.key}
              elk={elk}
              onResolveElkLink={onResolveElkLink}
              onSelect={(group) => {
                vm.panToCheck(group);
                setActiveGroup(null);
              }}
              onClose={() => setChecklistOpen(false)}
            />
          ) : null}
        </div>
      </div>
    );
  },
);
