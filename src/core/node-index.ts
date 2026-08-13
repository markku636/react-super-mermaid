// 在已渲染的 mermaid SVG 裡定位「作者在原始碼寫的那個節點」。
//
// 原本只有繪圖編輯器的排版引擎需要這件事(讀 mermaid 算出的座標),現在檢查提示也要(掛角標),
// 故抽成共用模組 —— 兩邊共用同一套 id 還原規則,避免各自維護一份而漂移。

/**
 * mermaid 11 的節點 DOM id 形如 `<renderId>-flowchart-<作者id>-<n>`(例:rsm-1-flowchart-A-0)。
 * 先剝掉已知的 renderId 前綴,再用 `<型別>-<作者id>-<n>` 取出作者 id
 * (作者 id 可含連字號,故用貪婪 `(.+)` 搭配尾端 `-<數字>`)。
 */
const NODE_ID_RE = /^[A-Za-z][\w]*-(.+)-\d+$/;
/**
 * 退路:少了型別那一段的 `<作者id>-<n>`。requirementDiagram 就是這種形狀
 * (`rsm-1-login_req-0`),用嚴格式會還原不出來,整張圖的節點就全部落在原點。
 */
const NODE_ID_RE_LOOSE = /^(.+)-\d+$/;

/** 從節點的 DOM id 還原作者在原始碼寫的 id;取不到回 undefined。 */
export function authorIdFromDomId(domId: string, renderId?: string): string | undefined {
  const prefix = renderId ? `${renderId}-` : '';
  const rest = prefix && domId.startsWith(prefix) ? domId.slice(prefix.length) : domId;
  const m = rest.match(NODE_ID_RE) ?? rest.match(NODE_ID_RE_LOOSE);
  return m ? m[1] : undefined;
}

/** 節點的可見文字(htmlLabels 與純 SVG 文字兩種渲染都涵蓋),用於以標籤比對。 */
export function nodeLabelText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** 可被掛提示的圖形元素層級。順序即優先序:一般節點 → 子圖 / 群組 → 序列圖角色。 */
const TARGETABLE = ['g.node[id]', 'g.cluster[id]', 'g.node', 'g.cluster', '.actor'] as const;

export interface FindNodeOptions {
  /** 本次 render 的 id(mermaid 會把它當 DOM id 前綴)。 */
  renderId?: string;
  /** `id` = 比對作者 id(預設);`label` = 比對節點文字。 */
  match?: 'id' | 'label';
}

/**
 * 依 target 找出圖上的節點元素。
 *
 * `match: 'id'` 先走精準的作者 id 還原;找不到時**退回標籤文字比對** —— 因為不同圖型
 * (序列圖角色、mindmap…)的 DOM id 規則不一致,退路讓提示在那些圖上仍可用。
 */
export function findDiagramNode(
  svg: SVGSVGElement,
  target: string,
  opts: FindNodeOptions = {},
): Element | undefined {
  const wanted = target.trim();
  if (!wanted) {
    return undefined;
  }

  if (opts.match !== 'label') {
    for (const selector of ['g.node[id]', 'g.cluster[id]'] as const) {
      for (const el of Array.from(svg.querySelectorAll(selector))) {
        if (authorIdFromDomId(el.id, opts.renderId) === wanted) {
          return el;
        }
      }
    }
  }

  // 標籤比對:先找完全相同,再退回「包含」(圖上標籤常帶 <br/> 造成多餘空白)。
  const lower = wanted.toLowerCase();
  let loose: Element | undefined;
  for (const selector of TARGETABLE) {
    for (const el of Array.from(svg.querySelectorAll(selector))) {
      const text = nodeLabelText(el).toLowerCase();
      if (!text) {
        continue;
      }
      if (text === lower) {
        return el;
      }
      if (!loose && text.includes(lower)) {
        loose = el;
      }
    }
  }
  return loose;
}
