// ORID 表單編輯器(框架無關)。ORID 是條列式的引導討論資料,不是自由拖拉的畫布圖,
// 故沿用 timeline 的「結構化表單 + 即時預覽」模式:左側四段固定卡片(O/R/I/D)可增刪、
// 排序項目,右側即時渲染。所有變更序列化回 ORID 原始碼並透過 emit 通知 host 寫回原檔。
//
// 與 timeline 的差別:階段是固定的四個、順序不可改(那正是 ORID 的方法論本身),
// 所以卡片沒有「上移 / 下移 / 刪除階段」,改成「這段先不談 → 收合(移除)/ 加回來」。
//
// 由 controller.createDiagramEditor 在偵測到 orid 時惰性建立並接管 handle 的子集。

import { assertBrowser } from '../../../env';
import { renderDiagram } from '../../render-pipeline';
import { prepareSvgElement, rasterizeToBlob, flattenForeignObjects } from '../../export';
import type { MermaidSource } from '../../../types';
import {
  ORID_STAGES,
  emptyOridModel,
  orderedStages,
  oridStageSpec,
  parseOrid,
  serializeOrid,
  type OridModel,
  type OridStage,
  type OridStageKey,
} from '../../orid/model';
import { ORID_PALETTE } from '../../orid/theme';
import { ensureFormStyles } from './form-styles';
import type { FormEditorHandle } from './types';

export interface OridFormOptions {
  mermaid?: MermaidSource;
  dark?: boolean;
  fontUrl?: string;
  /** 轉發給 controller 的事件匯流(change / mermaidchange / historychange / error)。 */
  emit?: (event: string, payload?: unknown) => void;
}

