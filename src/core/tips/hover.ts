// 節點懸停提示(tooltip)引擎:框架無關,掛在已渲染的 mermaid SVG 上。
//
// 為什麼不用 SVG <title>:原生 tooltip 出現慢(~1s)、無法多行排版、不吃深色主題,
// 也沒辦法退回「顯示節點完整文字」這類動態內容。這裡用一顆絕對定位的 HTML div,
// 跟著游標走、可主題化;pointer-events:none 所以完全不干擾 svg-pan-zoom 的拖曳。
//
// 內容來源優先序:getTip callback → 授權提示(@tip 指令 / tips prop)→ 檢查提示摘要
// (讀角標的 <title>,免重複組字)→(可選)節點完整文字 + id 的退路。

import type { DiagramTip } from '../../types';
import { authorIdFromDomId, nodeLabelText } from '../node-index';

/** 懸停目標的節點層級 —— 與 node-index 的 TARGETABLE 同一套語彙。 */
const HOVER_GROUPS = 'g.node, g.cluster';

export interface HoverTipContext {
  /** 作者在原始碼寫的節點 id(還原不到時為 undefined,如序列圖角色)。 */
  id?: string;
  /** 節點的可見文字。 */
  label: string;
  /** 節點元素。 */
  node: Element;
}

/**
 * 動態決定某節點的提示文字:回傳字串 = 顯示它;回傳 null = 這個節點不顯示;
 * 回傳 undefined = 交回內建查找(授權提示 → 檢查摘要 → 退路)。
 */
export type GetNodeTip = (ctx: HoverTipContext) => string | null | undefined;

export interface AttachHoverTipsOptions {
  /** 本次 render 的 id(節點 DOM id 前綴)。 */
  renderId?: string;
  /** 授權提示(來自 `%% @tip` 指令與 `tips` prop 合併後的清單)。 */
  tips?: DiagramTip[];
  /** 動態覆寫;優先於授權提示。 */
  getTip?: GetNodeTip;
  /**
   * 無授權提示時是否退回顯示「節點完整文字(+ id)」。
   * 對長標籤被縮圖擠到難讀的圖很有用;預設 false(避免每個節點都彈提示的噪音)。
   */
  fallbackLabel?: boolean;
  /** 有檢查提示的節點,懸停節點本體時顯示提示摘要(讀角標 <title>)。預設 true。 */
  checksSummary?: boolean;
  /** 顯示延遲 ms(避免游標掃過整張圖時提示連環閃)。預設 120。 */
  delay?: number;
}

export interface HoverTipsController {
  destroy(): void;
}

interface TipContent {
  title: string;
  body: string;
}

/** 距游標的偏移(px)與貼邊內縮。 */
const OFFSET_X = 14;
const OFFSET_Y = 18;
const EDGE_PAD = 6;

/**
 * 把懸停提示掛上 SVG。`host` 是 tooltip div 的容器,必須是 positioned 元素
 * (viewer 傳 `.rsm-canvas`);回傳 controller 供重繪 / 卸載時清理。
 */
