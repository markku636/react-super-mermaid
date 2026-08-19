// ORID(焦點討論法)結構化模型 + 雙向 round-trip(純函式、零 DOM)。
//
// ORID 不是 mermaid 原生圖種,而是本專案自訂的第一個「引導式討論」圖表:
// 四個固定階段 Objective(客觀事實)→ Reflective(感受反應)→
// Interpretive(意義詮釋)→ Decisional(決定行動),每階段各是一串條列項目。
// 渲染時由 orid/transpile.ts 轉成原生 flowchart(見該檔),故所有既有能力
// (主題、pan/zoom、搜尋、匯出、check/tip)全部原封不動繼承。
//
// 語法:
//
//   ---
//   title: 中繼標題            ← frontmatter(逐字保留)
//   ---
//   orid
//       title 上線後回顧        ← 圖表顯示標題
//       objective 客觀事實      ← 階段關鍵字 + 選填的自訂段落標題
//           錯誤率 3.2%         ← 項目(縮排;可加 - / * / • 前綴)
//           - 平均延遲 850ms
//       reflective
//           團隊感到焦慮
//       interpretive
//           監控缺口是根因
//       decisional
//           補上告警 @mark 8/25
//
// 設計:解析永遠成功並降級(保留原文於 raw),序列化永遠輸出合法 ORID。

export type OridStageKey = 'objective' | 'reflective' | 'interpretive' | 'decisional';

export interface OridStageSpec {
  key: OridStageKey;
  /** 序列化時輸出的正規關鍵字。 */
  keyword: string;
  /**
   * 解析時可接受的別名(全小寫;含正規關鍵字本身)。
   *
   * 刻意不收單字母縮寫(o / r / i / d):英文項目常以 "I …" 開頭
   * (「I feel anxious about the rollout」),那會被靜靜地當成一個新的
   * Interpretive 階段,把後面的項目全接到錯的段落去。省四個字母不值這個風險。
   */
  aliases: string[];
  /** 圓圈數字序號,渲染段落標題用。 */
  ordinal: string;
  /** 預設段落標題(作者未自訂時使用)。 */
  zh: string;
  en: string;
  /** 一句話說明(hover / 表單提示 / 空欄位 placeholder 共用)。 */
  hint: string;
}

/**
 * 四階段的單一真相。順序即渲染順序 —— 不論作者用什麼順序書寫,
 * 一律以 O → R → I → D 呈現(ORID 的價值就在這個固定推進順序)。
 */
export const ORID_STAGES: readonly OridStageSpec[] = [
  {
    key: 'objective',
    keyword: 'objective',
    aliases: ['objective'],
    ordinal: '①',
    zh: '客觀事實',
    en: 'Objective',
    hint: '看到 / 聽到什麼?只寫可查證的事實與數據,不含評價。',
  },
  {
    key: 'reflective',
    keyword: 'reflective',
    aliases: ['reflective'],
    ordinal: '②',
    zh: '感受反應',
    en: 'Reflective',
    hint: '當下的感覺、直覺反應與情緒,不必先講道理。',
  },
  {
    key: 'interpretive',
    keyword: 'interpretive',
    aliases: ['interpretive'],
    ordinal: '③',
    zh: '意義詮釋',
    en: 'Interpretive',
    hint: '這代表什麼?根因、洞察、學到的事。',
  },
  {
    key: 'decisional',
    keyword: 'decisional',
    aliases: ['decisional'],
    ordinal: '④',
    zh: '決定行動',
    en: 'Decisional',
    hint: '接下來要做什麼?誰負責、何時完成。',
  },
];

const STAGE_BY_ALIAS = new Map<string, OridStageSpec>();
for (const spec of ORID_STAGES) {
  for (const alias of spec.aliases) STAGE_BY_ALIAS.set(alias, spec);
}

/** 由關鍵字(不分大小寫)取階段規格;非階段關鍵字回 undefined。 */
export function oridStageByKeyword(word: string): OridStageSpec | undefined {
  return STAGE_BY_ALIAS.get(word.trim().toLowerCase());
}

export function oridStageSpec(key: OridStageKey): OridStageSpec {
  // key 為聯集型別,查表必中;findIndex 之後的 ! 由型別保證。
  return ORID_STAGES.find((s) => s.key === key) as OridStageSpec;
}

export interface OridStage {
  key: OridStageKey;
  /** 作者自訂的段落標題;未指定 = 渲染時用 `序號 中文 · English`。 */
  heading?: string;
  items: string[];
}

