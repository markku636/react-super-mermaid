import { useEffect, useState } from 'react';
import type { DiagramEditorHandle } from '../core/editor/controller';
import type { Tool } from '../core/editor/interaction/pointer';
import type { ArrowHead, LineKind, NodeShape } from '../core/editor/scene/types';
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
  /** 目前選取的元素 id(用來把連線控制項同步成選取連線的樣式)。 */
  selection?: string[];
  /** 目前外觀(clean / sketch),供手繪切換鈕初始狀態。 */
  look?: EditorLook;
}

// 全部 flowchart 外形的字形 + 名稱(serialize / parse / renderer 皆可雙向 round-trip)。
const SHAPE_META: Record<string, { glyph: string; label: string }> = {
  rectangle: { glyph: '▭', label: '方框' },
  rounded: { glyph: '⬭', label: '圓角' },
  stadium: { glyph: '⬮', label: '膠囊' },
  diamond: { glyph: '◇', label: '菱形' },
  circle: { glyph: '◯', label: '圓形' },
  hexagon: { glyph: '⬡', label: '六角' },
  cylinder: { glyph: '⛁', label: '資料庫' },
  subroutine: { glyph: '⧈', label: '子流程' },
  doubleCircle: { glyph: '◎', label: '雙圈' },
  ellipse: { glyph: '⬭', label: '橢圓' },
  parallelogram: { glyph: '▱', label: '平行四邊形' },
  parallelogramAlt: { glyph: '▰', label: '平行四邊形(左)' },
  trapezoid: { glyph: '⏢', label: '梯形' },
  trapezoidAlt: { glyph: '⏏', label: '梯形(倒)' },
  odd: { glyph: '⬠', label: '旗標' },
};

// 常用外形:直接顯示成按鈕,點一下就在畫布中央放一個節點(免下拉選單、免再點畫布)。
const QUICK_SHAPES: NodeShape[] = ['rectangle', 'rounded', 'stadium', 'diamond', 'circle', 'hexagon', 'cylinder'];
// 其餘外形收進「更多外形」下拉,維持工具列精簡又完整。
const MORE_SHAPES: NodeShape[] = [
  'subroutine',
  'doubleCircle',
  'ellipse',
  'parallelogram',
  'parallelogramAlt',
  'trapezoid',
  'trapezoidAlt',
  'odd',
];

// 箭頭端的友善名稱(下拉選單用)。flowchart 用前 5 種;class/er 的三角 / 菱形 / 鳥足為後續圖種。
const ARROW_LABEL: Record<ArrowHead, string> = {
  none: '⎯ 無箭頭',
  arrow: '▸ 箭頭',
  open: '⇁ 開放',
  dot: '● 圓點',
  cross: '✕ 交叉',
  triangle: '▷ 三角(繼承)',
  diamond: '◇ 空心菱(聚合)',
  diamondFilled: '◆ 實心菱(組合)',
  crowFootOne: '⊣ 一',
  crowFootMany: '⪛ 多',
};

const LINE_LABEL: Record<LineKind, string> = {
  solid: '實線',
  dotted: '虛線',
  thick: '粗線',
  invisible: '隱形(不顯示連線)',
};

/** 線型的迷你預覽(inline SVG)。 */
function LineGlyph({ kind }: { kind: LineKind }): React.JSX.Element {
  const base = {
    x1: 2,
    y1: 6,
    x2: 26,
    y2: 6,
    stroke: 'currentColor',
    fill: 'none',
    strokeLinecap: 'round' as const,
  };
  const attrs =
    kind === 'thick'
      ? { ...base, strokeWidth: 3.6 }
      : kind === 'dotted'
        ? { ...base, strokeWidth: 1.8, strokeDasharray: '2 4' }
        : kind === 'invisible'
          ? { ...base, strokeWidth: 1.6, strokeDasharray: '1 4', strokeOpacity: 0.4 }
          : { ...base, strokeWidth: 1.8 };
  return (
    <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden="true">
      <line {...attrs} />
    </svg>
  );
}

