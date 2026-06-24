import { useState } from 'react';
import type { DiagramEditorHandle } from '../core/editor/controller';
import type { Tool } from '../core/editor/interaction/pointer';
import type { NodeShape } from '../core/editor/scene/types';
import type { EditorLook } from '../core/editor/render/scene-renderer';

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
  /** 目前外觀(clean / sketch),供手繪切換鈕初始狀態。 */
  look?: EditorLook;
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
  const [look, setLookState] = useState<EditorLook>(props.look ?? 'clean');
  const toggleLook = (): void => {
    const next: EditorLook = look === 'sketch' ? 'clean' : 'sketch';
    h?.setLook(next);
    setLookState(next);
  };
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
  // timeline 走結構化表單(非畫布),所有畫布工具(選取/連線/縮放/整理)都隱藏。
  const isSeq = props.diagramType === 'sequence';
  const isTimeline = props.diagramType === 'timeline';
  const hasDirection =
    props.diagramType === 'flowchart' ||
    props.diagramType === 'state' ||
    props.diagramType === 'class' ||
    props.diagramType === 'er' ||
    props.diagramType === undefined;

  return (
    <div className="rsm-toolbar rsm-editor-toolbar">
      {!isTimeline && toolBtn('select', '➤ 選取', '選取 / 移動（V）')}
      {!isSeq && !isTimeline && toolBtn('edge-create', '↘ 連線', '從節點拉出連線（E）')}
      {!isTimeline && toolBtn('pan', '✋ 平移', '平移畫布')}

      {isTimeline && <span className="rsm-tb-hint">時間軸：在左側表單編輯區段 / 時間點 / 事件</span>}

      {!isSeq && !isTimeline && <span className="rsm-tb-sep" aria-hidden="true" />}

      {/* 一鍵新增節點(常用外形直接攤開);sequence/timeline 不適用 */}
      {!isSeq &&
        !isTimeline &&
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
      {!isTimeline && (
        <button type="button" className="rsm-btn" onClick={() => h?.deleteSelection()} title="刪除選取（Del）">
          🗑
        </button>
      )}

      {!isTimeline && (
        <>
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
        </>
      )}

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
      {!isTimeline && (
        <button
          type="button"
          className={`rsm-btn${look === 'sketch' ? ' rsm-btn-active' : ''}`}
          onClick={toggleLook}
          title="手繪外觀（Excalidraw 風）↔ 簡潔"
        >
          ✏ 手繪
        </button>
      )}
      {!isTimeline && (
        <button type="button" className="rsm-btn" onClick={() => h?.toggleHelp()} title="鍵盤快捷鍵說明（?）">
          ?
        </button>
      )}
    </div>
  );
}
