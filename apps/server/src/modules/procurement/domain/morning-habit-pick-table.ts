/**
 * @module 책임: 아침 습관 맞춤(같은 날 먼저 개찰된 공고에서 단골 업체가 넣은 자리를 보고 두 장을 고르는 계산)의 방법 상수를
 * 선언형 표로 소유한다.
 *
 * 값은 분석 엔진(`habreal_core.py`, 2026-10-10 재채점)과 같다. 바꾸면 그 채점이 이 계산의 근거가 되지 못하므로, 바꿀 때는
 * `tools/m1/revalidate-2026-10/position/habit_fixture.py`로 fixture를 다시 내고 채점을 다시 한다.
 */
import type { CandidateMultiples } from "./market-position-pick";

const DAY_SECONDS = 86_400;

export interface MorningHabitMethod {
  readonly version: string;
  readonly floorRate: string;
  /** 참여율·최근 배수·비단골 배치를 보는 창이다. 유지 확률은 이 창의 두 배를 본다. */
  readonly windowSeconds: number;
  /** 두 투찰을 "같은 자리"로 보는 배수 차이의 상한(미만)이다. 투찰률로 약 0.01%p다. */
  readonly keepTolerance: number;
  /** 업체별 유지 확률을 전체 비율 쪽으로 당기는 가상 표본 수다. */
  readonly shrinkWeight: number;
  /** 전체 유지 비율을 믿는 최소 기록 수와, 그보다 적을 때 쓰는 값이다. */
  readonly globalMinimumRecords: number;
  readonly globalFallbackKeepRate: number;
  /** 단골 참여율로 가중한 "오늘 자리가 보인 몫"이 이 값 이상일 때만 이 맞춤을 낸다. */
  readonly coverageThreshold: number;
  /**
   * 과거 회차의 결과가 보이게 된 시각을 개찰 + 이 초로 둔다. 실제 공개 시각은 수집 경로마다 달라 기록이 고르지 않다.
   * 결과 전용 수집 줄(ADR 0064) 뒤의 기대 지연(원천 공개 21~24분)에 맞춘 가정이다.
   */
  readonly trainingVisibilityLagSeconds: number;
  /** 과거 회차의 결정 시각을 마감 − 이 초로 둔다. 유지 확률을 배울 때 그 회차에서 무엇이 보였는지를 이 시각으로 가린다. */
  readonly trainingDecisionLeadSeconds: number;
  readonly candidates: CandidateMultiples;
  /** 예정가격 비율 적분 격자 `[from, below)`이다. 단위 0.0001이며 간격은 0.2(= 0.00002)다. */
  readonly plannedGrid: { readonly fromTenThousandths: number; readonly belowTenThousandths: number; readonly stepTenThousandths: number };
  /** 단골: 결정 시각 전 이 기간 시장 공고의 이 몫 이상에 나온 업체다. 시장 공고가 최소 수보다 적으면 단골을 정하지 않는다. */
  readonly regulars: { readonly lookbackSeconds: number; readonly minimumShare: number; readonly minimumRounds: number };
}

export const MORNING_HABIT_PICK = {
  version: "2026-10-11",
  floorRate: "90.000",
  windowSeconds: 90 * DAY_SECONDS,
  keepTolerance: 1000 / 9e6,
  shrinkWeight: 5,
  globalMinimumRecords: 20,
  globalFallbackKeepRate: 0.3,
  coverageThreshold: 0.3,
  trainingVisibilityLagSeconds: 1200,
  trainingDecisionLeadSeconds: 600,
  // 분석 채점은 0.0001 간격으로 돌렸다(`GRID_STEP=1`). 매달 맞춤과 같은 격자다.
  candidates: { fromTenThousandths: 9800, toTenThousandths: 10040, stepTenThousandths: 1 },
  plannedGrid: { fromTenThousandths: 9700, belowTenThousandths: 10041, stepTenThousandths: 0.2 },
  regulars: { lookbackSeconds: 180 * DAY_SECONDS, minimumShare: 0.3, minimumRounds: 30 },
} as const satisfies MorningHabitMethod;
