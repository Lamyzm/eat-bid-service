/**
 * @module 책임: 아침 습관 맞춤(같은 날 먼저 개찰된 공고에서 단골 업체가 넣은 자리를 보고 두 장을 고르는 계산)의 방법 상수를
 * 선언형 표로 소유한다.
 *
 * 값은 분석 엔진(`habreal_core.py`, 2026-10-10 재채점)과 같다. 바꾸면 그 채점이 이 계산의 근거가 되지 못하므로, 바꿀 때는
 * `tools/m1/revalidate-2026-10/position/habit_fixture.py`로 fixture를 다시 내고 채점을 다시 한다.
 */
import type { CandidateMultiples } from "./market-position-pick";

const DAY_SECONDS = 86_400;

/**
 * 기간별로 같은 공고에 이번 달 맞춤과 "켜지면 아침 갱신, 아니면 이번 달 맞춤"을 대어 본 기대 낙찰이다(두 장, 예정가격 추첨을
 * 적분해 운을 뺐다). 서버 단골 규칙으로 각 공고의 결정 시각(마감 10분 전)까지 보인 사실만 써서 채점했고, 과거 공개 시각은
 * 2026-09 실수집 패턴을 날짜째 옮겨 붙인 가정이다(반복 6번 평균, 9월은 실측 한 번). 근거는 한 시장(두 사업자가 넣은 하한율
 * 90% 공고)에서만 쟀다(ADR 0067).
 */
export interface MorningHabitEvidence {
  readonly from: string;
  readonly through: string;
  readonly rounds: number;
  readonly expectedWins: string;
  readonly monthlyExpectedWins: string;
}

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
  /**
   * 단골 전국 이력은 시장 창보다 이만큼 더 앞에서부터 읽는다. 창 첫머리 공고에서 "그 전 마지막 자리"를 찾으려면 그 앞 이력이
   * 필요하다. 분석은 2023-10부터 전부 읽었다 — 이 여유로 줄여 읽어도 같은 1,204건 성적이 바뀌지 않는지 재고 정했다(ADR 0067).
   */
  readonly historyMarginSeconds: number;
  /** 근거 성적을 잰 결정 시각(마감 몇 분 전)이다. 화면이 "언제 넣을 때의 성적인지"를 말하는 데 쓴다. */
  readonly validatedLeadMinutes: number;
  readonly evidence: readonly MorningHabitEvidence[];
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
  historyMarginSeconds: 30 * DAY_SECONDS,
  validatedLeadMinutes: 10,
  evidence: [
    { from: "2025-01", through: "2025-12", rounds: 681, expectedWins: "41.5", monthlyExpectedWins: "39.6" },
    { from: "2026-01", through: "2026-08", rounds: 450, expectedWins: "23.3", monthlyExpectedWins: "19.3" },
    { from: "2026-09", through: "2026-09", rounds: 73, expectedWins: "4.1", monthlyExpectedWins: "3.4" },
  ],
} as const satisfies MorningHabitMethod;
