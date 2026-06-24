// Timeline(時間軸)結構化模型 + 雙向 round-trip(純函式、零 DOM)。
//
// timeline 不是「拖拉繪製」圖,而是 section → time-period → events 的表格式資料。
// 故用 form 編輯器(本模型)而非畫布 adapter。語法:
//
//   ---
//   title: 圖表中繼標題          ← frontmatter(逐字保留)
//   ---
//   timeline
//       title 顯示標題           ← chart title
//       section 2025            ← 區段(可省略 → 視為無名區段)
//           Q1 : 事件A : 事件B   ← time-period 與其事件(冒號分隔)
//           Q3 : 事件C
//              : 事件D           ← 以冒號開頭 = 延續上一個 period 的事件
//
// 設計:解析永遠成功並降級(保留原文於 raw),序列化永遠輸出合法 mermaid。

export interface TimelinePeriod {
  /** 時間點文字,如 "Q1" / "2025-07"。 */
  period: string;
  /** 此時間點發生的事件(可 0..n)。 */
  events: string[];
}

export interface TimelineSection {
  /** 區段名稱;null = 區段前(無名)的時間點。 */
  name: string | null;
  periods: TimelinePeriod[];
}

export interface TimelineModel {
  /** 逐字保留的 YAML frontmatter(含 --- 標記),無則 undefined。 */
  frontmatter?: string;
  /** `title X` 顯示標題。 */
  title?: string;
  sections: TimelineSection[];
  /** 解析無法辨識為合法 timeline 時的完整原文(降級防覆寫用)。 */
  raw?: string;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** 空白模型(新建時的起手骨架)。 */
export function emptyTimelineModel(): TimelineModel {
  return {
    title: '時間軸標題',
    sections: [{ name: '區段一', periods: [{ period: '時間點', events: ['事件'] }] }],
  };
}

/** mermaid timeline 文字 → 結構化模型。永不拋例外;無法解析時於 raw 保留原文。 */
export function parseTimeline(text: string): TimelineModel {
  const original = text;
  // 抽出開頭 frontmatter(逐字保留含 --- 標記),其餘為 body。
  let frontmatter: string | undefined;
  let body = text;
  const fm = text.match(FRONTMATTER_RE);
  if (fm) {
    frontmatter = fm[0].replace(/\r?\n$/, '');
    body = text.slice(fm[0].length);
  }

  let title: string | undefined;
  const sections: TimelineSection[] = [];
  let cur: TimelineSection | null = null;
  let sawTimeline = false;

  const ensureSection = (): TimelineSection => {
    if (!cur) {
      cur = { name: null, periods: [] };
      sections.push(cur);
    }
    return cur;
  };

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('%%')) continue; // 註解 / init
    if (!sawTimeline) {
      // 第一個有意義 token 必須是 timeline,否則整段視為非 timeline(降級)。
      if (/^timeline\b/i.test(line)) {
        sawTimeline = true;
        continue;
      }
      // 不是 timeline 開頭 → 整段保留原文降級。
      return { frontmatter, title: undefined, sections: [], raw: original };
    }
    // chart title:`title <text>`(無冒號才當標題,避免吃掉名為 "title" 的時間點)。
    const tm = line.match(/^title\s+(.+)$/i);
    if (tm && !line.includes(':')) {
      title = tm[1].trim();
      continue;
    }
    // section:`section <name>`。
    const sm = line.match(/^section\s+(.+)$/i);
    if (sm) {
      cur = { name: sm[1].trim(), periods: [] };
      sections.push(cur);
      continue;
    }
    // 以冒號開頭 = 延續上一個 period 的事件。
    if (line.startsWith(':')) {
      const events = line
        .split(':')
        .slice(1)
        .map((s) => s.trim())
        .filter(Boolean);
      const sec = ensureSection();
      const last = sec.periods[sec.periods.length - 1];
      if (last) last.events.push(...events);
      else sec.periods.push({ period: '', events });
      continue;
    }
    // 一般時間點:`period : event1 : event2 ...`。
    const parts = line.split(':').map((s) => s.trim());
    const period = parts[0];
    const events = parts.slice(1).filter(Boolean);
    ensureSection().periods.push({ period, events });
  }

  // 完全沒有內容(只有 timeline 關鍵字)→ 視為空模型(可編輯),非降級。
  return { frontmatter, title, sections };
}

/** 結構化模型 → mermaid timeline 文字。純函式、永遠合法。 */
export function serializeTimeline(model: TimelineModel): string {
  // 降級:解析失敗保留的原文逐字回吐,避免覆寫使用者資料。
  if (model.raw && model.sections.length === 0 && !model.title) {
    return model.raw;
  }
  const lines: string[] = [];
  if (model.frontmatter) lines.push(model.frontmatter);
  lines.push('timeline');
  if (model.title && model.title.trim()) lines.push(`    title ${model.title.trim()}`);
  for (const section of model.sections) {
    const named = section.name !== null && section.name !== undefined;
    if (named) lines.push(`    section ${section.name}`);
    const indent = named ? '        ' : '    ';
    for (const p of section.periods) {
      const cells = [p.period, ...p.events.filter((e) => e.trim())];
      // 全空的時間點略過(避免輸出空行 / 非法 period)。
      if (cells.every((c) => !c.trim())) continue;
      lines.push(indent + cells.map((c) => c.trim()).join(' : '));
    }
  }
  return lines.join('\n') + '\n';
}
