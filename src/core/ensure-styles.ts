// 一次性把套件內建 CSS 注入 <head>(以 id 去重)。SSR 安全:非瀏覽器直接略過。

import { RSM_CSS, RSM_STYLE_ID } from './styles.css';

export function ensureStyles(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(RSM_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = RSM_STYLE_ID;
  style.textContent = RSM_CSS;
  document.head.appendChild(style);
}
