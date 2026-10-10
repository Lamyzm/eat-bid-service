/**
 * @module 책임: 추천 투찰가 규칙 2026-10-10판의 하한율·참여 대역별 배수와 그 근거 수치를 선언형 표로 소유한다.
 *
 * 손으로 고치지 않는다. 실험 기록 `docs/experiments/2026-10-07-bid-position-revalidation.md` §13의 재현 스크립트
 * (`tools/m1/revalidate-2026-10/position/reselect3.py`, `sql/09-september-all-bands-fair.sql`)가 낸 값이고, 표가 바뀌면
 * `version`도 바뀐다. 운 기준선은 규칙의 표가 기존 투찰에 더해진다는 사실에 맞춰 k/(N+k)이다.
 */
import type { BidPositionRuleTable } from "./bid-position-rule";

export const BID_POSITION_RULE = {
  version: "2026-10-10",
  trainedThrough: "2025-12",
  validatedFrom: "2026-01",
  validatedThrough: "2026-08",
  floors: [
    {
      floorRate: "90.000",
      bands: [
        {
          minBidCount: 2,
          maxBidCount: 9,
          evidence: "clear",
          validationRounds: 15523,
          holdout: { month: "2026-09", rounds: 3091, tickets: 2, wins: 1442, lotteryExpectedWins: "1018.5" },
          positions: [
            { multiple: "1.0040", cumulativeWinRate: "27.559106", cumulativeLotteryWinRate: "19.358453", cumulativeValidationWins: 4278 },
            { multiple: "0.9960", cumulativeWinRate: "44.463055", cumulativeLotteryWinRate: "31.723092", cumulativeValidationWins: 6902 },
            { multiple: "1.0000", cumulativeWinRate: "51.497777", cumulativeLotteryWinRate: "40.520729", cumulativeValidationWins: 7994 },
          ],
        },
        {
          minBidCount: 10,
          maxBidCount: 19,
          evidence: "clear",
          validationRounds: 8453,
          holdout: { month: "2026-09", rounds: 1664, tickets: 2, wins: 310, lotteryExpectedWins: "211.9" },
          positions: [
            { multiple: "0.9925", cumulativeWinRate: "11.025671", cumulativeLotteryWinRate: "6.608725", cumulativeValidationWins: 932 },
            { multiple: "1.0000", cumulativeWinRate: "19.129303", cumulativeLotteryWinRate: "12.374864", cumulativeValidationWins: 1617 },
            { multiple: "0.9960", cumulativeWinRate: "25.186324", cumulativeLotteryWinRate: "17.453483", cumulativeValidationWins: 2129 },
          ],
        },
        {
          minBidCount: 20,
          maxBidCount: 29,
          evidence: "clear",
          validationRounds: 2742,
          holdout: { month: "2026-09", rounds: 703, tickets: 2, wins: 82, lotteryExpectedWins: "54.4" },
          positions: [
            { multiple: "0.9925", cumulativeWinRate: "6.637491", cumulativeLotteryWinRate: "3.934761", cumulativeValidationWins: 182 },
            { multiple: "0.9885", cumulativeWinRate: "11.779723", cumulativeLotteryWinRate: "7.566923", cumulativeValidationWins: 323 },
            { multiple: "0.9970", cumulativeWinRate: "16.046681", cumulativeLotteryWinRate: "10.930557", cumulativeValidationWins: 440 },
          ],
        },
        {
          minBidCount: 30,
          maxBidCount: 39,
          evidence: "clear",
          validationRounds: 1445,
          holdout: { month: "2026-09", rounds: 455, tickets: 2, wins: 32, lotteryExpectedWins: "25.1" },
          positions: [
            { multiple: "0.9885", cumulativeWinRate: "4.636678", cumulativeLotteryWinRate: "2.706413", cumulativeValidationWins: 67 },
            { multiple: "0.9935", cumulativeWinRate: "7.266436", cumulativeLotteryWinRate: "5.268689", cumulativeValidationWins: 105 },
            { multiple: "0.9985", cumulativeWinRate: "10.519031", cumulativeLotteryWinRate: "7.698148", cumulativeValidationWins: 152 },
          ],
        },
        {
          minBidCount: 40,
          maxBidCount: 69,
          evidence: "clear",
          validationRounds: 3450,
          holdout: { month: "2026-09", rounds: 851, tickets: 2, wins: 33, lotteryExpectedWins: "31.6" },
          positions: [
            { multiple: "0.9860", cumulativeWinRate: "2.144928", cumulativeLotteryWinRate: "1.755216", cumulativeValidationWins: 74 },
            { multiple: "0.9920", cumulativeWinRate: "4.202899", cumulativeLotteryWinRate: "3.447754", cumulativeValidationWins: 145 },
            { multiple: "0.9955", cumulativeWinRate: "6.289855", cumulativeLotteryWinRate: "5.081017", cumulativeValidationWins: 217 },
          ],
        },
        {
          minBidCount: 70,
          maxBidCount: null,
          evidence: "clear",
          validationRounds: 8004,
          holdout: { month: "2026-09", rounds: 2906, tickets: 2, wins: 65, lotteryExpectedWins: "47.1" },
          positions: [
            { multiple: "0.9835", cumulativeWinRate: "1.374313", cumulativeLotteryWinRate: "0.874334", cumulativeValidationWins: 110 },
            { multiple: "0.9890", cumulativeWinRate: "2.436282", cumulativeLotteryWinRate: "1.731927", cumulativeValidationWins: 195 },
            { multiple: "0.9910", cumulativeWinRate: "3.510745", cumulativeLotteryWinRate: "2.573290", cumulativeValidationWins: 281 },
          ],
        },
      ],
    },
    {
      floorRate: "88.000",
      bands: [
        {
          minBidCount: 2,
          maxBidCount: 9,
          evidence: "clear",
          validationRounds: 7809,
          holdout: { month: "2026-09", rounds: 1289, tickets: 2, wins: 677, lotteryExpectedWins: "381.8" },
          positions: [
            { multiple: "1.0040", cumulativeWinRate: "38.865412", cumulativeLotteryWinRate: "16.778305", cumulativeValidationWins: 3035 },
            { multiple: "0.9960", cumulativeWinRate: "51.274171", cumulativeLotteryWinRate: "28.130587", cumulativeValidationWins: 4004 },
            { multiple: "1.0010", cumulativeWinRate: "57.459342", cumulativeLotteryWinRate: "36.514536", cumulativeValidationWins: 4487 },
          ],
        },
        {
          minBidCount: 10,
          maxBidCount: 19,
          evidence: "clear",
          validationRounds: 5263,
          holdout: { month: "2026-09", rounds: 970, tickets: 2, wins: 295, lotteryExpectedWins: "128.4" },
          positions: [
            { multiple: "0.9960", cumulativeWinRate: "17.309519", cumulativeLotteryWinRate: "6.828141", cumulativeValidationWins: 911 },
            { multiple: "1.0020", cumulativeWinRate: "29.241877", cumulativeLotteryWinRate: "12.753430", cumulativeValidationWins: 1539 },
            { multiple: "0.9920", cumulativeWinRate: "36.367091", cumulativeLotteryWinRate: "17.948489", cumulativeValidationWins: 1914 },
          ],
        },
        {
          minBidCount: 20,
          maxBidCount: 29,
          evidence: "clear",
          validationRounds: 1687,
          holdout: { month: "2026-09", rounds: 343, tickets: 2, wins: 58, lotteryExpectedWins: "27.3" },
          positions: [
            { multiple: "0.9930", cumulativeWinRate: "10.077060", cumulativeLotteryWinRate: "3.992043", cumulativeValidationWins: 170 },
            { multiple: "0.9980", cumulativeWinRate: "14.107884", cumulativeLotteryWinRate: "7.673487", cumulativeValidationWins: 238 },
            { multiple: "0.9905", cumulativeWinRate: "18.968583", cumulativeLotteryWinRate: "11.079626", cumulativeValidationWins: 320 },
          ],
        },
        {
          minBidCount: 30,
          maxBidCount: 39,
          evidence: "weak",
          validationRounds: 489,
          holdout: { month: "2026-09", rounds: 126, tickets: 2, wins: 7, lotteryExpectedWins: "7.1" },
          positions: [
            { multiple: "0.9945", cumulativeWinRate: "4.498978", cumulativeLotteryWinRate: "2.765845", cumulativeValidationWins: 22 },
            { multiple: "0.9980", cumulativeWinRate: "6.748466", cumulativeLotteryWinRate: "5.381176", cumulativeValidationWins: 33 },
            { multiple: "1.0010", cumulativeWinRate: "8.793456", cumulativeLotteryWinRate: "7.858066", cumulativeValidationWins: 43 },
          ],
        },
        {
          minBidCount: 40,
          maxBidCount: 69,
          evidence: "weak",
          validationRounds: 1184,
          holdout: { month: "2026-09", rounds: 295, tickets: 2, wins: 14, lotteryExpectedWins: "10.4" },
          positions: [
            { multiple: "0.9905", cumulativeWinRate: "2.027027", cumulativeLotteryWinRate: "1.763309", cumulativeValidationWins: 24 },
            { multiple: "0.9945", cumulativeWinRate: "3.547297", cumulativeLotteryWinRate: "3.463932", cumulativeValidationWins: 42 },
            { multiple: "0.9850", cumulativeWinRate: "5.067568", cumulativeLotteryWinRate: "5.105231", cumulativeValidationWins: 60 },
          ],
        },
        {
          minBidCount: 70,
          maxBidCount: null,
          evidence: "clear",
          validationRounds: 4005,
          holdout: { month: "2026-09", rounds: 1507, tickets: 2, wins: 31, lotteryExpectedWins: "19.7" },
          positions: [
            { multiple: "0.9855", cumulativeWinRate: "1.498127", cumulativeLotteryWinRate: "0.869949", cumulativeValidationWins: 60 },
            { multiple: "0.9905", cumulativeWinRate: "2.571785", cumulativeLotteryWinRate: "1.723290", cumulativeValidationWins: 103 },
            { multiple: "0.9945", cumulativeWinRate: "3.295880", cumulativeLotteryWinRate: "2.560529", cumulativeValidationWins: 132 },
          ],
        },
      ],
    },
  ],
} as const satisfies BidPositionRuleTable;
