import { forwardRef, useImperativeHandle, useState } from 'react';
import type { DiagramEditorHandle } from '../core/editor/controller';
import type { EditorScene } from '../core/editor/scene/types';
import type { EditorLook } from '../core/editor/render/scene-renderer';
import type { MermaidSource } from '../types';
import { EditorToolbar } from './EditorToolbar';
import { useDiagramEditor } from './useDiagramEditor';

export interface MermaidEditorProps {
  /** 初始 / 受控 mermaid 原始碼。外部變更會重新匯入為可編輯場景。 */
  source?: string;
  /** 初始場景(無 source 時用)。 */
  initialScene?: EditorScene;
  dark?: boolean;
  seed?: number;
  fontUrl?: string;
  /** 如何取得 mermaid(parse / layout / 預覽)。省略則動態 import peer。 */
  mermaid?: MermaidSource;
  /** 視覺風格:'sketch'(預設,手繪)/ 'clean'(俐落圓角+柔和陰影,貼近 colorful)。 */
  look?: EditorLook;
  /** 是否顯示內建工具列,預設 true。false = host 透過 ref 自建。 */
  toolbar?: boolean;
  /** 內建「原始碼」面板初始是否展開,預設 false(可由工具列 </> 原始碼 鈕切換)。 */
  defaultSource?: boolean;
  /** 場景變更(每次編輯即時)。 */
  onChange?: (scene: EditorScene) => void;
  /** 序列化後的 mermaid 文字(防抖)。 */
  onMermaidChange?: (text: string) => void;
  onError?: (err: unknown) => void;
  className?: string;
  style?: React.CSSProperties;
}

export type MermaidEditorHandle = DiagramEditorHandle;

export const MermaidEditor = forwardRef<MermaidEditorHandle, MermaidEditorProps>(
  function MermaidEditor(props, ref): React.JSX.Element {
    const { toolbar = true } = props;
    const ed = useDiagramEditor({
      source: props.source,
      scene: props.initialScene,
      mermaid: props.mermaid,
      dark: props.dark,
      seed: props.seed,
      fontUrl: props.fontUrl,
      look: props.look,
      onChange: props.onChange,
      onMermaidChange: props.onMermaidChange,
      onError: props.onError,
    });

    useImperativeHandle(ref, () => ed.handle as DiagramEditorHandle, [ed.handle]);

    const [showSource, setShowSource] = useState(props.defaultSource ?? false);
    const [copied, setCopied] = useState(false);
    const dark = props.dark ?? false;
    const copySource = (): void => {
      navigator.clipboard
        ?.writeText(ed.code)
        .then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => {});
    };

    return (
      <div
        className={['rsm-root', dark ? 'rsm-dark' : '', props.className ?? ''].filter(Boolean).join(' ')}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', ...props.style }}
      >
        {toolbar ? (
          <EditorToolbar
            handle={ed.handle}
            tool={ed.tool}
            canUndo={ed.canUndo}
            canRedo={ed.canRedo}
            zoomPercent={ed.zoomPercent}
            showSource={showSource}
            onToggleSource={() => setShowSource((s) => !s)}
          />
        ) : null}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div ref={ed.hostRef} className="rsm-editor-host" style={{ flex: 1, minWidth: 0 }} />
          {showSource ? (
            <div
              className="rsm-source-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: 'clamp(240px, 34%, 460px)',
                borderLeft: `1px solid ${dark ? '#30363d' : '#e5e7eb'}`,
                background: dark ? '#0d1117' : '#f8fafc',
                color: dark ? '#c9d1d9' : '#334155',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: 0.85,
                  borderBottom: `1px solid ${dark ? '#21262d' : '#e5e7eb'}`,
                }}
              >
                <span>Mermaid 原始碼</span>
                <button type="button" className="rsm-btn" onClick={copySource}>
                  {copied ? '✓ 已複製' : '複製'}
                </button>
              </div>
              <pre
                style={{
                  flex: 1,
                  margin: 0,
                  padding: 12,
                  overflow: 'auto',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: 'pre',
                }}
              >
                <code>{ed.code}</code>
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);