export interface OridModel {
  /** 逐字保留的 YAML frontmatter(含 --- 標記),無則 undefined。 */
  frontmatter?: string;
  /** `title X` 顯示標題。 */
  title?: string;
  /** 作者實際宣告的階段(書寫順序);渲染 / 序列化一律照 ORID_STAGES 正規排序。 */
  stages: OridStage[];
  /** 解析無法辨識為合法 ORID 時的完整原文(降級防覆寫用)。 */
  raw?: string;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
/** 條列項目前綴:- / * / • / ‧ / ・(有前綴就一定是項目,不會被誤判成階段關鍵字)。 */
const BULLET_RE = /^[-*•‧・]\s*/;

/** 空白模型(新建時的起手骨架):四階段齊備,各給一個提示性項目。 */
export function emptyOridModel(): OridModel {
  return {
    title: 'ORID 焦點討論',
    stages: ORID_STAGES.map((spec) => ({ key: spec.key, items: [`（${spec.zh}）`] })),
  };
}

/** 依 ORID 正規順序取出階段;未宣告的階段不補。 */
export function orderedStages(model: OridModel): OridStage[] {
  const out: OridStage[] = [];
  for (const spec of ORID_STAGES) {
    const found = model.stages.find((s) => s.key === spec.key);
    if (found) out.push(found);
  }
  // 保險:理論上 stages 的 key 必在聯集內,萬一有未知 key 也不要吃掉資料。
  for (const s of model.stages) {
    if (!ORID_STAGES.some((spec) => spec.key === s.key)) out.push(s);
  }
  return out;
}

/**
 * 段落標題的顯示文字。序號一律保留 —— 四段的推進順序正是 ORID 的重點,
 * 只有其中一兩段被自訂就少了編號的話,漏斗會讀不出節奏。
 */
export function stageHeading(stage: OridStage): string {
  const spec = oridStageSpec(stage.key);
  const custom = stage.heading?.trim();
  return custom ? `${spec.ordinal} ${custom}` : `${spec.ordinal} ${spec.zh} · ${spec.en}`;
}

/** ORID 文字 → 結構化模型。永不拋例外;無法解析時於 raw 保留原文。 */
export function parseOrid(text: string): OridModel {
  const original = text;
  let frontmatter: string | undefined;
  let body = text;
  const fm = text.match(FRONTMATTER_RE);
  if (fm) {
    frontmatter = fm[0].replace(/\r?\n$/, '');
    body = text.slice(fm[0].length);
  }

  let title: string | undefined;
  const stages: OridStage[] = [];
  let cur: OridStage | null = null;
  let sawOrid = false;

  /** 取得(或建立)目前階段;項目寫在任何階段關鍵字之前時,隱含開啟 objective。 */
  const ensureStage = (): OridStage => {
    if (!cur) {
      cur = { key: 'objective', items: [] };
      stages.push(cur);
    }
    return cur;
  };

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('%%')) continue; // 註解 / init 指令
    if (!sawOrid) {
      // 第一個有意義 token 必須是 orid,否則整段視為非 ORID(降級)。
      if (/^orid\b/i.test(line)) {
        sawOrid = true;
        continue;
      }
      return { frontmatter, stages: [], raw: original };
    }

    // 有 bullet 前綴 → 一定是項目(使用者強制不走關鍵字判定的逃生口)。
    const bullet = line.match(BULLET_RE);
    if (bullet) {
      const value = line.slice(bullet[0].length).trim();
      if (value) ensureStage().items.push(value);
      continue;
    }

    // 首 token 是階段關鍵字 → 開新階段,其餘文字為自訂段落標題。
    const firstSpace = line.search(/\s/);
    const head = firstSpace === -1 ? line : line.slice(0, firstSpace);
    const rest = firstSpace === -1 ? '' : line.slice(firstSpace).trim();
    const spec = oridStageByKeyword(head.replace(/[:：]$/, ''));
    if (spec) {
      // 同一階段重複宣告 → 併入既有階段(不覆蓋已收集的項目)。
      const existing = stages.find((s) => s.key === spec.key);
      cur = existing ?? { key: spec.key, items: [] };
      if (!existing) stages.push(cur);
      if (rest) cur.heading = rest;
      continue;
    }

    // `title X` 顯示標題(必須在任何階段之前;之後出現的視為項目,避免吃掉名為 title 的項目)。
    if (!cur && /^title\s+/i.test(line)) {
      title = line.replace(/^title\s+/i, '').trim();
      continue;
    }

    ensureStage().items.push(line);
  }

  return { frontmatter, title, stages };
}

/**
 * 這個項目重新解析時會被誤讀成別的東西嗎?會的話序列化要補 `- ` 前綴。
 * 三種情況:首字是階段關鍵字(objective / reflective / …)、本來就以 bullet 字元開頭、
 * 或長得像 `title X`。少了這道保護,「objective 這個詞很模糊」這種項目
 * 存檔再開就變成一個新階段,資料就這樣被吃掉了。
 */
function needsBullet(value: string): boolean {
  if (BULLET_RE.test(value)) return true;
  if (/^title\s+/i.test(value)) return true;
  const firstSpace = value.search(/\s/);
  const head = (firstSpace === -1 ? value : value.slice(0, firstSpace)).replace(/[:：]$/, '');
  return oridStageByKeyword(head) !== undefined;
}

/** 結構化模型 → ORID 文字。純函式、永遠合法、階段一律正規排序。 */
export function serializeOrid(model: OridModel): string {
  // 降級:解析失敗保留的原文逐字回吐,避免覆寫使用者資料。
  if (model.raw && model.stages.length === 0 && !model.title) {
    return model.raw;
  }
  const lines: string[] = [];
  if (model.frontmatter) lines.push(model.frontmatter);
  lines.push('orid');
  if (model.title && model.title.trim()) lines.push(`    title ${model.title.trim()}`);
  for (const stage of orderedStages(model)) {
    const spec = oridStageSpec(stage.key);
    const heading = stage.heading && stage.heading.trim() ? ` ${stage.heading.trim()}` : '';
    lines.push(`    ${spec?.keyword ?? stage.key}${heading}`);
    for (const item of stage.items) {
      const value = item.trim();
      if (!value) continue; // 全空項目略過,避免輸出空行
      lines.push(`        ${needsBullet(value) ? `- ${value}` : value}`);
    }
  }
  return lines.join('\n') + '\n';
}
