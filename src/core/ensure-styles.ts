// 一次性把套件內建 CSS 注入 <head>(以 id 去重)。SSR 安全:非瀏覽器直接略過。

import { RSM_CSS, RSM_STYLE_ID } from './styles.css';

export function ensureStyles(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const existing = document.getElementById(RSM_STYLE_ID) as HTMLStyleElement | null;
  if (existing) {
    // 已注入過:若內容過時(版本升級 / HMR 換 bundle),就刷新——否則舊 CSS 會卡住,
    // 新元件 markup 配舊樣式 → 例如背景彈窗變成行內排版而非浮層。比對成本低(字串相等)。
    if (existing.textContent !== RSM_CSS) {
      existing.textContent = RSM_CSS;
    }
    return;
  }
  const style = document.createElement('style');
  style.id = RSM_STYLE_ID;
  style.textContent = RSM_CSS;
  document.head.appendChild(style);
}
