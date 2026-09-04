/** @module 책임: 정체성이 아닌 exact decimal·금액·비율 wire 문자열 atom을 소유한다. */
import { z } from "zod";

export const canonicalDecimalTextSchema = z.string()
  .max(37)
  .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/)
  .meta({
    id: "CanonicalDecimalText",
    description: "Canonical nonnegative decimal text without sign, exponent, or grouping separators.",
  });

export const canonicalMoneyAmountSchema = z.string()
  .max(19)
  .regex(/^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/)
  .meta({
    id: "CanonicalMoneyAmount",
    description: "Canonical nonnegative KRW amount with exactly two fractional digits.",
  });

export const percentagePointsTextSchema = z.string()
  .max(10)
  .regex(/^(?:(?:0|[1-9][0-9]?)\.[0-9]{6}|100\.000000)$/)
  .meta({
    id: "PercentagePointsText",
    description: "Canonical percentage-points text from 0.000000 through 100.000000.",
  });

// eaT 사정률·낙찰률은 소수 셋째 자리까지 관측되며 mart numeric(6,3)과 같다. 6자리 atom으로
// 재사용하면 손실 없는 값도 패턴 불일치로 거부되므로 원본 정밀도를 그대로 담는 atom을 따로 둔다.
export const bidRateTextSchema = z.string()
  .max(7)
  .regex(/^(?:(?:0|[1-9][0-9]?)\.[0-9]{3}|100\.000)$/)
  .meta({
    id: "BidRateText",
    description: "Canonical bid-rate percentage-points text with exactly three fractional digits, "
      + "matching numeric(6,3) mart columns; from 0.000 through 100.000.",
  });

// eaT 사정률(SAJEONG_PCT)은 투찰가를 예정가격으로 나눈 소스 계산값이라 예정가격 초과 투찰이면 100을
// 넘고, 단가 입찰(낙찰 방식 013·014)에서 총액을 넣은 행은 수천만까지 튄다. 2026-09-04 전수 관측
// 238,306건 중 21,339건이 100 초과, 최대 44,477,738.05다. 상한을 두면 관측을 격리하게 되므로
// (AGENTS 3) 정밀도만 고정하고 상한은 두지 않는다. 공개 API의 BidRate(0~100)는 별개다.
export const observedBidRateTextSchema = z.string()
  .max(16)
  .regex(/^(?:0|[1-9][0-9]{0,11})\.[0-9]{3}$/)
  .meta({
    id: "ObservedBidRateText",
    description: "Source-computed bid-rate percentage-points text with exactly three fractional digits "
      + "and at most twelve integer digits; not capped at 100 because bids above the planned price are observed.",
  });

export const ratioTextSchema = z.string()
  .max(8)
  .regex(/^(?:0\.[0-9]{6}|1\.000000)$/)
  .meta({
    id: "RatioText",
    description: "Canonical ratio text from 0.000000 through 1.000000.",
  });

// 복수예정가격 후보의 `CMNM_PLNPRC_RT`는 0~1 비율이 아니라 기초금액 대비 배율이라 1을 넘는다.
// evidence `2026-09-03-bid-roster-in-detail.md` §6의 15행 관측 분포가 0.9701~1.0218이므로
// `ratioTextSchema`를 재사용하면 관측된 후보의 절반이 계약 위반이 된다. 관측을 담을 수 없는 계약은
// 해석 단계에서 추측이나 절단을 부르므로(AGENTS 3) 정수부 한 자리를 허용하는 atom을 따로 둔다.
export const reservePriceRatioTextSchema = z.string()
  .max(8)
  .regex(/^[0-9]\.[0-9]{6}$/)
  .meta({
    id: "ReservePriceRatioText",
    description: "Canonical reserve-price multiplier text from 0.000000 through 9.999999.",
  });
