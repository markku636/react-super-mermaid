// SSR 安全:本套件可被 Next.js 等 server 端 import,故任何 DOM 存取都必須在
// 執行階段(函式被呼叫時)才發生,且先經過這裡的瀏覽器環境判斷。

export function isBrowser(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

/** 在需要 DOM 的進入點呼叫;非瀏覽器環境拋出明確錯誤而非無聲失敗。 */
export function assertBrowser(api: string): void {
  if (!isBrowser()) {
    throw new Error(`[react-super-mermaid] ${api} 需要瀏覽器 DOM(document / window)。`);
  }
}
