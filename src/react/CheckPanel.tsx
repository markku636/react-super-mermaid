// 檢查提示的呈現層:一張卡片元件,同時被「點角標開的跳窗」與「側邊檢查清單」複用。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CheckSeverity, DiagramCheck, ElkLinkConfig } from '../types';
import type { ResolvedCheckGroup } from '../core/checks/annotate';
import { elkLinkFromConfig } from '../core/checks/kibana';

const SEVERITY_LABEL: Record<CheckSeverity, string> = {
  info: '參考',
  warn: '注意',
  error: '重點',
};

/** 跳窗與畫布邊緣的最小間距,避免貼邊看不清。 */
const EDGE_GAP = 8;

export interface CheckResolveElkLink {
  (check: DiagramCheck): string | null | undefined | Promise<string | null | undefined>;
}

interface CopyButtonProps {
  text: string;
  label?: string;
}

/**
 * 舊路剪貼簿:`navigator.clipboard` 在非安全來源(http 且非 localhost)根本不存在,
 * 而內部診斷工具正是最容易走 http 的場景。用一個離畫面的 textarea + execCommand 兜底。
 */
function legacyCopy(text: string): boolean {
  // 這招要把焦點搶去一個暫時的 textarea。務必還回去 —— 否則焦點會掉到 <body>,
  // 而 Esc 關閉是掛在 viewer root 上的,焦點一離開 .rsm-root 就再也收不到。
  const previous = document.activeElement as { focus?: (o?: FocusOptions) => void } | null;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:absolute;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  } finally {
    previous?.focus?.({ preventScroll: true });
  }
}

type CopyState = 'idle' | 'done' | 'failed';

/** 複製鈕:成功短暫顯示「已複製」;**失敗要說出來**,靜默無反應會讓人以為工具壞了。 */
function CopyButton({ text, label = '複製' }: CopyButtonProps): React.JSX.Element {
  const [state, setState] = useState<CopyState>('idle');
  const timerRef = useRef(0);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const flash = useCallback((next: CopyState): void => {
    setState(next);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setState('idle'), next === 'failed' ? 2600 : 1400);
  }, []);

  const copy = useCallback(async (): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        flash('done');
        return;
      }
    } catch {
      // 權限被拒 / 非安全來源 → 落到下方的舊路作法。
    }
    flash(legacyCopy(text) ? 'done' : 'failed');
  }, [text, flash]);

  let content = label;
  if (state === 'done') {
    content = '✓ 已複製';
  } else if (state === 'failed') {
    content = '複製失敗，請手動選取';
  }

  return (
    <button
      type="button"
      className={`rsm-btn rsm-check-copy${state === 'failed' ? ' rsm-check-copy-failed' : ''}`}
      onClick={() => void copy()}
    >
      {content}
    </button>
  );
}

interface ElkButtonProps {
  check: DiagramCheck;
  elk?: ElkLinkConfig;
  onResolveElkLink?: CheckResolveElkLink;
}

/**
 * ELK 連結鈕。三種行為,依 host 給了什麼而定:
 * 1. 有 `onResolveElkLink` → 按下才解析(host 可能要打後端查 data view UUID),解出來就開新分頁
 * 2. 有 `elk` 設定 → 直接用內建 builder 組連結,渲染成真的 <a>
 * 3. 都沒有 → 退化成「複製 KQL」,不給死連結
 */
function ElkButton(props: ElkButtonProps): React.JSX.Element | null {
  const { check, elk, onResolveElkLink } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = check.elk;
  const label = query?.label ?? '🔎 開 Kibana';

  const directUrl = elkLinkFromConfig(query, elk);

  const resolve = useCallback(async (): Promise<void> => {
    if (!onResolveElkLink) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const url = await onResolveElkLink(check);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        setError('無法產生連結');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '連結產生失敗');
    } finally {
      setBusy(false);
    }
  }, [check, onResolveElkLink]);

  if (!query || (!query.kql?.trim() && !query.dsl)) {
    return null;
  }

  if (onResolveElkLink) {
    return (
      <span className="rsm-check-elk">
        <button type="button" className="rsm-btn" disabled={busy} onClick={() => void resolve()}>
          {busy ? '產生中…' : label}
        </button>
        {error ? <span className="rsm-check-elk-error">{error}</span> : null}
      </span>
    );
  }

  if (directUrl) {
    return (
      <a className="rsm-btn rsm-check-elk-link" href={directUrl} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  }

  return query.kql ? <CopyButton text={query.kql} label="複製 KQL 條件" /> : null;
}

export interface CheckCardProps {
  check: DiagramCheck;
  elk?: ElkLinkConfig;
  onResolveElkLink?: CheckResolveElkLink;
}

