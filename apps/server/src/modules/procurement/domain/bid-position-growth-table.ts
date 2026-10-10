/**
 * @module 책임: 마감 전에 본 참여 수를 마감 1시간 전 참여 수로 옮기는 배율 표(하한율·남은 시간·현재 참여 수별)를 선언형으로 소유한다.
 *
 * 값은 2025년까지 하한율 90·88 회차에서 "마감 1시간 전 참여 수 ÷ h시간 전 참여 수"의 중앙값이다
 * (`tools/m1/revalidate-2026-10/position/growth2.py`). 정수 백분의 일 단위로 둬 Number 소수 곱셈을 피한다.
 * 48시간보다 이른 관측은 마지막 줄을 쓴다 — 실험 기록 §13에서 36시간 전에도 두 장 배수가 유지됐다.
 */
import type { ParticipationGrowthTable } from "./bid-position-rule";

export const PARTICIPATION_GROWTH = {
  hourBuckets: [
    { fromHours: 1, toHours: 2 },
    { fromHours: 2, toHours: 4 },
    { fromHours: 4, toHours: 6 },
    { fromHours: 6, toHours: 9 },
    { fromHours: 9, toHours: 12 },
    { fromHours: 12, toHours: 15 },
    { fromHours: 15, toHours: 18 },
    { fromHours: 18, toHours: 21 },
    { fromHours: 21, toHours: 24 },
    { fromHours: 24, toHours: 36 },
    { fromHours: 36, toHours: 48 },
  ],
  countBuckets: [
    { fromBidCount: 1, belowBidCount: 5 },
    { fromBidCount: 5, belowBidCount: 10 },
    { fromBidCount: 10, belowBidCount: 20 },
    { fromBidCount: 20, belowBidCount: 30 },
    { fromBidCount: 30, belowBidCount: 40 },
    { fromBidCount: 40, belowBidCount: 70 },
    { fromBidCount: 70, belowBidCount: null },
  ],
  ratioHundredths: {
    "90.000": [
      [100, 100, 100, 100, 100, 100, 101],  // 1~2시간 전
      [100, 100, 106, 104, 105, 105, 104],  // 2~4시간 전
      [100, 114, 110, 108, 108, 109, 107],  // 4~6시간 전
      [100, 120, 112, 110, 111, 112, 109],  // 6~9시간 전
      [100, 125, 119, 117, 119, 118, 115],  // 9~12시간 전
      [133, 143, 131, 135, 136, 133, 129],  // 12~15시간 전
      [200, 175, 155, 173, 179, 158, 148],  // 15~18시간 전
      [275, 217, 264, 286, 229, 196, 157],  // 18~21시간 전
      [350, 267, 409, 335, 256, 208, 154],  // 21~24시간 전
      [467, 360, 525, 371, 286, 208, 156],  // 24~36시간 전
      [550, 557, 600, 424, 312, 202, 164],  // 36~48시간 전
    ],
    "88.000": [
      [100, 100, 100, 100, 100, 101, 101],  // 1~2시간 전
      [100, 111, 108, 105, 105, 107, 104],  // 2~4시간 전
      [125, 120, 118, 110, 108, 112, 107],  // 4~6시간 전
      [133, 129, 123, 113, 113, 116, 109],  // 6~9시간 전
      [150, 140, 130, 120, 122, 123, 114],  // 9~12시간 전
      [175, 160, 143, 141, 144, 136, 125],  // 12~15시간 전
      [233, 188, 160, 196, 182, 164, 142],  // 15~18시간 전
      [325, 217, 215, 288, 230, 200, 173],  // 18~21시간 전
      [400, 240, 411, 377, 219, 206, 209],  // 21~24시간 전
      [500, 320, 533, 367, 220, 234, 255],  // 24~36시간 전
      [600, 543, 613, 314, 234, 428, 223],  // 36~48시간 전
    ],
  },
} as const satisfies ParticipationGrowthTable;
