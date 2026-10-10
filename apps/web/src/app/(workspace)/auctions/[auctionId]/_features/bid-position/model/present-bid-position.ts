/**
 * @module 책임: 추천 투찰가 조회 결과를 금액·근거·보정 상태 문장으로 바꾸는 표시 모델을 소유한다.
 *
 * 금액이 주인공이고 낙찰률은 근거다. 낙찰률은 혼자 두면 크기를 읽을 수 없으므로 언제나 같은 장수를 무작위 자리에
 * 냈을 때의 값과 나란히 쓴다. 고른 뒤 처음 본 달의 결과와 근거가 약한 대역의 경고, 추정한 참여 수를 함께 쓴다(ADR 0062).
 */
import { Temporal } from '@eatbid/domain';
import type { AuctionBidPositionV1Response } from '@eatbid/contracts/api/v1/auctions';

export type BidPositionLoad =
  | { readonly kind: 'position'; readonly response: AuctionBidPositionV1Response }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'failed' };

export type BidPositionRow = {
  readonly label: string;
  readonly amount: string;
  readonly baseRelative: string;
  readonly evidence: string;
};

export type BidPositionView =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'not-applicable';
      readonly inputs: string;
      readonly reason: string;
      readonly rule: string;
    }
  | {
      readonly kind: 'applicable';
      readonly inputs: string;
      readonly band: string;
      readonly basisNote: string | null;
      readonly weakNote: string | null;
      readonly rows: readonly BidPositionRow[];
      readonly calibration: string;
      readonly rule: string;
    };

type Response = AuctionBidPositionV1Response;
type Applicable = Extract<Response['result'], { state: 'applicable' }>;

/** 표시만 묶는다. 금액은 문자열 그대로 자릿수를 끊어 Number 정밀도를 거치지 않는다. */
function wonText(amount: string): string {
  const [whole] = amount.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원';
}

function countText(value: number): string {
  return value.toLocaleString('ko-KR');
}

// web 빌드 대상이 ES2020 미만이라 BigInt 리터럴 대신 생성자로 만든다.
const ZERO = BigInt(0);
const TWO = BigInt(2);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);

/** 소수 문자열을 둘째 자리로 반올림한다. 계약 값은 여섯째 자리까지 정확하므로 문자열 산술로만 줄인다. */
function roundedText(value: string, digits: number): string {
  const [whole, fraction = ''] = value.split('.');
  const scale = fraction.length;
  if (scale <= digits) return `${whole}.${fraction.padEnd(digits, '0')}`;
  const coefficient = BigInt(whole + fraction);
  const divisor = TEN ** BigInt(scale - digits);
  const rounded = ((coefficient * TWO + divisor) / (divisor * TWO))
    .toString()
    .padStart(digits + 1, '0');
  return `${rounded.slice(0, -digits)}.${rounded.slice(-digits)}`;
}

function percentText(value: { readonly value: string }): string {
  return roundedText(value.value, 2) + '%';
}

/** 정수 ÷ 소수 문자열을 소수 둘째 자리 배수로 낸다. */
function multipleText(wins: number, expected: string): string {
  const [whole, fraction = ''] = expected.split('.');
  const denominator = BigInt(whole + fraction);
  if (denominator === ZERO) return '—';
  const numerator = BigInt(wins) * TEN ** BigInt(fraction.length) * HUNDRED;
  const rounded = ((numerator * TWO + denominator) / (denominator * TWO))
    .toString()
    .padStart(3, '0');
  return `${rounded.slice(0, -2)}.${rounded.slice(-2)}배`;
}

function kstText(value: string): string {
  const date = Temporal.Instant.from(value).toZonedDateTimeISO('Asia/Seoul');
  return `${date.month}월 ${date.day}일 ${String(date.hour).padStart(2, '0')}:${String(date.minute).padStart(2, '0')}`;
}

function inputsText(response: Response): string {
  const floor =
    response.floorRate === null
      ? '하한율 미확인'
      : `하한율 ${roundedText(response.floorRate.value, 3).replace(/\.?0+$/, '')}%`;
  const participation =
    response.participation === null
      ? '참여 수 미확인'
      : `참여 ${countText(response.participation.bidCount)}곳(${kstText(response.participation.observedAt)} 관측)`;
  return `기초금액 ${wonText(response.baseAmount.amount)} · ${floor} · ${participation}`;
}

/**
 * 대역을 고른 참여 수가 추정이면 그 사실과 근거를 말한다. 규칙은 마감 1시간 전 참여 수로 표를 정의했으므로 이른 관측은
 * 보정표로 옮긴 값이다. 하루 이상 남은 관측은 추정이 흔들리므로 마감 가까이 다시 보라고 덧붙인다(실험 기록 §13).
 */
