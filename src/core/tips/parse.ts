// 從 mermaid 原始碼解析 `%% @tip` 懸停提示指令。
//
// 與 `%% @check` 同一個設計哲學:用 `%%` 註解當載體,AI 產一段 mermaid 就能把懸停說明一起帶出來,
// 消費端(markdown 圍欄、round-trip 編輯器)完全不用改。語法刻意比 @check 輕 —— 一則提示就是一段文字:
//
//   %% @tip A 這一步從佇列撈批次,批次大小 500
//   %%   逾時 30s 會整批重排,觀察 requeue_count
//   %% @tip "人工覆核" 只有金額 > 10 萬才會走到這裡
//
// 起始行:`@tip <target> <文字>`;target 帶引號 = 以標籤文字比對(同 @check)。
// 之後的**縮排**註解行是續行,併入同一則(以換行相接);未縮排行結束這一則。

import type { DiagramTip } from '../../types';
import { commentBody, isIndented } from '../checks/parse';

/** `%% @tip` 起始行(允許 `%%@tip`,並容忍大小寫)。 */
const TIP_START_RE = /^@tip\b\s*(.*)$/i;

/** 帶引號的 target = 以標籤文字比對。 */
const QUOTED_TARGET_RE = /^"([^"]+)"\s*(.*)$/;

/** 未加引號的 target:第一個空白前為 id,其餘是提示文字。 */
const BARE_TARGET_RE = /^(\S+)\s*(.*)$/;

interface ScanResult {
  tips: DiagramTip[];
  /** 屬於指令的行號(0-based)—— 交給 stripTipDirectives 剔除。 */
  directiveLines: Set<number>;
}

/** 解析 `@tip` 後面那串 → { target, match, text };無 target 回 undefined。 */
function parseHeader(rest: string): DiagramTip | undefined {
  const text = rest.trim();
  if (!text) {
    return undefined;
  }
  const quoted = QUOTED_TARGET_RE.exec(text);
  if (quoted) {
    return { target: quoted[1], match: 'label', text: quoted[2].trim() };
  }
  const bare = BARE_TARGET_RE.exec(text);
  if (!bare) {
    return undefined;
  }
  return { target: bare[1], text: bare[2].trim() };
}

/**
 * 單次掃描:同時產出 tips 與「屬於指令的行號」—— 解析與剔除共用同一套判斷,
 * 不會出現「解析得到卻沒剔乾淨」的殘留(同 checks/parse 的 scan)。
 */
function scan(code: string): ScanResult {
  const lines = code.split('\n');
  const tips: DiagramTip[] = [];
  const directiveLines = new Set<number>();

  let current: DiagramTip | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const body = commentBody(line);

    if (body === undefined) {
      // 空白行不中斷(圖源常在指令與語句間留空行);真正的語句才結束這一則。
      if (line.trim()) {
        current = undefined;
      }
      continue;
    }

    const start = TIP_START_RE.exec(body.trim());
    if (start) {
      current = parseHeader(start[1]);
      if (current) {
        tips.push(current);
        directiveLines.add(i);
      }
      continue;
    }

    // 縮排的註解行 = 續行;其餘 `%%` 註解與本指令無關,原樣留給 mermaid。
    if (current && isIndented(body)) {
      const cont = body.trim();
      current.text = current.text ? `${current.text}\n${cont}` : cont;
      directiveLines.add(i);
      continue;
    }
    current = undefined;
  }

  // 只有 target 沒有文字的空提示沒東西可顯示,丟掉。
  return { tips: tips.filter((t) => t.text), directiveLines };
}

/** 解析原始碼中的 `%% @tip` 指令。無指令時回空陣列(零成本)。 */
export function parseTips(code: string): DiagramTip[] {
  if (!code.includes('@tip')) {
    return [];
  }
  return scan(code).tips;
}

/**
 * 剔除 `%% @tip` 指令行,回傳可安全交給 mermaid 的原始碼。
 * mermaid 本來就會忽略 `%%` 註解,但剔除可讓 parse 錯誤訊息的行號不被提示內容干擾,
 * 與 stripCheckDirectives 行為一致。
 */
export function stripTipDirectives(code: string): string {
  if (!code.includes('@tip')) {
    return code;
  }
  const { directiveLines } = scan(code);
  if (directiveLines.size === 0) {
    return code;
  }
  return code
    .split('\n')
    .filter((_, i) => !directiveLines.has(i))
    .join('\n');
}

/**
 * 合併兩組 tips:`overrides`(通常來自 prop)覆寫 `base`(通常來自原始碼)中同 target 的項目。
 * 語意同 mergeChecks —— prop 是「這個節點就用我這份」。
 */
export function mergeTips(base: DiagramTip[], overrides?: DiagramTip[]): DiagramTip[] {
  if (!overrides || overrides.length === 0) {
    return base;
  }
  const overridden = new Set(overrides.map((t) => t.target));
  return [...base.filter((t) => !overridden.has(t.target)), ...overrides];
}

/** 把 `tips` prop 的簡寫形(Record<target, text>)正規化成 DiagramTip[]。 */
export function normalizeTips(
  tips: DiagramTip[] | Record<string, string> | undefined,
): DiagramTip[] | undefined {
  if (!tips) {
    return undefined;
  }
  if (Array.isArray(tips)) {
    return tips;
  }
  return Object.entries(tips).map(([target, text]) => ({ target, text }));
}
