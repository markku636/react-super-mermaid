// 純 SVG 文字模式(htmlLabels:false)的標籤淨化。
//
// mermaid 開著 htmlLabels(live 檢視)時,標籤交給瀏覽器排版,<b>、<i> 這類行內
// HTML 會真的變粗斜體;關掉 htmlLabels(匯出 pristine 渲染、或 host 強制)時,
// 標籤改用 SVG <text> 畫 —— 只有 <br> 被當斷行,其餘行內標籤一律不解析,
// 原封不動變成可見文字,匯出的 PNG / SVG 上就會出現「<b>」「</b>」字樣。
//
// 送進 mermaid 前先把這類標籤剝掉:標籤內文與 <br> 斷行保留,只有粗斜體等樣式
// 失真(純 SVG 文字本來就表現不了,與 flattenForeignObjects 的既有取捨一致)。
// 必須在 render 前做 —— render 後才改 SVG 文字的話,節點框早已按「含標籤的
// 文字寬度」量好,只會留下一圈空白。

/**
 * htmlLabels:false 下不被解析的行內標籤(開 / 閉 / 自閉合、含屬性都涵蓋)。
 * 刻意不含 <br>(合法斷行)與 <ul>/<li> 等區塊標籤(mermaid 標籤裡幾乎不出現,
 * 且剝掉反而吃掉結構意圖)。
 */
const INLINE_TAG_RE =
  /<\/?(?:strong|small|strike|span|sup|sub|s|big|b|i|em|u|ins|del|code|kbd|mark|font|tt|a|img)(?:\s[^<>]*)?\/?>/gi;

/**
 * 剝除 mermaid 純 SVG 文字模式(htmlLabels:false)無法解析的行內 HTML 標籤,
 * 保留 <br> 斷行與標籤內的文字。供匯出 / pristine 渲染前淨化原始碼。
 */
export function stripHtmlFormattingTags(code: string): string {
  return code.replace(INLINE_TAG_RE, '');
}
