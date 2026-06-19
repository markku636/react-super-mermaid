// svg-pan-zoom 解析器,與 load-mermaid 同模式但為 optional:
// 解析不到(host 未安裝、未提供 CDN)時回傳 null,呼叫端據此略過 pan/zoom,
// render 與後處理仍可正常運作 → 維持「靜態顯示也零相依」。

import { assertBrowser } from '../env';
import type { SvgPanZoomFactory, SvgPanZoomSource } from '../types';

let cached: Promise<SvgPanZoomFactory | null> | null = null;

export function loadSvgPanZoom(source: SvgPanZoomSource = {}): Promise<SvgPanZoomFactory | null> {
  if (source.instance) {
    cached = Promise.resolve(source.instance);
    return cached;
  }
  if (cached) {
    return cached;
  }
  cached = resolve(source).catch(() => {
    cached = null;
    return null; // optional:失敗就當沒有 pan/zoom。
  });
  return cached;
}

async function resolve(source: { cdnUrl?: string }): Promise<SvgPanZoomFactory | null> {
  // CDN 明確指定 → 直接載入該 URL,不碰 peer。
  if (source.cdnUrl) {
    assertBrowser('loadSvgPanZoom({ cdnUrl })');
    const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ source.cdnUrl)) as {
      default?: SvgPanZoomFactory;
    };
    return mod.default ?? (mod as unknown as SvgPanZoomFactory);
  }
  // peer 動態 import('svg-pan-zoom');未安裝則回 null(optional,靜默略過 pan/zoom)。
  try {
    const mod = (await import('svg-pan-zoom')) as { default?: SvgPanZoomFactory };
    return mod.default ?? (mod as unknown as SvgPanZoomFactory);
  } catch {
    return null;
  }
}
