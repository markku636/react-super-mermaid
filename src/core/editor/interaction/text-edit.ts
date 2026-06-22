// 行內文字編輯:在容器上疊一個絕對定位的 <textarea>,定位到節點螢幕矩形。
// 用真實 DOM 輸入 → 平滑游標 + IME(CJK)友善。Enter 送出、Shift+Enter 換行、Esc 取消。

import { SKETCH_FONT } from '../../themes/sketch';

export interface TextEditScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function openTextEditor(
  container: HTMLElement,
  rect: TextEditScreenRect,
  initial: string,
  onCommit: (value: string) => void,
  onCancel: () => void,
): () => void {
  const ta = document.createElement('textarea');
  ta.value = initial.replace(/<br\s*\/?>/g, '\n');
  ta.setAttribute(
    'style',
    `position:absolute;left:${rect.left}px;top:${rect.top}px;` +
      `width:${Math.max(60, rect.width)}px;height:${Math.max(28, rect.height)}px;` +
      `font:14px/1.25 ${SKETCH_FONT};text-align:center;resize:none;z-index:30;` +
      'box-sizing:border-box;padding:4px 6px;border:2px solid #2563eb;border-radius:6px;' +
      'background:#fff;color:#1e1e1e;outline:none;overflow:hidden;',
  );
  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    const value = ta.value;
    ta.remove();
    if (commit) onCommit(value);
    else onCancel();
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
    e.stopPropagation(); // 不要讓編輯器快捷鍵(刪除等)觸發。
  });
  ta.addEventListener('blur', () => finish(true));
  container.appendChild(ta);
  ta.focus();
  ta.select();
  return () => finish(false);
}