/** 內建工具列。重用 .rsm-toolbar / .rsm-btn class。toolbar={false} 時 host 可改用 ref 自建。 */
export function EditorToolbar(props: EditorToolbarProps): React.JSX.Element {
  const { handle: h, tool } = props;
  const [copied, setCopied] = useState(false);
  const [look, setLookState] = useState<EditorLook>(props.look ?? 'clean');
  // 連線控制項顯示的樣式(= 新連線預設;選到單一連線時改顯示該線的樣式)。
  const [edge, setEdge] = useState<{ lineKind: LineKind; arrowStart: ArrowHead; arrowEnd: ArrowHead }>({
    lineKind: 'solid',
    arrowStart: 'none',
    arrowEnd: 'arrow',
  });

  // handle 就緒 / 切換圖種時,把連線控制項同步成該圖種的「新連線」預設。
  useEffect(() => {
    const d = h?.getEdgeStyleDefault();
    if (d) setEdge(d);
  }, [h, props.diagramType]);

  // 選到單一連線 → 控制項反映該連線目前的樣式(操作起來像作用在選取物件上)。
  useEffect(() => {
    const sel = props.selection ?? [];
    if (sel.length !== 1 || !h) return;
    const e = h.getScene().edges.find((x) => x.id === sel[0]);
    if (e) setEdge({ lineKind: e.lineKind, arrowStart: e.arrowStart, arrowEnd: e.arrowEnd });
  }, [props.selection, h]);

  const applyEdge = (patch: Partial<{ lineKind: LineKind; arrowStart: ArrowHead; arrowEnd: ArrowHead }>): void => {
    setEdge((cur) => ({ ...cur, ...patch }));
    h?.applyEdgeStyle(patch);
  };

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

  // 連線樣式控制項:依目前圖種能力顯示(只有一種選擇時整組隱藏,因無從選起)。
  const caps = h?.getCapabilities() ?? null;
  const lineKinds = caps?.lineKinds ?? [];
  const arrowHeads = caps?.arrowHeads ?? [];
  const showEdgeStyle = !isSeq && !isTimeline && caps !== null;
  const showLineKinds = showEdgeStyle && lineKinds.length > 1;
  const showArrowEnd = showEdgeStyle && arrowHeads.length > 1;
  // 雙向箭頭(`<-->`)目前只在 flowchart 有明確語法。
  const showBidir =
    showEdgeStyle && arrowHeads.includes('arrow') && (props.diagramType === 'flowchart' || props.diagramType === undefined);

  return (
    <div className="rsm-toolbar rsm-editor-toolbar">
      {!isTimeline && toolBtn('select', '➤ 選取', '選取 / 移動（V）')}
      {!isTimeline &&
        toolBtn(
          'edge-create',
          isSeq ? '↘ 訊息' : '↘ 連線',
          isSeq ? '從一條生命線拖到另一條，插入一則訊息（E）' : '從節點拉出連線（E）',
        )}
      {!isTimeline && toolBtn('pan', '✋ 平移', '平移畫布')}

      {isTimeline && <span className="rsm-tb-hint">時間軸：在左側表單編輯區段 / 時間點 / 事件</span>}

      {!isSeq && !isTimeline && <span className="rsm-tb-sep" aria-hidden="true" />}

      {/* 一鍵新增節點(常用外形直接攤開 + 「更多外形」下拉);sequence/timeline 不適用 */}
      {!isSeq &&
        !isTimeline &&
        QUICK_SHAPES.map((shape) => {
          const m = SHAPE_META[shape];
          return (
            <button
              key={shape}
              type="button"
              className="rsm-btn rsm-shape-btn"
              title={`新增${m.label}節點`}
              onClick={() => h?.addNode(shape)}
            >
              <span className="rsm-shape-glyph">{m.glyph}</span>
              {m.label}
            </button>
          );
        })}
      {!isSeq && !isTimeline && (
        <select
          className="rsm-btn"
          title="更多外形（新增節點）"
          value=""
          onChange={(e) => {
            const shape = e.target.value as NodeShape;
            if (shape) h?.addNode(shape);
            e.target.value = '';
          }}
        >
          <option value="">＋ 更多外形…</option>
          {MORE_SHAPES.map((shape) => (
            <option key={shape} value={shape}>
              {SHAPE_META[shape].glyph} {SHAPE_META[shape].label}
            </option>
          ))}
        </select>
      )}

      {isSeq && (
        <span className="rsm-tb-hint">
          訊息模式：從一條生命線拖到另一條 · 選取模式：拖曳參與者可重新排序 · 右鍵空白處：新增參與者 / 訊息
        </span>
      )}

      {/* 連線樣式:線型 + 箭頭。作用於選取的連線;未選取時設為「新連線」的預設。 */}
      {(showLineKinds || showArrowEnd) && <span className="rsm-tb-sep" aria-hidden="true" />}
      {showLineKinds && (
        <span className="rsm-line-group" role="group" aria-label="線型">
          {lineKinds.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`rsm-btn rsm-line-btn${edge.lineKind === kind ? ' rsm-btn-active' : ''}`}
              title={LINE_LABEL[kind]}
              aria-label={LINE_LABEL[kind]}
              onClick={() => applyEdge({ lineKind: kind })}
            >
              <LineGlyph kind={kind} />
            </button>
          ))}
        </span>
      )}
      {showArrowEnd && (
        <select
          className="rsm-btn"
          title="箭頭樣式（套用到選取的連線 / 新連線預設）"
          value={edge.arrowEnd}
          onChange={(e) => applyEdge({ arrowEnd: e.target.value as ArrowHead })}
        >
          {arrowHeads.map((head) => (
            <option key={head} value={head}>
              {ARROW_LABEL[head]}
            </option>
          ))}
        </select>
      )}
      {showBidir && (
        <button
          type="button"
          className={`rsm-btn${edge.arrowStart !== 'none' ? ' rsm-btn-active' : ''}`}
          title="雙向箭頭（起點也加箭頭）"
          onClick={() => applyEdge({ arrowStart: edge.arrowStart === 'none' ? 'arrow' : 'none' })}
        >
          ⇄ 雙向
        </button>
      )}

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