/** 單一提示的完整內容:抬頭 + 說明 + 步驟 + 可複製片段 + 連結 + ELK。 */
export function CheckCard({ check, elk, onResolveElkLink }: CheckCardProps): React.JSX.Element {
  const severity = check.severity ?? 'info';
  return (
    <div className="rsm-check-card">
      <div className="rsm-check-card-head">
        <span className={`rsm-check-chip rsm-check-${severity}`}>{SEVERITY_LABEL[severity]}</span>
        <span className="rsm-check-title">{check.title ?? check.target}</span>
      </div>

      {check.desc ? <p className="rsm-check-desc">{check.desc}</p> : null}

      {/* 以下清單一律用索引當 key。內容當 key 會在「兩步文字相同」「兩則片段相同」
          這類完全合法的輸入上撞號 —— React 會錯配元素,把 CopyButton 的「已複製」
          狀態串到別張卡片上。這些清單唯讀且不重排,索引是穩定且正確的選擇。 */}
      {check.steps && check.steps.length > 0 ? (
        <ol className="rsm-check-steps">
          {check.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      ) : null}

      {check.snippets?.map((snippet, i) => (
        <div className="rsm-check-snippet" key={i}>
          <div className="rsm-check-snippet-head">
            <span className="rsm-check-lang">{snippet.label ?? snippet.lang ?? 'code'}</span>
            <CopyButton text={snippet.code} />
          </div>
          <pre className="rsm-check-code">
            <code>{snippet.code}</code>
          </pre>
        </div>
      ))}

      {(check.elk || (check.links && check.links.length > 0)) && (
        <div className="rsm-check-actions">
          <ElkButton check={check} elk={elk} onResolveElkLink={onResolveElkLink} />
          {check.links?.map((link, i) => (
            <a
              key={i}
              className="rsm-btn rsm-check-link"
              href={link.url}
              target="_blank"
              rel="noreferrer"
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export interface CheckPopoverProps {
  group: ResolvedCheckGroup;
  /** 角標相對畫布的位置(px)。 */
  anchor: { left: number; top: number };
  elk?: ElkLinkConfig;
  onResolveElkLink?: CheckResolveElkLink;
  onClose: () => void;
}

/**
 * 點角標開的跳窗。定位由 host 算好傳進來(角標的 client rect 相對畫布),
 * 這裡只負責「超出畫布時往回夾」—— 必須等自身尺寸量到才能夾,故用 useLayoutEffect。
 */
export function CheckPopover(props: CheckPopoverProps): React.JSX.Element {
  const { group, anchor, elk, onResolveElkLink, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(anchor);

  /**
   * 開啟時把焦點移進跳窗,關閉時還給角標。
   *
   * 不只是無障礙:Esc 是掛在 viewer root 的 keydown 上,要焦點留在 .rsm-root 內才收得到。
   * 用滑鼠點 SVG `<g>` 並不保證會聚焦(Safari 就不會)—— 焦點留在 body 的話 Esc 完全沒作用。
   * preventScroll 避免聚焦時把外層頁面捲走。
   */
  useEffect(() => {
    const badge = group.badge;
    ref.current?.focus({ preventScroll: true });
    return () => {
      const el = badge as unknown as { focus?: (o?: FocusOptions) => void };
      el.focus?.({ preventScroll: true });
    };
  }, [group]);

  useLayoutEffect(() => {
    const el = ref.current;
    const canvas = el?.parentElement;
    if (!el || !canvas) {
      setPos(anchor);
      return;
    }
    const maxLeft = canvas.clientWidth - el.offsetWidth - EDGE_GAP;
    const maxTop = canvas.clientHeight - el.offsetHeight - EDGE_GAP;
    setPos({
      left: Math.max(EDGE_GAP, Math.min(anchor.left, Math.max(EDGE_GAP, maxLeft))),
      top: Math.max(EDGE_GAP, Math.min(anchor.top, Math.max(EDGE_GAP, maxTop))),
    });
  }, [anchor, group.key]);

  return (
    <div
      ref={ref}
      className="rsm-check-pop"
      role="dialog"
      aria-label="檢查提示"
      tabIndex={-1}
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="rsm-check-pop-head">
        <span className="rsm-check-pop-count">
          {group.checks.length > 1 ? `${group.checks.length} 則檢查提示` : '檢查提示'}
        </span>
        <button type="button" className="rsm-btn" onClick={onClose} aria-label="關閉">
          ✕
        </button>
      </div>
      <div className="rsm-check-pop-body">
        {/* 同一個 group 依定義就是「同 target」,而未寫標題的 check 會被 annotateChecks
            填成同一個節點標籤 → target+title 當 key 必撞。改用索引。 */}
        {group.checks.map((check, i) => (
          <CheckCard key={i} check={check} elk={elk} onResolveElkLink={onResolveElkLink} />
        ))}
      </div>
    </div>
  );
}

export interface CheckListProps {
  groups: ResolvedCheckGroup[];
  activeKey?: string;
  elk?: ElkLinkConfig;
  onResolveElkLink?: CheckResolveElkLink;
  /** 點某一項 → host 負責平移對焦到該節點。 */
  onSelect: (group: ResolvedCheckGroup) => void;
  onClose: () => void;
}

/** 側邊檢查清單:一次看完整張圖有哪些檢查點,點擊會把圖平移到對應節點。 */
export function CheckList(props: CheckListProps): React.JSX.Element {
  const { groups, activeKey, elk, onResolveElkLink, onSelect, onClose } = props;
  return (
    <aside className="rsm-check-list" aria-label="檢查清單">
      <div className="rsm-check-list-head">
        <span className="rsm-check-list-title">檢查清單（{groups.length}）</span>
        <button type="button" className="rsm-btn" onClick={onClose} aria-label="關閉檢查清單">
          ✕
        </button>
      </div>
      <div className="rsm-check-list-body">
        {groups.length === 0 ? (
          <p className="rsm-check-empty">這張圖沒有檢查提示。</p>
        ) : (
          groups.map((group) => (
            <div
              key={group.key}
              className={`rsm-check-list-item${group.key === activeKey ? ' rsm-selected' : ''}`}
            >
              <button
                type="button"
                className="rsm-check-list-jump"
                onClick={() => onSelect(group)}
                title="在圖上定位這個節點"
              >
                ⌖ 定位
              </button>
              {group.checks.map((check, i) => (
                <CheckCard key={i} check={check} elk={elk} onResolveElkLink={onResolveElkLink} />
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
