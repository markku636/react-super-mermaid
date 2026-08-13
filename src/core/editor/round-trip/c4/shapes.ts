// C4 的元素型別 ↔ mermaid 關鍵字對照。
//
// mermaid 的 C4 DB 把型別存成蛇底線小寫(`external_container_db`),但語法關鍵字是駝峰加後綴
// (`ContainerDb_Ext`)。兩邊用規則互轉,而不是列一張 20 幾筆的表 —— 少了任何一筆就會在
// 序列化時默默把型別降級。

import type { NodeShape } from '../../scene/types';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** `external_container_db` → `ContainerDb_Ext`。 */
export function c4Keyword(c4Type: string): string {
  const ext = c4Type.startsWith('external_');
  const base = ext ? c4Type.slice('external_'.length) : c4Type;
  const name = base
    .split('_')
    .map((seg) => (seg === 'db' ? 'Db' : seg === 'queue' ? 'Queue' : cap(seg)))
    .join('');
  return ext ? `${name}_Ext` : name;
}

/** `ContainerDb_Ext` → `external_container_db`(解析器沒給型別時的反推;主要供手寫測試)。 */
export function c4TypeFromKeyword(keyword: string): string {
  const ext = keyword.endsWith('_Ext');
  const name = ext ? keyword.slice(0, -4) : keyword;
  const snake = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return ext ? `external_${snake}` : snake;
}

/** 型別的引數順序:container / component 家族多一個「技術」欄位。 */
export function c4HasTechn(c4Type: string): boolean {
  return /(^|_)(container|component|node)(_|$)/.test(c4Type);
}

/** 型別 → 場景外形(渲染用;細分型別仍存在 data.c4Type)。 */
export function c4Shape(c4Type: string): NodeShape {
  if (c4Type.includes('person')) return 'c4Person';
  if (c4Type.endsWith('_db')) return 'c4Db';
  if (c4Type.endsWith('_queue')) return 'c4Queue';
  return 'c4Box';
}

/** 工具列上的四顆按鈕 → 預設型別(其餘變體由右鍵切換)。 */
export const C4_SHAPE_DEFAULT_TYPE: Partial<Record<NodeShape, string>> = {
  c4Person: 'person',
  c4Box: 'system',
  c4Db: 'system_db',
  c4Queue: 'system_queue',
};

/** 邊界種類 → 關鍵字。 */
export function boundaryKeyword(type: string | undefined): string {
  switch ((type ?? '').toUpperCase()) {
    case 'ENTERPRISE':
      return 'Enterprise_Boundary';
    case 'SYSTEM':
      return 'System_Boundary';
    case 'CONTAINER':
      return 'Container_Boundary';
    case 'NODE':
      return 'Node';
    default:
      return 'Boundary';
  }
}
