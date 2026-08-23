// react-super-mermaid/orid 子路徑出口:只有 ORID 的解析 / 序列化 / 轉譯,零依賴、零 DOM。
//
// 存在的理由是體積。自行呼叫 mermaid.render 的 host(VS Code 的預覽 webview、
// Slack 的 harness、Markdown 匯出…)只需要「送進 mermaid 前先轉譯一下」這一件事;
// 從主入口拿會連 React 元件一起吃進去,從 /editor 拿會連整套繪製引擎一起吃進去。
// 這個入口只有幾 KB。
//
// 用法:
//   import { transpileOrid } from 'react-super-mermaid/orid';
//   await mermaid.render(id, transpileOrid(source));   // 非 ORID 原始碼原樣直通

export {
  ORID_STAGES,
  emptyOridModel,
  orderedStages,
  oridStageByKeyword,
  oridStageSpec,
  parseOrid,
  serializeOrid,
  stageHeading,
} from './core/orid/model';
export type { OridModel, OridStage, OridStageKey, OridStageSpec } from './core/orid/model';

export {
  ORID_ITEMS_PER_ROW,
  isOridSource,
  oridItemId,
  oridStageId,
  oridToMermaid,
  transpileOrid,
} from './core/orid/transpile';

export {
  ORID_EMPTY_CLASS,
  ORID_EMPTY_LABEL,
  ORID_ITEM_TEXT,
  ORID_LETTER,
  ORID_PALETTE,
  oridItemClass,
  oridStageClass,
  oridStageFromClassList,
} from './core/orid/theme';
export type { OridPaletteEntry } from './core/orid/theme';

// 非 ORID,但同屬「送進 mermaid 前」的極小前處理(零依賴、零 DOM),一起放在這個
// 輕量入口:host 以 htmlLabels:false 渲染(匯出 pristine SVG)前,先剝掉 mermaid
// 純 SVG 文字模式無法解析的行內 HTML 標籤(<b>、<i>…,保留 <br>),
// 否則標籤會原封不動畫進圖裡。
export { stripHtmlFormattingTags } from './core/strip-html-formatting';
