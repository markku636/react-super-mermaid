import { useRef, useState } from 'react';
import {
  MermaidDiagram,
  MermaidViewer,
  type DiagramCheck,
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

/**
 * 長標籤回歸樣本(oncall 未結算排查決策樹)。
 * `A1` / `Q2` / `Q4` 的標籤刻意留長 —— 這是節點標籤裁字的重現與回歸來源,
 * 請在 Windows 100% / 125% / 150% 縮放下各檢視一次,確認尾字不被裁掉。
 */
const UNSETTLED_TREE = `flowchart TD
    S(["未結算申告<br/>手上有 TpId + TransId"]) --> Q1{"① TpList.WalletType<br/>這家是哪種錢包？"}

    Q1 -->|"1 單一錢包制"| A1["錢在我方<br/>seamless log 與 Bettrans 都有意義"]
    Q1 -->|"0 轉帳制"| A0["不經 seamless、靠 Wager 拉單<br/>⚠️ seamless 查無是正常<br/>不可判為三方漏送"]

    A1 --> Q2{"② TpBetRecord ∪ TpUnsettle<br/>（UNION 版）我方寫入結算了嗎？"}
    A0 --> Q2

    Q2 -->|"只有 TpUnsettle<br/>（最典型）"| Q3
    Q2 -->|"兩邊都無<br/>我方完全沒收到"| Q4

    Q3{"③ TpUnsettle.SettleFlag<br/>佇列掛什麼旗標？"}
    Q3 -->|"-1 結算失敗"| LOG["查 ELK settleworker log<br/>常見：金額比對失敗 / DB 寫入失敗"]

    Q4{"⑤⑥⑦ 上游有沒有結算列？<br/>Bettrans_*_Settle / TpWager_*<br/>含 _old / _Bak* / _YYYYMM"}
    Q4 -->|"只有 PlaceBet / 完全沒有"| CASE_B(["(b) 三方漏送結算<br/>→ 外呼三方補單 API"])

%% @check Q1 先定型：這家是哪種錢包
%% severity: info
%% desc: WalletType 決定後面查哪條鏈。轉帳制（0）不經 SeamlessWallet，此時 seamless 查無是正常的。
%% steps:
%%   查 TpList 確認 WalletType
%%   WalletType=1 單一錢包制 → 查 Bettrans + seamless log
%%   WalletType=0 轉帳制 → 改查 BetDetail.TpWager_*，不可判為三方漏送
%% sql: |
%%   SELECT Id AS TpId, TpName, DisplayName, WalletType, WalletMode, Status
%%   FROM TpList WHERE Id = {TpId};
%% link: 未結算 SQL 速查 | https://example.com/knowledge/settlement-unsettled

%% @check Q2 一刀流：注單終態 × 結算佇列
%% severity: warn
%% desc: 用 UNION 版而不是 LEFT JOIN —— 兩邊誰有就顯示誰，「注單不在但佇列還掛著」一眼看出來。
%% sql: |
%%   SELECT 'TpBetRecord' AS Src, b.TransId, b.TicketStatus, b.UpdateTime
%%   FROM TpBetRecord b WHERE b.TransId = '{TransId}'
%%   UNION ALL
%%   SELECT 'TpUnsettle', u.TransId, u.SettleFlag, u.UpdateTime
%%   FROM TpUnsettle u WHERE u.TransId = '{TransId}';

%% @check LOG 查 settleworker 結算失敗原因
%% severity: error
%% desc: SettleFlag=-1 代表結算跑過但失敗，最常見是金額比對失敗或 DB 寫入失敗。
%% elk: Properties.TransId : "{TransId}" and level : "Error"
%% sql: |
%%   SELECT TransId, SettleFlag, RetryCount, UpdateTime
%%   FROM TpUnsettle WHERE TransId = '{TransId}';`;

/**
 * 懸停提示示範:`%% @tip` 讓 AI 產圖時把「每一步在做什麼」一起帶出來,
 * 滑鼠停上去就看得到,不用點。縮排的 %% 行是續行。
 */
const PIPELINE_WITH_TIPS = `flowchart LR
  IN[收單] --> VAL{驗證}
  VAL -- 過 --> Q[(佇列)]
  VAL -- 不過 --> REJ[退件]
  Q --> W[結算 worker]
  W --> DONE([完成])

%% @tip IN 上游每 5 秒推一批,一批最多 500 筆
%%   高峰期常見 2~3 萬筆/分,壅塞先看這裡
%% @tip VAL 驗簽 + 金額範圍 + 重複單號
%% @tip Q Redis Stream,積壓門檻 10k
%% @tip "結算 worker" 消費者群組 settle-cg,失敗會重排(最多 3 次)
%% @tip REJ 退件會回 webhook 給上游,帶 reject_reason`;

/**
 * 程式化提示:與原始碼裡的 `%% @check` 合併,同 target 以這裡為準。
 * 這則示範「host 想補一個原始碼沒寫的節點」。
 */
const EXTRA_CHECKS: DiagramCheck[] = [
  // 同一節點兩則「未命名」check —— 回歸樣本:兩者的標題都會被 annotateChecks 填成同一個節點標籤,
  // 若卡片以 target+title 當 React key 就會撞號(複製鈕狀態會串到別張卡片)。角標應顯示「2」。
  {
    target: 'CASE_B',
    severity: 'warn',
    desc: '第一則：先確認三方是否真的沒送，而不是我方沒收。',
    snippets: [{ lang: 'sql', code: 'SELECT 1 AS first_check;' }],
  },
  {
    target: 'CASE_B',
    severity: 'error',
    desc: '第二則：補單 API 因三方 × 產品而異，不可一律套用。',
    snippets: [{ lang: 'sql', code: 'SELECT 2 AS second_check;' }],
  },
  {
    target: 'Q4',
    severity: 'warn',
    title: '上游到底有沒有送結算？',
    desc: '欄位名各家不同，先查 COLUMNS 再決定用哪個欄位比對。',
    steps: ['先確認實體表名（含 _old / _Bak* / _YYYYMM 分表）', '再比對 Stake 有無配到 Payout'],
    snippets: [
      {
        lang: 'sql',
        code: [
          "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS",
          "WHERE TABLE_NAME LIKE 'TpWager\\_%' ORDER BY TABLE_NAME;",
        ].join('\n'),
      },
    ],
  },
];

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

      <section>
        <h2>3) 檢查提示（異常時怎麼查）+ 長標籤回歸樣本</h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 8px' }}>
          節點右上角有色標＝該步驟掛了檢查提示，點開可看排查步驟、複製 SQL、開 Kibana。
          <br />
          鍵盤：<code>H</code> 開關角標、<code>C</code> 開關檢查清單、<code>Esc</code> 逐層收合。
          <br />
          （這張圖同時是標籤裁字的回歸樣本：在 Windows 100% / 125% / 150% 縮放下標籤都要完整。）
        </p>
        <div style={{ height: 620 }}>
          <MermaidViewer
            code={UNSETTLED_TREE}
            theme="auto"
            pattern="none"
            checks={EXTRA_CHECKS}
            // 已知 data view UUID 時可直接產 Kibana 連結，不需要後端。
            elk={{
              kibanaHost: 'https://kibana.example.com',
              dataViewId: '00000000-0000-0000-0000-000000000000',
              timeFrom: 'now-24h',
              timeTo: 'now',
            }}
            onCheckSelect={(check) => console.log('[example] 開啟檢查提示', check.target)}
          />
        </div>
      </section>

      <section>
        <h2>4) 懸停提示（滑鼠停在節點上看說明）</h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 8px' }}>
          <code>%% @tip 節點id 說明文字</code> 寫在 mermaid 原始碼裡即可；也可用{' '}
          <code>tips</code> prop 程式化補充（同 target 以 prop 為準）。
          <br />
          這張圖另開了 <code>tipFallbackLabel</code>：沒寫 @tip 的節點（如「退件」以外的節點）
          懸停會退回顯示完整節點文字 + id，長標籤被縮圖擠到難讀時特別有用。
        </p>
        <div style={{ height: 380 }}>
          <MermaidViewer
            code={PIPELINE_WITH_TIPS}
            theme={theme}
            pattern="none"
            tipFallbackLabel
            // 程式化補充/覆寫:DONE 在原始碼裡沒寫 @tip,由 host 補上。
            tips={{ DONE: '結算完成後 5 分鐘內對帳,對不平會進人工覆核' }}
          />
        </div>
      </section>
    </main>
  );
}
