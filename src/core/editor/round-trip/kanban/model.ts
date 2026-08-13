// 看板的版面 = 通用的直向泳道(與使用者旅程圖共用實作,見 layout/lanes.ts)。

export { LANE, CARD, laneRect, laneIndexAt, laneCardX, bucketByLane, sortedLanes } from '../../layout/lanes';
export { layoutLanes as layoutKanban } from '../../layout/lanes';
