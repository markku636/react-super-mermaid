import { useState } from 'react';
import type { DiagramEditorHandle } from '../core/editor/controller';
import type { Tool } from '../core/editor/interaction/pointer';
import type { NodeShape } from '../core/editor/scene/types';

export interface EditorToolbarProps {
  handle: DiagramEditorHandle | null;
  tool: Tool;
  canUndo: boolean;
  canRedo: boolean;
  zoomPercent: number;
  /** 「原始碼」面板是否開啟(由 MermaidEditor 控制)。 */
  showSource?: boolean;
  onToggleSource?: () => void;
  /** 目前圖種(決定顯示哪些建立控制項)。 */
  diagramType?: string;
}

// 常用外形:直接顯示成按鈕,點一下就在畫布中央放一個節點(免下拉選單、免再點畫布)。
const SHAPES: Array<{ shape: NodeShape; glyph: string; label: string }> = [
  { shape: 'rectangle', glyph: '▭', label: '方框' },
  { shape: 'rounded', glyph: '⬭', label: '圓角' },
  { shape: 'stadium', glyph: '⬮', label: '膠囊' },
  { shape: 'diamond', glyph: '◇', label: '菱形' },
  { shape: 'circle', glyph: '◯', label: '圓形' },
  { shape: 'hexagon', glyph: '⬡', label: '六角' },
  { shape: 'cylinder', glyph: '⛁', label: '資料庫' },
];

/** 內建工具列。重用 .rsm-toolbar / .rsm-btn class。toolbar={false} 時 host 可改用 ref 自建。 */
export function EditorToolbar(props: EditorToolbarProps): React.JSX.Element {
  const { handle: h, tool } = props;
  const [copied, setCopied] = useState(false);
  const copyImage = (): void => {
    void h
      ?.copyPngToClipboard()
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {
        /* 環境不支援剪貼簿圖片 → 靜默忽略,使用者仍可用 PNG 下載 */
      });
  };
  const toolBtn = (t: Tool, label: string, title: string): React.JSX.Element => (
    <button
      type="button"
      className={`rsm-btn${tool === t ? ' rsm-btn-active' : ''}`}
      title={title}
      onClick={() => h?.setTool(t)}
    >
      {label}
    </button>
  );

  // sequence 不吃自由拖曳建點/連線(改右鍵新增參與者/訊息);mindmap/sequence 無流程方向。
  const isSeq = props.diagramType === 'sequence';
  const hasDirection =
    props.diagramType === 'flowchart' ||
    props.diagramType === 'state' ||
    props.diagramType === 'class' ||
    props.diagramType === 'er' ||
    props.diagramType === undefined;

  return (
    <div className="rsm-toolbar rsm-editor-toolbar">
      {toolBtn('select', '➤ 選取', '選取 / 移動（V）')}
      {!isSeq && toolBtn('edge-create', '↘ 連線', '從節點拉出連線（E）')}
      {toolBtn('pan', '✋ 平移', '平移畫布')}

      {!isSeq && <span className="rsm-tb-sep" aria-hidden="true" />}

      {/* 一鍵新增節點(常用外形直接攤開);sequence 不適用(用右鍵新增參與者/訊息) */}
      {!isSeq &&
        SHAPES.map((s) => (
          <button
            key={s.shape}
            type="button"
            className="rsm-btn rsm-shape-btn"
            title={`新增${s.label}節點`}
            onClick={() => h?.addNode(s.shape)}
          >
            <span className="rsm-shape-glyph">{s.glyph}</span>
            {s.label}
          </button>
        ))}

      {isSeq && <span className="rsm-tb-hint">右鍵空白處：新增參與者 / 訊息</span>}

      {hasDirection && (
        <select
          className="rsm-btn"
          title="流程方向"
          defaultValue="TB"
          onChange={(e) => h?.setDirection(e.target.value as 'TB' | 'LR' | 'BT' | 'RL')}
        >
          <option value="TB">↓ 由上而下</option>
          <option value="LR">→ 由左而右</option>
          <option value="BT">↑ 由下而上</option>
          <option value="RL">← 由右而左</option>
        </select>
      )}

      <span className="rsm-tb-spacer" />

      <button type="button" className="rsm-btn" disabled={!props.canUndo} onClick={() => h?.undo()} title="復原（Ctrl+Z）">
        ↶
      </button>
      <button type="button" className="rsm-btn" disabled={!props.canRedo} onClick={() => h?.redo()} title="重做（Ctrl+Y）">
        ↷
      </button>
      <button type="button" className="rsm-btn" onClick={() => h?.deleteSelection()} title="刪除選取（Del）">
        🗑
      </button>

      <span className="rsm-tb-sep" aria-hidden="true" />

      <button type="button" className="rsm-btn" onClick={() => h?.zoomOut()} title="縮小">
        −
      </button>
      <span className="rsm-count">{props.zoomPercent}%</span>
      <button type="button" className="rsm-btn" onClick={() => h?.zoomIn()} title="放大">
        ＋
      </button>
      <button type="button" className="rsm-btn" onClick={() => h?.fit()} title="符合視窗">
        ⤢
      </button>
      <button type="button" className="rsm-btn" onClick={() => void h?.tidy()} title="自動整理排版">
        ⌗ 整理
      </button>

      {props.onToggleSource ? (
        <button
          type="button"
          className={`rsm-btn${props.showSource ? ' rsm-btn-active' : ''}`}
          onClick={props.onToggleSource}
          title="顯示 / 隱藏 Mermaid 原始碼"
        >
          {'</>'} 原始碼
        </button>
      ) : null}

      <button type="button" className="rsm-btn" onClick={() => h?.downloadSvg()} title="匯出 SVG">
        SVG
      </button>
      <button type="button" className="rsm-btn" onClick={() => void h?.downloadPng()} title="匯出 PNG">
        PNG
      </button>
      <button
        type="button"
        className="rsm-btn"
        onClick={copyImage}
        title="複製圖片到剪貼簿"
      >
        {copied ? '✓ 已複製' : '⧉ 複製'}
      </button>
      <button type="button" className="rsm-btn" onClick={() => h?.toggleHelp()} title="鍵盤快捷鍵說明（?）">
        ?
      </button>
    </div>
  );
}
