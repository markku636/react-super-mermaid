// 把對外的 MermaidTheme 對映成「mermaid base theme + look + 後處理種類」。

import type { MermaidBaseTheme, MermaidTheme } from '../types';

export type PostProcess = 'colorful' | 'sketch' | 'none';

export interface ResolvedTheme {
  base: MermaidBaseTheme;
  look: 'classic' | 'handDrawn';
  postProcess: PostProcess;
}

export function resolveTheme(theme: MermaidTheme, dark: boolean): ResolvedTheme {
  // colorful / sketch / auto 都以 default|dark base 渲染,colorful/sketch 之後再後處理。
  if (theme === 'colorful') {
    return { base: dark ? 'dark' : 'default', look: 'classic', postProcess: 'colorful' };
  }
  if (theme === 'sketch') {
    return { base: dark ? 'dark' : 'default', look: 'handDrawn', postProcess: 'sketch' };
  }
  if (theme === 'auto') {
    return { base: dark ? 'dark' : 'default', look: 'classic', postProcess: 'none' };
  }
  // default / dark / neutral / forest:原生主題直接套用。
  return { base: theme, look: 'classic', postProcess: 'none' };
}