function basisText(result: Applicable): string | null {
  const basis = result.bidCountBasis;
  if (basis.kind === 'observed') return null;
  const head =
    `마감 ${basis.hoursBeforeDeadline}시간 전 관측 ${countText(basis.observedBidCount)}곳을 ` +
    `마감 1시간 전 약 ${countText(basis.estimatedBidCount)}곳으로 추정해 표를 골랐습니다.`;
  return basis.hoursBeforeDeadline >= 24
    ? `${head} 마감이 하루 이상 남아 추정이 흔들립니다. 마감 당일에 다시 보세요.`
    : head;
}

function bandText(band: Applicable['band']): string {
  return band.maxBidCount === null
    ? `참여 ${band.minBidCount}곳 이상 표`
    : `참여 ${band.minBidCount}~${band.maxBidCount}곳 표`;
}

function ruleText(response: Response): string {
  const { rule } = response;
  return `규칙 ${rule.version} · 학습 ~${rule.trainedThrough} · 검증 ${rule.validatedFrom}~${rule.validatedThrough} · 금액 = 기초금액 × 하한율 × 배수, 원 단위 올림`;
}

type Reason = Extract<Response['result'], { state: 'not-applicable' }>['reasons'][number];

const REASONS: Record<Reason, string> = {
  'floor-rate-unobserved': '낙찰하한율이 확인되지 않았습니다.',
  'floor-rate-outside-rule': '규칙은 하한율 90%·88% 회차에서만 검증했습니다.',
  'participation-unobserved': '참여 업체 수가 아직 관측되지 않았습니다.',
  'participation-below-rule': '참여가 2곳 미만이라 규칙 표가 없습니다.'
};

function evidenceText(result: Applicable, position: Applicable['positions'][number]): string {
  const span = position.order === 1 ? '1번만' : `1~${position.order}번 함께`;
  return (
    `${span}: 검증 ${countText(result.validationRounds)}회차 중 ${countText(position.cumulativeValidationWins)}회 낙찰` +
    `(${percentText(position.cumulativeWinRate)}) · 무작위 자리 ${percentText(position.cumulativeLotteryWinRate)}`
  );
}

function holdoutText(holdout: Applicable['holdout']): string {
  if (holdout === null) return '';
  return (
    ` 고른 뒤 처음 본 ${holdout.month} ${countText(holdout.rounds)}회차에서 ${holdout.tickets}장은 ` +
    `${countText(holdout.wins)}회 낙찰, 무작위 ${holdout.lotteryExpectedWins}회(${multipleText(holdout.wins, holdout.lotteryExpectedWins)})였습니다.`
  );
}

function calibrationText(response: Response, result: Applicable): string {
  const period = `${response.rule.validatedFrom}~${response.rule.validatedThrough}`;
  const head =
    result.selection === 'training'
      ? `배수는 ~${response.rule.trainedThrough} 자료로만 골랐고 위 낙찰률은 고를 때 보지 않은 ${period} 결과입니다.`
      : `이 표의 배수는 ${period} 성적을 보고 골라 위 낙찰률이 실제보다 높게 나왔을 수 있습니다.`;
  return head + holdoutText(result.holdout);
}

/** 권한이 없으면 패널 자체가 없다(`null`). 조회 실패는 빈 패널이 아니라 실패라고 말한다. */
export function presentBidPosition(load: BidPositionLoad): BidPositionView | null {
  if (load.kind === 'forbidden') return null;
  if (load.kind === 'failed') return { kind: 'unavailable' };
  const { response } = load;
  const { result } = response;
  if (result.state === 'not-applicable') {
    return {
      kind: 'not-applicable',
      inputs: inputsText(response),
      reason: [
        ...result.reasons.map((reason) => REASONS[reason]),
        '이 회차는 계산하지 않았습니다.'
      ].join(' '),
      rule: ruleText(response)
    };
  }
  return {
    kind: 'applicable',
    inputs: inputsText(response),
    band: bandText(result.band),
    basisNote: basisText(result),
    weakNote:
      result.evidence === 'weak'
        ? '이 구간은 표본 밖 성적이 무작위와 뚜렷하게 갈리지 않았습니다. 금액은 참고로만 보세요.'
        : null,
    rows: result.positions.map((position) => ({
      label: `${position.order}번 사업자`,
      amount: wonText(position.amount.amount),
      baseRelative: `기초금액 대비 ${position.baseRelativeRate.value}%`,
      evidence: evidenceText(result, position)
    })),
    calibration: calibrationText(response, result),
    rule: ruleText(response)
  };
}
