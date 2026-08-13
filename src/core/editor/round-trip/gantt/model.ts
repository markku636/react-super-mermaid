// 甘特圖的時間 ↔ 座標對映。
//
// 這張圖之所以值得拖:**橫向位置就是日期、寬度就是工期**。所以場景座標是唯一真相,
// 序列化時再把 x / w 換算回日期與 `7d`。垂直位置決定它屬於哪個 section(與看板同一套想法)。
//
// 刻意只支援 `dateFormat YYYY-MM-DD`(壓倒性多數的用法)。遇到別的格式就整份原文回吐 ——
// 半懂不懂地改寫使用者的甘特圖比不能編輯糟糕得多。

export const DAY_W = 26;
export const ROW_H = 34;
export const BAR_H = 22;
export const ORIGIN = { x: 70, y: 96 } as const;
/** section 標題帶的高度(畫在該 section 第一列上方)。 */
export const SECTION_H = 26;

export const SUPPORTED_DATE_FORMAT = 'YYYY-MM-DD';

const MS_PER_DAY = 86400000;

// 一律用**本地**日期欄位:mermaid 內部是用 dayjs 以本地時區解析日期的,拿它給的 Date 去讀
// UTC 欄位,在 UTC+8 會整整差一天(2026-01-01 會被印成 2025-12-31)。

/** `YYYY-MM-DD` → 本地午夜的毫秒;格式不符回 null。 */
export function parseDay(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(t) ? t : null;
}

export function formatDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 加減天數。用日期欄位而不是加毫秒,才不會被日光節約時間差掉一小時而跨錯日。 */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + Math.round(days));
  return d.getTime();
}

/** 兩個時間相差幾天(以本地日界計)。 */
export function diffDays(from: number, to: number): number {
  return Math.round((to - from) / MS_PER_DAY);
}

/** `7d` / `2w` / `12h` → 天數(可為小數);看不懂回 null。 */
export function parseDuration(text: string): number | null {
  const m = /^([0-9.]+)\s*([dwhms]?)$/i.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  switch (m[2].toLowerCase()) {
    case 'w':
      return n * 7;
    case 'h':
      return n / 24;
    case 'm':
      return n / 1440;
    case 's':
      return n / 86400;
    default:
      return n;
  }
}

/** 天數 → 與原本相同單位的字串(原本寫 `2w` 就還你 `2w`,不要無故改寫成 14d)。 */
export function formatDuration(days: number, likeUnit: string): string {
  const unit = /[dwhms]$/i.exec(likeUnit.trim())?.[0]?.toLowerCase() ?? 'd';
  const round = (n: number): string => String(Math.round(n * 100) / 100);
  switch (unit) {
    case 'w':
      return `${round(days / 7)}w`;
    case 'h':
      return `${round(days * 24)}h`;
    case 'm':
      return `${round(days * 1440)}m`;
    case 's':
      return `${round(days * 86400)}s`;
    default:
      return `${round(days)}d`;
  }
}

/** 以圖上最早的日期為原點的座標換算。 */
export interface TimeAxis {
  /** 第 0 天(UTC 毫秒)。 */
  epoch: number;
}

export const dayToX = (axis: TimeAxis, ms: number): number =>
  ORIGIN.x + ((ms - axis.epoch) / MS_PER_DAY) * DAY_W;

export const xToDay = (axis: TimeAxis, x: number): number =>
  addDays(axis.epoch, Math.round((x - ORIGIN.x) / DAY_W));

export const daysToWidth = (days: number): number => Math.max(6, days * DAY_W);
export const widthToDays = (w: number): number => Math.max(0, Math.round(w / DAY_W));

/** 第 i 列的 y(列與列之間不留縫,靠 BAR_H 與 ROW_H 的差當間距)。 */
export const rowY = (i: number): number => ORIGIN.y + i * ROW_H;
/** y → 第幾列(拖到列與列之間時取最近的一列)。 */
export const yToRow = (y: number): number => Math.max(0, Math.round((y - ORIGIN.y) / ROW_H));
