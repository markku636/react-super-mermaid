// Kibana Discover 連結產生器(純函式、零依賴、零網路)。
//
// Discover 的 URL state 是 rison 編碼:`{host}/app/discover#/?_g=<rison>&_a=<rison>`。
// 這裡只做字串組裝 —— data view 的 UUID 必須由呼叫端提供,因為解析它需要 Kibana saved_objects API
// 與一把 ApiKey,那是 host(有後端的那一側)的責任。需要動態解析的情境請改用 `onResolveElkLink`。

import type { CheckElkQuery, ElkLinkConfig } from '../../types';

/** rison 的識別字:符合這個形狀可原樣輸出,否則要用單引號包起來。 */
const RISON_ID_RE = /^[A-Za-z_][A-Za-z0-9_./-]*$/;

const DEFAULT_TIME_FROM = 'now-24h';
const DEFAULT_TIME_TO = 'now';
const TIME_FIELD = '@timestamp';

/** rison 字串值:識別字原樣,其餘單引號包裹並跳脫 `!` 與 `'`(順序不可調換)。 */
function risonString(value: string): string {
  if (value && RISON_ID_RE.test(value)) {
    return value;
  }
  // 套件 target 是 ES2020,沒有 String.replaceAll → 用全域正則達到同樣效果。
  return `'${value.replace(/!/g, '!!').replace(/'/g, "!'")}'`;
}

/** 通用 rison 編碼(物件 / 陣列 / 數字 / 布林 / null)。 */
function risonEncode(value: unknown): string {
  if (value === null || value === undefined) {
    return '!n';
  }
  if (typeof value === 'boolean') {
    return value ? '!t' : '!f';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '!n';
  }
  if (typeof value === 'string') {
    return risonString(value);
  }
  if (Array.isArray(value)) {
    return `!(${value.map(risonEncode).join(',')})`;
  }
  if (typeof value === 'object') {
    const pairs = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${risonString(key)}:${risonEncode(item)}`);
    return `(${pairs.join(',')})`;
  }
  return '!n';
}

/** encodeURIComponent 後要還原的百分比序列 → rison 慣用符號(全部 encode 會讓 Kibana 讀不回來)。 */
const RISON_SAFE: [RegExp, string][] = [
  [/%27/g, "'"],
  [/%28/g, '('],
  [/%29/g, ')'],
  [/%2C/g, ','],
  [/%3A/g, ':'],
  [/%21/g, '!'],
  [/%2A/g, '*'],
  [/%40/g, '@'],
  [/%24/g, '$'],
  [/%7E/g, '~'],
];

/** URL encode,但保留 rison 慣用符號。 */
function risonUrlEncode(rison: string): string {
  let out = encodeURIComponent(rison);
  for (const [pattern, char] of RISON_SAFE) {
    out = out.replace(pattern, char);
  }
  return out;
}

export interface KibanaDiscoverUrlInput {
  /** Kibana 站台網址(尾端斜線可有可無)。 */
  kibanaHost: string;
  /** data view(index pattern)UUID。 */
  dataViewId: string;
  /** KQL 查詢字串。 */
  kql: string;
  /** 時間範圍:絕對 ISO 或相對值(`now-24h`)。 */
  timeFrom?: string;
  timeTo?: string;
  /** Discover 預設顯示欄位。 */
  columns?: string[];
}

/** 組一條 Kibana Discover 連結。 */
export function buildKibanaDiscoverUrl(input: KibanaDiscoverUrlInput): string {
  const host = input.kibanaHost.replace(/\/$/, '');
  const g = risonEncode({
    filters: [],
    refreshInterval: { pause: true, value: 0 },
    time: { from: input.timeFrom ?? DEFAULT_TIME_FROM, to: input.timeTo ?? DEFAULT_TIME_TO },
  });
  const a = risonEncode({
    columns: input.columns ?? [],
    filters: [],
    index: input.dataViewId,
    interval: 'auto',
    query: { language: 'kuery', query: input.kql },
    sort: [[TIME_FIELD, 'desc']],
  });
  return `${host}/app/discover#/?_g=${risonUrlEncode(g)}&_a=${risonUrlEncode(a)}`;
}

/**
 * 用 viewer 的 `elk` 設定把一則提示的查詢條件轉成連結。
 * 設定不全或該提示沒有 KQL 時回 undefined —— 呼叫端據此退化成「複製 KQL」,不顯示死連結。
 */
export function elkLinkFromConfig(
  query: CheckElkQuery | undefined,
  config: ElkLinkConfig | undefined,
): string | undefined {
  if (!query?.kql?.trim() || !config?.kibanaHost || !config?.dataViewId) {
    return undefined;
  }
  return buildKibanaDiscoverUrl({
    kibanaHost: config.kibanaHost,
    dataViewId: config.dataViewId,
    kql: query.kql.trim(),
    timeFrom: config.timeFrom,
    timeTo: config.timeTo,
    columns: config.columns,
  });
}
