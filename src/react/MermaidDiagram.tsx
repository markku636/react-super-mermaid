import { forwardRef } from 'react';
import { MermaidViewer, type MermaidViewerHandle, type MermaidViewerProps } from './MermaidViewer';

/**
 * 只顯示圖表的便利元件 = <MermaidViewer toolbar={false} />。
 * 仍支援 pan/zoom 與透過 ref 的命令式控制(host 可自建按鈕)。
 */
export const MermaidDiagram = forwardRef<MermaidViewerHandle, Omit<MermaidViewerProps, 'toolbar'>>(
  function MermaidDiagram(props, ref): React.JSX.Element {
    return <MermaidViewer ref={ref} toolbar={false} {...props} />;
  },
);
