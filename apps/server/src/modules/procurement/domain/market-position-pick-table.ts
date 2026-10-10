/**
 * @module 책임: 내 시장 맞춤 금액(매달 다시 고르기)의 방법 상수(창 길이·최소 공고 수·후보 배수 격자·하한율)와 표본 밖 채점 근거를 선언형 표로 소유한다.
 *
 * 손으로 고치지 않는다. 근거 숫자는 운영 DB 2024-01~2026-09 등록 사업자 두 곳의 공고 투찰로, 각 공고보다 앞선 기록만 써서
 * 금액을 고른 걸어가기 채점이다(EAT-324·EAT-332, 재현 스크립트 tools/m1/revalidate-2026-10/position/rolling*.py). 창 길이 3개월은
 * 2025년 걸어가기로만 골랐고, 최소 공고 수 70은 검증한 창 가운데 가장 작은 창(73건) 아래를 내지 않으려는 문턱이다. 근거는 한 시장
 * (두 사업자가 넣은 한 참가제한지역의 하한율 90% 공고)에서만 쟀다. 기대 낙찰은 예정가격 추첨을 적분한 두 장 기준 값이고, 전국 규칙은
 * 같은 공고에 2026-10-10판 규칙을, 지금 금액은 두 업체가 실제로 낸 금액을 넣은 값, 운은 2/(경쟁 수 + 2)다.
 */
import type { CandidateMultiples } from "./market-position-pick";

export interface MarketPickEvidence {
  readonly from: string;
  readonly through: string;
  readonly rounds: number;
  readonly expectedWins: string;
  readonly ruleExpectedWins: string;
  readonly currentExpectedWins: string;
  readonly lotteryExpectedWins: string;
}

export interface MarketPositionPickMethod {
  readonly version: string;
  readonly windowMonths: number;
  readonly minimumRounds: number;
  readonly floorRate: string;
  readonly candidates: CandidateMultiples;
  readonly evidence: readonly MarketPickEvidence[];
}

export const MARKET_POSITION_PICK = {
  version: "2026-10-10",
  windowMonths: 3,
  minimumRounds: 70,
  floorRate: "90.000",
  // 0.0001 간격(기초금액 1,000만 원 공고에서 900원)이다. 0.0005 간격은 경쟁 금액 사이 보통 간격(3,578원)보다 거칠어 빈자리를 놓쳤다.
  candidates: { fromTenThousandths: 9800, toTenThousandths: 10040, stepTenThousandths: 1 },
  evidence: [
    { from: "2024-04", through: "2024-12", rounds: 634, expectedWins: "32.7", ruleExpectedWins: "27.6", currentExpectedWins: "21.7", lotteryExpectedWins: "25.7" },
    { from: "2025-01", through: "2025-12", rounds: 681, expectedWins: "39.6", ruleExpectedWins: "34.7", currentExpectedWins: "22.4", lotteryExpectedWins: "26.6" },
    { from: "2026-01", through: "2026-08", rounds: 450, expectedWins: "19.3", ruleExpectedWins: "17.2", currentExpectedWins: "12.0", lotteryExpectedWins: "14.2" },
    // 2026-09는 최신 개정본을 관측 번호 순으로 고른 값이다(개정본 번호 순은 67건으로 덜 셌다, EAT-324).
    { from: "2026-09", through: "2026-09", rounds: 73, expectedWins: "3.4", ruleExpectedWins: "2.4", currentExpectedWins: "1.8", lotteryExpectedWins: "2.2" },
  ],
} as const satisfies MarketPositionPickMethod;
