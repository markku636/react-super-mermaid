// Timeline 表單編輯器(框架無關)。timeline 不吃畫布拖拉,故用「結構化表單 + 即時預覽」:
// 左側編輯 section / time-period / events,右側即時渲染 mermaid。所有變更序列化回 mermaid
// 並透過 emit 回呼通知 host(VS Code webview / React)寫回原檔。
//
// 由 controller.createDiagramEditor 在偵測到 timeline 時惰性建立並接管 handle 的子集。

import { assertBrowser } from '../../../env';
import { renderDiagram } from '../../render-pipeline';
import {
  prepareSvgElement,
  rasterizeToBlob,
  flattenForeignObjects,
} from '../../export';
import type { ExportRasterOptions, MermaidSource } from '../../../types';
import {
  parseTimeline,
  serializeTimeline,
  type TimelineModel,
  type TimelineSection,
  type TimelinePeriod,
} from './timeline-model';
import { ensureFormStyles } from './form-styles';

export interface TimelineFormOptions {
  mermaid?: MermaidSource;
  dark?: boolean;
  fontUrl?: string;
  /** 轉發給 controller 的事件匯流(change / mermaidchange / historychange / error)。 */
  emit?: (event: string, payload?: unknown) => void;
}

export interface TimelineFormHandle {
  loadSource(text: string): void;
  toMermaid(): string;
  getModel(): TimelineModel;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  setDark(dark: boolean): void;
  exportSvg(): string;
  exportPng(opts?: ExportRasterOptions): Promise<Blob>;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  destroy(): void;
}

type Attrs = Record<string, string | undefined>;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  children?: Array<Node | string>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined) continue;
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
  }
  if (children) for (const c of children) node.append(c);
  return node;
}

const clone = (m: TimelineModel): TimelineModel => JSON.parse(JSON.stringify(m)) as TimelineModel;

