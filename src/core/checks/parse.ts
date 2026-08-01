// 從 mermaid 原始碼解析 `%% @check` 檢查提示指令。
//
// 為什麼用 `%%` 註解當載體:`%%` 是 mermaid 各圖型通用的註解語法,AI 產一段 mermaid 就能把提示一起帶出來,
// 消費端(例如 markdown 的 ```mermaid 圍欄)完全不用改。繪圖編輯器的 round-trip 也本來就會保留 `%%` 註解。
//
// 語法(行導向、可容錯):
//
//   %% @check <target> [標題...]
//   %% severity: warn
//   %% desc: 一行說明
//   %% steps:
//   %%   第一步
//   %%   第二步
//   %% sql: |
//   %%   SELECT ...
//   %%   WHERE Id = {TpId};
//   %% link: 標籤 | https://...
//   %% elk: Properties.TransId : "{TransId}"
//
// 保留鍵 = severity / desc / steps / link / match / elk;**其餘任何鍵一律當成可複製片段,鍵名即 lang**
// (`sql:` / `kql:` / `sh:` / `json:` …)—— 未來要加片段型別不必動解析器。

import type { CheckLink, CheckSeverity, CheckSnippet, DiagramCheck } from '../../types';

/** `%% @check` 起始行(允許 `%%@check`,並容忍大小寫)。 */
const CHECK_START_RE = /^@check\b\s*(.*)$/i;

/** `key: value` — key 限英數與 `-` / `_`,避免把圖裡的中文冒號句子誤判成欄位。 */
const FIELD_RE = /^([A-Za-z_][\w-]*)\s*:\s?(.*)$/;

/** 帶引號的 target = 以標籤文字比對(節點 id 不會有空白與中文標點,靠引號區分最直觀)。 */
const QUOTED_TARGET_RE = /^"([^"]+)"\s*(.*)$/;

/** 未加引號的 target:第一個空白前為 id,其餘是標題。 */
const BARE_TARGET_RE = /^(\S+)\s*(.*)$/;

const SEVERITIES = new Set<string>(['info', 'warn', 'error']);

/** 這些鍵有專屬語意,不會被當成程式碼片段。 */
const RESERVED_KEYS = new Set(['severity', 'desc', 'steps', 'link', 'match', 'elk']);

/** 收集多行值時的暫存模式。 */
type PendingMode = 'none' | 'scalar' | 'list';

interface Pending {
  mode: PendingMode;
  key: string;
  lines: string[];
}

interface ScanResult {
  checks: DiagramCheck[];
  /** 屬於指令的行號(0-based)—— 交給 stripCheckDirectives 剔除。 */
  directiveLines: Set<number>;
}

/**
 * 取註解行的內容(去掉開頭 `%%`,保留其後縮排供多行值判斷);非註解行回 undefined。
 * 匯出供 tips/parse 重用 —— 兩種指令共用同一套「什麼是註解 / 什麼是 init 指令」判斷。
 */
export function commentBody(line: string): string | undefined {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith('%%')) {
    return undefined;
  }
  // `%%{ ... }%%` 是 mermaid 的 init / 設定指令,不是一般註解,不能碰。
  if (trimmed.startsWith('%%{')) {
    return undefined;
  }
  // 剝掉 CRLF 殘留的 \r。單行欄位本來就被 trim() 洗掉了,但 block scalar 的續行是逐行原樣收集,
  // 不在這裡剝就會把 \r 夾進多行 SQL —— 而本 workspace 的 .mmd 慣例正是 CRLF,
  // 片段的用途又剛好是貼進 db-kit / qland,帶著看不見的 \r 很難查。
  // 注意:只影響「解析出來的值」;stripCheckDirectives 仍以原始行切 / 接,原始碼的 CRLF 不受影響。
  const body = trimmed.slice(2).replace(/\r$/, '');
  // 只吃掉一個緊鄰的空白,其餘縮排保留(block scalar 靠縮排判斷續行)。
  return body.startsWith(' ') ? body.slice(1) : body;
}

/** 註解內容是否有縮排(= 多行值的續行)。匯出供 tips/parse 重用。 */
export function isIndented(body: string): boolean {
  return /^\s/.test(body);
}

/** `標籤 | https://...` 或純網址。 */
function parseLink(value: string): CheckLink | undefined {
  const [rawLabel, ...rest] = value.split('|');
  if (rest.length > 0) {
    const url = rest.join('|').trim();
    const label = rawLabel.trim();
    return url ? { label: label || url, url } : undefined;
  }
  const url = rawLabel.trim();
  return url ? { label: url, url } : undefined;
}