export function attachHoverTips(
  svg: SVGSVGElement,
  host: HTMLElement,
  opts: AttachHoverTipsOptions = {},
): HoverTipsController {
  const delay = opts.delay ?? 120;

  // 授權提示查表:id 與標籤(小寫)各一張,attach 時建好,懸停 O(1)。
  const byId = new Map<string, string>();
  const byLabel = new Map<string, string>();
  for (const tip of opts.tips ?? []) {
    if (tip.match === 'label') {
      byLabel.set(tip.target.trim().toLowerCase(), tip.text);
    } else {
      byId.set(tip.target, tip.text);
      // id 找不到節點時常見於序列圖等 DOM id 規則不同的圖型 —— 同時登記到標籤表當退路,
      // 與 findDiagramNode 的「id 優先、標籤兜底」策略一致。
      const lower = tip.target.trim().toLowerCase();
      if (!byLabel.has(lower)) {
        byLabel.set(lower, tip.text);
      }
    }
  }

  const el = document.createElement('div');
  el.className = 'rsm-tip';
  el.setAttribute('role', 'tooltip');
  el.setAttribute('aria-hidden', 'true');
  const titleEl = document.createElement('div');
  titleEl.className = 'rsm-tip-title';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'rsm-tip-body';
  el.append(titleEl, bodyEl);
  host.appendChild(el);

  let current: Element | null = null;
  let visible = false;
  let suppressed = false; // pointerdown(拖曳平移)期間不顯示
  let showTimer = 0;
  let lastX = 0;
  let lastY = 0;

  /** 事件目標 → 可掛提示的節點群組;序列圖角色(.actor)取其父 <g>。 */
  const groupFor = (target: EventTarget | null): Element | null => {
    if (!(target instanceof Element)) {
      return null;
    }
    const group = target.closest(HOVER_GROUPS);
    if (group) {
      return group;
    }
    return target.closest('.actor')?.parentElement ?? null;
  };

  const contentFor = (group: Element): TipContent | undefined => {
    const id = group.id ? authorIdFromDomId(group.id, opts.renderId) : undefined;
    const label = nodeLabelText(group);

    const custom = opts.getTip?.({ id, label, node: group });
    if (custom === null) {
      return undefined;
    }
    if (typeof custom === 'string' && custom.trim()) {
      return { title: label || id || '', body: custom };
    }

    const authored = (id !== undefined ? byId.get(id) : undefined) ?? byLabel.get(label.toLowerCase());
    if (authored) {
      return { title: label || id || '', body: authored };
    }

    if (opts.checksSummary !== false) {
      // 角標的 <title> 已經是組好的摘要(標題 + 則數 + 首則說明),直接借用。
      const badgeTitle = group.querySelector(':scope > g.rsm-check-badge > title')?.textContent;
      if (badgeTitle) {
        return { title: label || id || '', body: badgeTitle };
      }
    }

    if (opts.fallbackLabel && (label || id)) {
      return { title: label || id || '', body: id && label ? `id: ${id}` : '' };
    }
    return undefined;
  };

  const hide = (): void => {
    window.clearTimeout(showTimer);
    showTimer = 0;
    visible = false;
    el.classList.remove('rsm-tip-visible');
    el.setAttribute('aria-hidden', 'true');
  };

  const position = (): void => {
    const rect = host.getBoundingClientRect();
    let left = lastX - rect.left + OFFSET_X;
    let top = lastY - rect.top + OFFSET_Y;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // 貼近右 / 下邊界時翻到游標另一側,再夾回容器內。
    if (left + w > host.clientWidth - EDGE_PAD) {
      left = lastX - rect.left - w - OFFSET_X;
    }
    if (top + h > host.clientHeight - EDGE_PAD) {
      top = lastY - rect.top - h - OFFSET_Y;
    }
    el.style.left = `${Math.max(EDGE_PAD, left)}px`;
    el.style.top = `${Math.max(EDGE_PAD, top)}px`;
  };

  const show = (content: TipContent): void => {
    titleEl.textContent = content.title;
    titleEl.style.display = content.title ? '' : 'none';
    bodyEl.textContent = content.body;
    bodyEl.style.display = content.body ? '' : 'none';
    visible = true;
    el.setAttribute('aria-hidden', 'false');
    position();
    el.classList.add('rsm-tip-visible');
  };

  const scheduleShow = (group: Element): void => {
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => {
      // 延遲期間可能已經重繪 / 拖曳中 —— 顯示前再確認一次。
      if (suppressed || current !== group || !group.isConnected) {
        return;
      }
      const content = contentFor(group);
      if (content) {
        show(content);
      }
    }, delay);
  };

  const onOver = (e: Event): void => {
    const pe = e as PointerEvent;
    lastX = pe.clientX;
    lastY = pe.clientY;
    const target = pe.target;
    // 檢查角標自己有原生 <title> tooltip(匯出也帶得走),懸停角標時讓路、不疊兩層。
    if (target instanceof Element && target.closest('.rsm-check-badge')) {
      current = null;
      hide();
      return;
    }
    const group = groupFor(target);
    if (group === current) {
      return;
    }
    current = group;
    hide();
    if (group && !suppressed) {
      scheduleShow(group);
    }
  };

  const onMove = (e: Event): void => {
    const pe = e as PointerEvent;
    lastX = pe.clientX;
    lastY = pe.clientY;
    if (visible) {
      position();
    }
  };

  const onOut = (e: Event): void => {
    const pe = e as PointerEvent;
    // 還在同一個節點群組內移動(進入子元素)不算離開。
    if (current && pe.relatedTarget instanceof Element && current.contains(pe.relatedTarget)) {
      return;
    }
    current = null;
    hide();
  };

  const onDown = (): void => {
    suppressed = true;
    hide();
  };

  const onUp = (): void => {
    suppressed = false;
    // 拖曳結束後游標若仍停在節點上,重新排程顯示(pointerover 不會再觸發)。
    if (current) {
      scheduleShow(current);
    }
  };

  svg.addEventListener('pointerover', onOver);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerout', onOut);
  svg.addEventListener('pointerdown', onDown);
  // pointerup 掛 window:拖曳常在 SVG 外放開,掛 svg 會漏接、提示卡在隱藏狀態。
  window.addEventListener('pointerup', onUp);

  return {
    destroy: () => {
      window.clearTimeout(showTimer);
      svg.removeEventListener('pointerover', onOver);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerout', onOut);
      svg.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      el.remove();
    },
  };
}