export interface OridFormHandle extends FormEditorHandle {
  getModel(): OridModel;
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

const clone = (m: OridModel): OridModel => JSON.parse(JSON.stringify(m)) as OridModel;

export function createOridForm(host: HTMLElement, opts: OridFormOptions = {}): OridFormHandle {
  assertBrowser('createOridForm');
  ensureFormStyles();

  let dark = opts.dark ?? false;
  let model: OridModel = { stages: [] };
  const undoStack: OridModel[] = [];
  const redoStack: OridModel[] = [];
  let lastPreviewSvg: SVGSVGElement | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let mermaidTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  /** 重建表單後要自動聚焦的輸入(由結構操作設定)。 */
  let focusKey: string | null = null;

  const root = el('div', { class: 'rsm-form-root rsm-orid-root' });
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
    const code = serializeOrid(model);
    try {
      // renderDiagram 內部會轉譯 ORID → flowchart,故這裡直接餵 ORID 原始碼即可。
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
    mermaidTimer = setTimeout(() => emit('mermaidchange', serializeOrid(model)), 220);
  }

  /** 文字編輯:即時更新模型 + 預覽 + 寫回,但不重建表單(保留游標)。 */
  function softSync(): void {
    emit('change');
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
        undoStack.push(JSON.parse(baseline) as OridModel);
        if (undoStack.length > 100) undoStack.shift();
        redoStack.length = 0;
        emitHistory();
      }
      baseline = null;
    });
  }

  function iconBtn(
    glyph: string,
    title: string,
    onClick: () => void,
    opts2: { danger?: boolean; disabled?: boolean } = {},
  ): HTMLButtonElement {
    const b = el(
      'button',
      { type: 'button', class: 'rsm-form-iconbtn' + (opts2.danger ? ' rsm-form-del' : ''), title },
      [glyph],
    );
    if (opts2.disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  function addBtn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', class: 'rsm-form-addbtn ' + cls }, [label]);
    b.addEventListener('click', onClick);
    return b;
  }

  function swap<T>(arr: T[], a: number, b: number): void {
    if (a < 0 || b < 0 || a >= arr.length || b >= arr.length) return;
    [arr[a], arr[b]] = [arr[b], arr[a]];
  }

  const stageOf = (key: OridStageKey): OridStage | undefined => model.stages.find((s) => s.key === key);

  function renderItem(stage: OridStage, index: number): HTMLElement {
    const row = el('div', { class: 'rsm-form-event' });
    const input = el('input', {
      class: 'rsm-form-input',
      type: 'text',
      value: stage.items[index],
      placeholder: oridStageSpec(stage.key).hint,
    }) as HTMLInputElement;
    bindText(input, (v) => {
      stage.items[index] = v;
    });
    if (focusKey === `i:${stage.key}:${index}`) setTimeout(() => input.focus(), 0);
    row.append(
      input,
      iconBtn('↑', '上移項目', () => mutate(() => swap(stage.items, index, index - 1)), {
        disabled: index === 0,
      }),
      iconBtn('↓', '下移項目', () => mutate(() => swap(stage.items, index, index + 1)), {
        disabled: index === stage.items.length - 1,
      }),
      iconBtn('✕', '刪除項目', () => mutate(() => stage.items.splice(index, 1)), { danger: true }),
    );
    return row;
  }

  /** 已納入圖表的階段卡片。 */
  function renderStage(stage: OridStage): HTMLElement {
    const spec = oridStageSpec(stage.key);
    const palette = ORID_PALETTE[stage.key];
    const card = el('div', { class: 'rsm-form-section rsm-orid-stage' });
    card.style.setProperty('--rsm-orid-accent', palette.itemStroke);

    const head = el('div', { class: 'rsm-form-section-head' });
    head.append(
      el('span', { class: 'rsm-form-section-tag rsm-orid-tag' }, [`${spec.ordinal} ${spec.zh}`]),
    );
    const headingInput = el('input', {
      class: 'rsm-form-input',
      type: 'text',
      value: stage.heading ?? '',
      placeholder: `段落標題(留空 = ${spec.ordinal} ${spec.zh} · ${spec.en})`,
    }) as HTMLInputElement;
    bindText(headingInput, (v) => {
      stage.heading = v.trim() === '' ? undefined : v;
    });
    if (focusKey === `h:${stage.key}`) setTimeout(() => headingInput.focus(), 0);
    head.append(
      headingInput,
      iconBtn(
        '✕',
        `這次不談「${spec.zh}」(從圖表移除整段)`,
        () =>
          mutate(() => {
            model.stages = model.stages.filter((s) => s.key !== stage.key);
          }),
        { danger: true },
      ),
    );
    card.append(head);
    card.append(el('div', { class: 'rsm-orid-hint' }, [spec.hint]));

    const items = el('div', { class: 'rsm-form-events' });
    stage.items.forEach((_, i) => items.append(renderItem(stage, i)));
    items.append(
      addBtn('＋ 項目', 'rsm-form-add-event', () =>
        mutate(() => {
          stage.items.push('');
          focusKey = `i:${stage.key}:${stage.items.length - 1}`;
        }),
      ),
    );
    card.append(items);
    return card;
  }

  /** 尚未納入的階段:一顆「加回來」按鈕,順序仍照 O→R→I→D 插回正確位置。 */
  function renderMissingStage(key: OridStageKey): HTMLElement {
    const spec = oridStageSpec(key);
    return addBtn(`＋ ${spec.ordinal} ${spec.zh} · ${spec.en}`, 'rsm-orid-add-stage', () =>
      mutate(() => {
        model.stages.push({ key, items: [''] });
        model.stages = orderedStages(model);
        focusKey = `i:${key}:0`;
      }),
    );
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
      placeholder: '例:上線後回顧會議',
    }) as HTMLInputElement;
    bindText(titleInput, (v) => {
      model.title = v;
    });
    titleRow.append(titleInput);
    pane.append(titleRow);

    for (const stage of orderedStages(model)) pane.append(renderStage(stage));

    const missing = ORID_STAGES.filter((spec) => !stageOf(spec.key));
    if (missing.length > 0) {
      const row = el('div', { class: 'rsm-orid-missing' });
      row.append(el('span', { class: 'rsm-form-section-tag' }, ['加回階段']));
      for (const spec of missing) row.append(renderMissingStage(spec.key));
      pane.append(row);
    }

    if (consumedFocus === focusKey) focusKey = null; // 已消費(setTimeout 內聚焦)
  }

  const handle: OridFormHandle = {
    loadSource: (text) => {
      const parsed = parseOrid(text);
      // 只有 `orid` 一行(全新圖)→ 用四段齊備的骨架起手,別給使用者一張空白表單。
      model = parsed.stages.length === 0 && !parsed.raw ? { ...parsed, ...emptyOridModel() } : parsed;
      undoStack.length = 0;
      redoStack.length = 0;
      renderForm();
      emit('change');
      emit('mermaidchange', serializeOrid(model));
      emitHistory();
      void doRenderPreview();
    },
    toMermaid: () => serializeOrid(model),
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