export function createTimelineForm(host: HTMLElement, opts: TimelineFormOptions = {}): TimelineFormHandle {
  assertBrowser('createTimelineForm');
  ensureFormStyles();

  let dark = opts.dark ?? false;
  let model: TimelineModel = { sections: [] };
  const undoStack: TimelineModel[] = [];
  const redoStack: TimelineModel[] = [];
  let lastPreviewSvg: SVGSVGElement | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let mermaidTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  /** 重建表單後要自動聚焦的輸入(由結構操作設定)。 */
  let focusKey: string | null = null;

  const root = el('div', { class: 'rsm-form-root' });
  const pane = el('div', { class: 'rsm-form-pane' });
  const preview = el('div', { class: 'rsm-form-preview' });
  root.append(pane, preview);
  host.append(root);

  const emit = (event: string, payload?: unknown): void => opts.emit?.(event, payload);
  const emitHistory = (): void =>
    emit('historychange', { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });

  function schedulePreview(): void {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      void doRenderPreview();
    }, 140);
  }

  async function doRenderPreview(): Promise<void> {
    if (destroyed) return;
    const code = serializeTimeline(model);
    try {
      const { svg } = await renderDiagram({
        code,
        container: preview,
        theme: 'colorful',
        dark,
        mermaid: opts.mermaid,
      });
      lastPreviewSvg = svg;
    } catch (err) {
      lastPreviewSvg = null;
      preview.replaceChildren(
        el('div', { class: 'rsm-form-preview-err' }, [
          '預覽失敗:\n' + (err instanceof Error ? err.message : String(err)),
        ]),
      );
      emit('error', err);
    }
  }

  /** mermaidchange 寫回防抖(對齊畫布編輯器,避免每個按鍵都觸發 host 寫回原檔)。 */
  function emitMermaidDebounced(): void {
    if (mermaidTimer) clearTimeout(mermaidTimer);
    mermaidTimer = setTimeout(() => emit('mermaidchange', serializeTimeline(model)), 220);
  }

  /** 文字編輯:即時更新模型 + 預覽 + 寫回,但不重建表單(保留游標)。 */
  function softSync(): void {
    emit('change'); // 即時(供 React 原始碼面板 / 型別),mermaidchange 寫回則防抖
    emitMermaidDebounced();
    schedulePreview();
  }

  /** 結構編輯:重建表單 + 同步。 */
  function hardSync(): void {
    renderForm();
    emit('change');
    emitMermaidDebounced();
    schedulePreview();
  }

  /** 結構性變更:先存歷史快照,套用,再硬同步。 */
  function mutate(fn: () => void): void {
    undoStack.push(clone(model));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    fn();
    hardSync();
    emitHistory();
  }

  /** 文字輸入綁定:input 即時更新模型(軟同步);整段編輯合併為一個 undo 步。 */
  function bindText(input: HTMLInputElement, apply: (v: string) => void): void {
    let baseline: string | null = null;
    input.addEventListener('focus', () => {
      baseline = JSON.stringify(model);
    });
    input.addEventListener('input', () => {
      apply(input.value);
      softSync();
    });
    input.addEventListener('change', () => {
      if (baseline !== null && baseline !== JSON.stringify(model)) {
        undoStack.push(JSON.parse(baseline) as TimelineModel);
        if (undoStack.length > 100) undoStack.shift();
        redoStack.length = 0;
        emitHistory();
      }
      baseline = null;
    });
  }

  function iconBtn(glyph: string, title: string, onClick: () => void, opts2: { danger?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
    const b = el('button', {
      type: 'button',
      class: 'rsm-form-iconbtn' + (opts2.danger ? ' rsm-form-del' : ''),
      title,
    }, [glyph]);
    if (opts2.disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  function addBtn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', class: 'rsm-form-addbtn ' + cls }, [label]);
    b.addEventListener('click', onClick);
    return b;
  }

  function renderEvent(section: TimelineSection, period: TimelinePeriod, ei: number): HTMLElement {
    const row = el('div', { class: 'rsm-form-event' });
    const input = el('input', {
      class: 'rsm-form-input',
      type: 'text',
      value: period.events[ei],
      placeholder: '事件',
    }) as HTMLInputElement;
    bindText(input, (v) => {
      period.events[ei] = v;
    });
    if (focusKey === `e:${section.name}:${period.period}:${ei}`) setTimeout(() => input.focus(), 0);
    row.append(
      input,
      iconBtn('✕', '刪除事件', () => mutate(() => period.events.splice(ei, 1)), { danger: true }),
    );
    return row;
  }

  function renderPeriod(section: TimelineSection, pi: number): HTMLElement {
    const period = section.periods[pi];
    const wrap = el('div', { class: 'rsm-form-period' });
    const head = el('div', { class: 'rsm-form-period-head' });
    const pInput = el('input', {
      class: 'rsm-form-input',
      type: 'text',
      value: period.period,
      placeholder: '時間點(如 Q1 / 2025-07)',
    }) as HTMLInputElement;
    bindText(pInput, (v) => {
      period.period = v;
    });
    if (focusKey === `p:${section.name}:${pi}`) setTimeout(() => pInput.focus(), 0);
    head.append(
      pInput,
      iconBtn('↑', '上移時間點', () => mutate(() => swap(section.periods, pi, pi - 1)), { disabled: pi === 0 }),
      iconBtn('↓', '下移時間點', () => mutate(() => swap(section.periods, pi, pi + 1)), {
        disabled: pi === section.periods.length - 1,
      }),
      iconBtn('✕', '刪除時間點', () => mutate(() => section.periods.splice(pi, 1)), { danger: true }),
    );
    wrap.append(head);

    const events = el('div', { class: 'rsm-form-events' });
    period.events.forEach((_, ei) => events.append(renderEvent(section, period, ei)));
    events.append(
      addBtn('＋ 事件', 'rsm-form-add-event', () =>
        mutate(() => {
          period.events.push('');
          focusKey = `e:${section.name}:${period.period}:${period.events.length - 1}`;
        }),
      ),
    );
    wrap.append(events);
    return wrap;
  }

  function renderSection(si: number): HTMLElement {
    const section = model.sections[si];
    const card = el('div', { class: 'rsm-form-section' });
    const head = el('div', { class: 'rsm-form-section-head' });
    head.append(el('span', { class: 'rsm-form-section-tag' }, ['區段']));
    const nameInput = el('input', {
      class: 'rsm-form-input',
      type: 'text',
      value: section.name ?? '',
      placeholder: '區段名稱(可留空)',
    }) as HTMLInputElement;
    bindText(nameInput, (v) => {
      section.name = v === '' ? null : v;
    });
    if (focusKey === `s:${si}`) setTimeout(() => nameInput.focus(), 0);
    head.append(
      nameInput,
      iconBtn('↑', '上移區段', () => mutate(() => swap(model.sections, si, si - 1)), { disabled: si === 0 }),
      iconBtn('↓', '下移區段', () => mutate(() => swap(model.sections, si, si + 1)), {
        disabled: si === model.sections.length - 1,
      }),
      iconBtn('✕', '刪除區段', () => mutate(() => model.sections.splice(si, 1)), { danger: true }),
    );
    card.append(head);

    section.periods.forEach((_, pi) => card.append(renderPeriod(section, pi)));
    card.append(
      addBtn('＋ 時間點', '', () =>
        mutate(() => {
          section.periods.push({ period: '', events: [] });
          focusKey = `p:${section.name}:${section.periods.length - 1}`;
        }),
      ),
    );
    return card;
  }

  function renderForm(): void {
    const consumedFocus = focusKey;
    pane.replaceChildren();

    const titleRow = el('div', { class: 'rsm-form-title-row' });
    titleRow.append(el('label', {}, ['圖表標題']));
    const titleInput = el('input', {
      class: 'rsm-form-input',
      type: 'text',
      value: model.title ?? '',
      placeholder: '時間軸顯示標題',
    }) as HTMLInputElement;
    bindText(titleInput, (v) => {
      model.title = v;
    });
    titleRow.append(titleInput);
    pane.append(titleRow);

    model.sections.forEach((_, si) => pane.append(renderSection(si)));

    pane.append(
      addBtn('＋ 新增區段', 'rsm-form-add-section', () =>
        mutate(() => {
          model.sections.push({ name: '新區段', periods: [{ period: '時間點', events: ['事件'] }] });
          focusKey = `s:${model.sections.length - 1}`;
        }),
      ),
    );

    if (consumedFocus === focusKey) focusKey = null; // 已消費(setTimeout 內聚焦)
  }

  function swap<T>(arr: T[], a: number, b: number): void {
    if (a < 0 || b < 0 || a >= arr.length || b >= arr.length) return;
    [arr[a], arr[b]] = [arr[b], arr[a]];
  }

  const handle: TimelineFormHandle = {
    loadSource: (text) => {
      model = parseTimeline(text);
      undoStack.length = 0;
      redoStack.length = 0;
      renderForm();
      emit('change');
      emit('mermaidchange', serializeTimeline(model));
      emitHistory();
      void doRenderPreview();
    },
    toMermaid: () => serializeTimeline(model),
    getModel: () => model,
    undo: () => {
      const prev = undoStack.pop();
      if (!prev) return;
      redoStack.push(clone(model));
      model = prev;
      hardSync();
      emitHistory();
    },
    redo: () => {
      const next = redoStack.pop();
      if (!next) return;
      undoStack.push(clone(model));
      model = next;
      hardSync();
      emitHistory();
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    setDark: (d) => {
      dark = d;
      void doRenderPreview();
    },
    exportSvg: () => {
      if (!lastPreviewSvg) return '';
      const c = lastPreviewSvg.cloneNode(true) as SVGSVGElement;
      c.removeAttribute('style');
      return prepareSvgElement(c).serialized;
    },
    exportPng: async (rasterOpts) => {
      if (!lastPreviewSvg) throw new Error('尚未產生預覽圖,無法匯出。');
      const c = lastPreviewSvg.cloneNode(true) as SVGSVGElement;
      c.removeAttribute('style');
      flattenForeignObjects(c);
      return rasterizeToBlob(prepareSvgElement(c), { ...rasterOpts, dark });
    },
    show: () => {
      root.style.display = '';
    },
    hide: () => {
      root.style.display = 'none';
    },
    isVisible: () => root.style.display !== 'none',
    destroy: () => {
      destroyed = true;
      if (previewTimer) clearTimeout(previewTimer);
      if (mermaidTimer) clearTimeout(mermaidTimer);
      root.remove();
    },
  };

  return handle;
}
