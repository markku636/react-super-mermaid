// ORID → 原生 mermaid flowchart 轉譯器(純函式、零 DOM)。
//
// ORID 不是 mermaid 的圖種,mermaid 也不認得 `orid` 關鍵字。與其自己畫一套 SVG
// (那會失去主題、pan/zoom、搜尋、匯出、check/tip 全部既有能力),這裡選擇在
// 「送進 mermaid.render 之前」把 ORID 轉成等價的 flowchart:
//
//   - 每個階段 = 一個 subgraph(縱向 TB 依序往下,箭頭串成漏斗)
//   - 階段內 `direction LR` + `~~~` 隱形連線 = 項目排成橫向網格
//   - classDef / class = 四段語意配色(colorful 主題會再依同一組類名重畫,見 themes/colorize)
//
// 轉譯後就是一張普通 flowchart,所以下游一切照舊 —— 這是本功能能「所有地方都支援」的關鍵。

import {
  ORID_STAGES,
  orderedStages,
  oridStageSpec,
  parseOrid,
  stageHeading,
  type OridModel,
  type OridStage,
} from './model';
import {
  ORID_EMPTY_CLASS,
  ORID_EMPTY_LABEL,
  ORID_ITEM_TEXT,
  ORID_LETTER,
  ORID_PALETTE,
  oridItemClass,
  oridStageClass,
} from './theme';

/** 一列最多幾個項目;超過就換列(在 LR 階段內形成網格,避免長條圖橫向爆開)。 */
export const ORID_ITEMS_PER_ROW = 4;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** 首個有意義關鍵字是不是 orid(略過 frontmatter 與 %% 註解)。 */
export function isOridSource(text: string): boolean {
  let src = (text ?? '').trim();
  if (src.startsWith('---')) {
    const end = src.indexOf('\n---', 3);
    if (end !== -1) {
      const after = src.indexOf('\n', end + 1);
      src = after === -1 ? '' : src.slice(after + 1);
    }
  }
  for (const rawLine of src.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('%%')) continue;
    return /^orid\b/i.test(line);
  }
  return false;
}

/** 節點標籤跳脫(對齊 flowchart serializer:雙引號轉實體、換行轉 <br/>)。 */
function escapeLabel(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/\r?\n/g, '<br/>');
}

/** YAML 雙引號字串跳脫(frontmatter title 用)。 */
function yamlQuote(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 產生要放到輸出最前面的 frontmatter。
 * ORID 的 `title` 是圖表標題的單一真相:有寫就取代 frontmatter 既有的 title,
 * 沒寫則原樣沿用作者的 frontmatter(可能本來就有 title)。
 */
function buildFrontmatter(model: OridModel): string | undefined {
  const title = model.title?.trim();
  const existing = model.frontmatter?.match(FRONTMATTER_RE)?.[1];
  if (!title) return model.frontmatter;

  const kept = (existing ?? '')
    .split('\n')
    .filter((line) => !/^\s*title\s*:/.test(line))
    .filter((line, i, arr) => !(line.trim() === '' && i === arr.length - 1));
  const body = [...kept, `title: ${yamlQuote(title)}`].filter((l) => l.trim() !== '').join('\n');
  return `---\n${body}\n---`;
}

/** 階段內的項目 id:O1 / R2 / I3 …(短、好記,方便 %% @tip / @check 指定)。 */
export function oridItemId(stage: OridStage, index: number): string {
  return `${ORID_LETTER[stage.key]}${index + 1}`;
}

/** 階段容器 id:ORID_O / ORID_R / …。 */
export function oridStageId(stage: OridStage): string {
  return `ORID_${ORID_LETTER[stage.key]}`;
}

/** 結構化模型 → mermaid flowchart 原始碼。純函式、永遠輸出合法 mermaid。 */
export function oridToMermaid(model: OridModel): string {
  const stages = orderedStages(model).filter((s) => oridStageSpec(s.key));
  const lines: string[] = [];
  const frontmatter = buildFrontmatter(model);
  if (frontmatter) lines.push(frontmatter);
  lines.push('flowchart TB');

  for (const stage of stages) {
    const stageId = oridStageId(stage);
    lines.push(`    subgraph ${stageId}["${escapeLabel(stageHeading(stage))}"]`);
    lines.push('        direction LR');
    const items = stage.items.map((t) => t.trim()).filter(Boolean);
    if (items.length === 0) {
      // 空階段:給一個虛線佔位塊。留空的 subgraph mermaid 雖然畫得出來,
      // 但會塌成一條沒有意義的細帶,讀者看不出「這段還沒填」。
      lines.push(`        ${ORID_LETTER[stage.key]}0["${ORID_EMPTY_LABEL}"]:::${ORID_EMPTY_CLASS}`);
    } else {
      items.forEach((text, i) => {
        lines.push(
          `        ${oridItemId(stage, i)}["${escapeLabel(text)}"]:::${oridItemClass(stage.key)}`,
        );
      });
      // 每列以隱形連線串起來 → LR 方向排成一橫列;分列則自然疊成網格。
      for (let start = 0; start < items.length; start += ORID_ITEMS_PER_ROW) {
        const row = items
          .slice(start, start + ORID_ITEMS_PER_ROW)
          .map((_, i) => oridItemId(stage, start + i));
        if (row.length > 1) lines.push(`        ${row.join(' ~~~ ')}`);
      }
    }
    lines.push('    end');
  }

  // 階段之間的推進箭頭(漏斗的骨幹)。
  for (let i = 1; i < stages.length; i += 1) {
    lines.push(`    ${oridStageId(stages[i - 1])} --> ${oridStageId(stages[i])}`);
  }

  // 語意配色。colorful 主題會在 SVG 上以同一組類名重畫(見 themes/colorize 的 styleOrid),
  // 這裡的 classDef 則讓 neutral / dark / forest / sketch 等未後處理的主題也有正確顏色。
  for (const spec of ORID_STAGES) {
    if (!stages.some((s) => s.key === spec.key)) continue;
    const p = ORID_PALETTE[spec.key];
    lines.push(
      `    classDef ${oridItemClass(spec.key)} fill:${p.itemFill},stroke:${p.itemStroke},` +
        `stroke-width:1.5px,color:${ORID_ITEM_TEXT}`,
    );
  }
  if (stages.some((s) => s.items.filter((t) => t.trim()).length === 0)) {
    lines.push(
      `    classDef ${ORID_EMPTY_CLASS} fill:transparent,stroke:#94A3B8,stroke-width:1px,` +
        'stroke-dasharray:4 4,color:#94A3B8',
    );
  }
  for (const stage of stages) {
    const p = ORID_PALETTE[stage.key];
    lines.push(
      `    classDef ${oridStageClass(stage.key)} fill:${p.stageFill},stroke:${p.stageStroke},stroke-width:1.5px`,
    );
    lines.push(`    class ${oridStageId(stage)} ${oridStageClass(stage.key)}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * 若 text 是 ORID 就轉成 flowchart,否則原樣回傳。
 * 這是所有渲染路徑(lib 的 render-pipeline、VS Code 各 webview、Slack harness)
 * 唯一需要呼叫的函式 —— 對非 ORID 原始碼是零成本的直通。
 */
export function transpileOrid(text: string): string {
  if (!isOridSource(text)) return text;
  return oridToMermaid(parseOrid(text));
}