/** 把收集到的一組欄位值套進 check。 */
function applyField(check: DiagramCheck, key: string, value: string): void {
  const lower = key.toLowerCase();

  if (lower === 'severity') {
    const v = value.trim().toLowerCase();
    if (SEVERITIES.has(v)) {
      check.severity = v as CheckSeverity;
    }
    return;
  }
  if (lower === 'desc') {
    check.desc = value.trim();
    return;
  }
  if (lower === 'match') {
    const v = value.trim().toLowerCase();
    if (v === 'id' || v === 'label') {
      check.match = v;
    }
    return;
  }
  if (lower === 'steps') {
    const steps = value
      .split('\n')
      .map((s) => s.trim().replace(/^[-*]\s*/, ''))
      .filter(Boolean);
    if (steps.length > 0) {
      check.steps = [...(check.steps ?? []), ...steps];
    }
    return;
  }
  if (lower === 'link') {
    const link = parseLink(value);
    if (link) {
      check.links = [...(check.links ?? []), link];
    }
    return;
  }
  if (lower === 'elk') {
    const kql = value.trim();
    if (kql) {
      check.elk = { ...(check.elk ?? {}), kql };
    }
    return;
  }

  // 其餘鍵 → 可複製片段,鍵名即語言。
  const code = value.replace(/\s+$/, '');
  if (code.trim()) {
    const snippet: CheckSnippet = { lang: lower, code };
    check.snippets = [...(check.snippets ?? []), snippet];
  }
}

/** 解析 `@check` 後面那串 → { target, match, title }。 */
function parseHeader(rest: string): Pick<DiagramCheck, 'target' | 'match' | 'title'> | undefined {
  const text = rest.trim();
  if (!text) {
    return undefined;
  }
  const quoted = QUOTED_TARGET_RE.exec(text);
  if (quoted) {
    const title = quoted[2].trim();
    return { target: quoted[1], match: 'label', ...(title ? { title } : {}) };
  }
  const bare = BARE_TARGET_RE.exec(text);
  if (!bare) {
    return undefined;
  }
  const title = bare[2].trim();
  return { target: bare[1], ...(title ? { title } : {}) };
}

/**
 * 單次掃描:同時產出 checks 與「屬於指令的行號」,讓解析與剔除共用同一套判斷,
 * 不會出現「解析得到卻沒剔乾淨」導致 mermaid 收到殘留行的情形。
 */
function scan(code: string): ScanResult {
  const lines = code.split('\n');
  const checks: DiagramCheck[] = [];
  const directiveLines = new Set<number>();

  let current: DiagramCheck | undefined;
  let pending: Pending = { mode: 'none', key: '', lines: [] };

  const flushPending = (): void => {
    if (pending.mode !== 'none' && current) {
      applyField(current, pending.key, pending.lines.join('\n'));
    }
    pending = { mode: 'none', key: '', lines: [] };
  };

  const closeBlock = (): void => {
    flushPending();
    current = undefined;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const body = commentBody(line);

    if (body === undefined) {
      // 空白行不中斷區塊(圖源常在提示之間留空行);真正的語句才結束區塊。
      if (line.trim()) {
        closeBlock();
      }
      continue;
    }

    const start = CHECK_START_RE.exec(body.trim());
    if (start) {
      closeBlock();
      const header = parseHeader(start[1]);
      if (header) {
        current = { ...header };
        checks.push(current);
        directiveLines.add(i);
      }
      continue;
    }

    if (!current) {
      // 與檢查提示無關的一般 `%%` 註解 —— 原樣留給 mermaid(它自己會忽略)。
      continue;
    }

    // 多行值的續行:必須有縮排,否則視為新欄位。
    if (pending.mode !== 'none' && isIndented(body)) {
      pending.lines.push(body.replace(/^\s{1,2}/, ''));
      directiveLines.add(i);
      continue;
    }

    const field = FIELD_RE.exec(body.trim());
    if (!field) {
      // 區塊內無法辨識的行 → 結束這個區塊,把該行還給 mermaid。
      closeBlock();
      continue;
    }

    flushPending();
    directiveLines.add(i);
    const key = field[1];
    const value = field[2];

    if (value.trim() === '|' || value.trim() === '') {
      // `key: |` 或 `steps:` → 後續縮排行為多行值。
      pending = { mode: value.trim() === '|' ? 'scalar' : 'list', key, lines: [] };
      continue;
    }
    applyField(current, key, value);
  }

  closeBlock();
  return { checks, directiveLines };
}

/** 解析原始碼中的 `%% @check` 指令。無指令時回空陣列(零成本)。 */
export function parseChecks(code: string): DiagramCheck[] {
  if (!code.includes('@check')) {
    return [];
  }
  return scan(code).checks;
}

/**
 * 剔除 `%% @check` 指令行,回傳可安全交給 mermaid 的原始碼。
 *
 * mermaid 本來就會忽略 `%%` 註解,但多行 SQL 片段裡可能出現讓 lexer 誤判的字元,
 * 先剔除最保險;也讓 `parse()` 的錯誤訊息行號不被提示內容干擾。
 */
export function stripCheckDirectives(code: string): string {
  if (!code.includes('@check')) {
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
 * 合併兩組 checks:`overrides`(通常來自 prop)覆寫 `base`(通常來自原始碼)中同 target 的項目。
 * target 相同但 base 有多筆時整組被覆寫 —— prop 的語意是「這個節點就用我這份」。
 */
export function mergeChecks(base: DiagramCheck[], overrides?: DiagramCheck[]): DiagramCheck[] {
  if (!overrides || overrides.length === 0) {
    return base;
  }
  const overridden = new Set(overrides.map((c) => c.target));
  return [...base.filter((c) => !overridden.has(c.target)), ...overrides];
}
