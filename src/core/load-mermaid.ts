// 「載入外部 mermaid」解析器。
// 解析順序:(a) 注入實例 > (b) peer 動態 import('mermaid') > (c) CDN ESM import。
// 模組級 memoize,讓笨重的 mermaid 模組整頁只載入一次。
// 全程無頂層 DOM 存取,SSR 安全(快取初始為 null)。

import { assertBrowser } from '../env';
import type { LoadMermaidOptions, MermaidLike } from '../types';

let cached: Promise<MermaidLike> | null = null;

export function loadMermaid(opts: LoadMermaidOptions = {}): Promise<MermaidLike> {
  const source = opts.source ?? {};

  // (a) 注入實例 — 同步、不觸網、不打包。
  if (source.instance) {
    cached = Promise.resolve(normalize(source.instance));
    return cached;
  }

  if (opts.fresh) {
    cached = null;
  }
  if (cached) {
    return cached;
  }

  cached = resolve(source).catch((err) => {
    cached = null; // 暫時性失敗後允許重試。
    throw err;
  });
  return cached;
}

async function resolve(source: { cdnUrl?: string }): Promise<MermaidLike> {
  // (c) 明確指定 CDN → 直接動態 import 該 ESM 網址,完全不碰 peer 'mermaid'。
  // ignore 註解只加在「執行階段 URL」這條,讓 Vite/webpack 不要嘗試靜態打包它。
  if (source.cdnUrl) {
    assertBrowser('loadMermaid({ cdnUrl })');
    const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ source.cdnUrl)) as {
      default?: MermaidLike;
    };
    return normalize(mod.default ?? (mod as unknown as MermaidLike));
  }
  // (b) peer 動態 import('mermaid')。保留為可被 bundler 解析的 bare specifier,
  // 故 host 安裝了 mermaid 時 Vite/webpack 會正確處理。未安裝則拋出明確指引。
  try {
    const mod = (await import('mermaid')) as { default?: MermaidLike };
    return normalize(mod.default ?? (mod as unknown as MermaidLike));
  } catch (peerErr) {
    throw new Error(
      '[react-super-mermaid] 找不到 mermaid。請安裝 mermaid(peer dependency)、' +
        '傳入 { instance },或傳入 { cdnUrl }。\n' +
        `原始錯誤:${peerErr instanceof Error ? peerErr.message : String(peerErr)}`,
    );
  }
}

function normalize(m: MermaidLike): MermaidLike {
  if (typeof m.render !== 'function' || typeof m.initialize !== 'function') {
    throw new Error('[react-super-mermaid] 解析到的物件不是有效的 mermaid 實例。');
  }
  return m;
}
