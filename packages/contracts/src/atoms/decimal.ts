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

// 공고 하한율은 mart numeric(6,3)의 소수 셋째 자리까지 담는다. 관측 사정률과는 범위가 달라
// 이 atom의 상한을 넓히지 않고 observedBidRateTextSchema를 따로 사용한다(ADR 0040).
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
// (AGENTS 3) 정밀도만 고정하고 100 상한은 두지 않는다. 하한율의 BidRate(0~100)는 별개다.
// 음수도 받는다. 2026-03 창의 명단 3건에서 -2507.667·-3938.779·-9200.855가 관측됐고(EAT-235), 비음수로
// 닫으면 그 6건이 창 전체 16,469건의 발행을 막았다. 값의 뜻(입력 오류인지 정정 표시인지)은 모르며 그
// 판단은 분석 단계가 한다 — 관측을 우리가 만든 값으로 바꾸지 않는다(ADR 0053).
export const observedBidRateTextSchema = z.string()
  .max(17)
  // 부호 있는 0(-0.000)은 canonical이 아니다 — 0의 부호는 없다. lookaround를 쓰지 않는 이유는 이 정규식이
  // 생성된 Python 모델(pydantic의 Rust regex)에도 그대로 실리기 때문이다 — 2026-09-16 smoke에서 lookahead가
  // 모델 로드를 죽였다. 음수 쪽은 "정수부가 0이 아니거나 소수부가 000이 아닌" 경우를 풀어 적는다.
  .regex(/^(?:(?:0|[1-9][0-9]{0,11})\.[0-9]{3}|-(?:[1-9][0-9]{0,11}\.[0-9]{3}|0\.(?:[0-9]{2}[1-9]|[0-9][1-9][0-9]|[1-9][0-9]{2})))$/)
  .meta({
    id: "ObservedBidRateText",
    description: "Source-computed bid-rate percentage-points text with exactly three fractional digits "
      + "and at most twelve integer digits, optionally negative; not capped at 100 because bids above the "
      + "planned price are observed, and negative values are observed too.",
  });

// 투찰률 축이다. 분모가 예정가격인 사정률과 달리 기초금액을 분모로 쓰며, 소스가 관측한 값이 아니라
// `floor_rate × planned_amount / base_amount`로 파생된 값이라 셋째 자리에서 끊으면 그날 하한이
// 이웃 회차와 같은 값으로 뭉개진다. 조사 파일 `design-generators/namsan.json`의 `effFloor`가 소수
// 넷째 자리이고 mart 열도 numeric(9,4)이므로 그 자리를 손실 없이 담는 최소 정밀도를 고정한다.
// 3자리 고정인 `bidRateTextSchema`를 재사용하면 반올림이 계약 경계에서 일어나 화면이 원본과 다른
// 하한을 보게 된다(AGENTS 15).
export const baseRelativeBidRateTextSchema = z.string()
  .max(10)
  .regex(/^(?:0|[1-9][0-9]{0,4})\.[0-9]{4}$/)
  .meta({
    id: "BaseRelativeBidRateText",
    description: "Bid-rate percentage-points text measured against the base amount with exactly four "
      + "fractional digits and at most five integer digits, matching numeric(9,4) mart columns.",
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
