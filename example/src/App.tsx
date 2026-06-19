import { useRef, useState } from 'react';
import {
  MermaidDiagram,
  MermaidViewer,
  type MermaidTheme,
  type MermaidViewerHandle,
} from 'react-super-mermaid';

const FLOWCHART = `flowchart LR
  A[使用者] --> B{已登入?}
  B -- 是 --> C[進入大廳]
  B -- 否 --> D[導向登入]
  C --> E[(資料庫)]
  D --> E`;

const SEQUENCE = `sequenceDiagram
  participant U as 玩家
  participant TP as TpService
  participant P as 三方
  U->>TP: GotoGame
  TP->>P: ValidateToken
  P-->>TP: OK
  TP-->>U: 遊戲網址`;

export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<MermaidTheme>('colorful');
  const diagramRef = useRef<MermaidViewerHandle>(null);

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24, display: 'grid', gap: 32 }}>
      <h1>react-super-mermaid</h1>

      <section>
        <h2>1) 顯示 toolbox（完整工具列）</h2>
        <div style={{ height: 420 }}>
          <MermaidViewer code={FLOWCHART} toolbar theme={theme} />
        </div>
      </section>

      <section>
        <h2>2) 只顯示圖表 + host 自建按鈕（透過 ref）</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={() => diagramRef.current?.zoomIn()}>放大</button>
          <button onClick={() => diagramRef.current?.zoomOut()}>縮小</button>
          <button onClick={() => diagramRef.current?.fit()}>符合視窗</button>
          <button onClick={() => diagramRef.current?.search('三方')}>搜尋「三方」</button>
          <button onClick={() => void diagramRef.current?.downloadPng('seq.png', { scale: 2 })}>
            下載 PNG
          </button>
          <select value={theme} onChange={(e) => setTheme(e.target.value as MermaidTheme)}>
            <option value="colorful">Colorful</option>
            <option value="sketch">Excalidraw</option>
            <option value="default">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div style={{ height: 420 }}>
          <MermaidDiagram ref={diagramRef} code={SEQUENCE} theme={theme} />
        </div>
      </section>
    </main>
  );
}
