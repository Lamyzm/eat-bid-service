/** @module 책임: 시장 자리 화면이 계약 값(품목 칸·사유·상태·거절·기간)을 운영자가 읽는 한국어와 KST 날짜로 옮기는 규칙을 소유한다. */
import { Temporal } from '@eatbid/domain';
import type {
  MarketSeatItem,
  MarketSeatReason,
  MarketSeatRejection,
  OperatorMarketSeat
} from '@/api/operator';

const KST = 'Asia/Seoul';

export const REASON_OPTIONS: ReadonlyArray<{ readonly value: MarketSeatReason; readonly label: string }> = [
  { value: 'pilot', label: '시범' },
  { value: 'payment-confirmed', label: '입금 확인' },
  { value: 'operator-correction', label: '운영 정정' },
  { value: 'refund-request', label: '환불 요청' },
  { value: 'other', label: '기타 (메모 필수)' }
];

export function reasonText(reason: MarketSeatReason): string {
  return REASON_OPTIONS.find((option) => option.value === reason)?.label.replace(' (메모 필수)', '') ?? reason;
}

/** "품목 제한 없음"은 학교가 주요 취급 품목으로 참가를 제한하지 않은 공고다(ADR 0072). 품목 이름처럼 보이지 않게 말을 고정한다. */
export const NO_RESTRICTION_TEXT = '품목 제한 없음';

export function itemText(item: MarketSeatItem): string {
  return item.kind === 'atom' ? item.atom : NO_RESTRICTION_TEXT;
}

export function regionText(region: OperatorMarketSeat['region']): string {
  // 라벨이 관측되지 않은 지역 코드가 실제로 있다. 코드를 그대로 보여 운영자가 eaT에서 찾을 수 있게 한다.
  return region.label ?? `지역 코드 ${region.code}`;
}

export function marketText(seat: Pick<OperatorMarketSeat, 'region' | 'item'>): string {
  return `${regionText(seat.region)} · ${itemText(seat.item)}`;
}

/** 사업자번호는 운영자 화면에서 항상 전체로 보인다. 읽기 쉽게 3-2-5로 끊는다. */
export function businessNumberText(number: string): string {
  return `${number.slice(0, 3)}-${number.slice(3, 5)}-${number.slice(5)}`;
}

export function todayInKst(now: Temporal.Instant): Temporal.PlainDate {
  return now.toZonedDateTimeISO(KST).toPlainDate();
}

/** 끝은 반열림 구간의 끝이라 "끝나는 날"은 그 직전 KST 날짜다. 끝이 0시가 아니면(회수로 잘림) 그날이다. */
export function lastDayOf(endsAt: string): Temporal.PlainDate {
  const end = Temporal.Instant.from(endsAt).toZonedDateTimeISO(KST);
  const midnight = end.hour === 0 && end.minute === 0 && end.second === 0 && end.millisecond === 0;
  return midnight ? end.toPlainDate().subtract({ days: 1 }) : end.toPlainDate();
}

/** 주기 폼의 미리보기다. 서버 규칙(시작일 + 개월 수의 0시가 끝)과 같은 계산을 날짜로만 보인다. */
export function grantLastDay(startDate: Temporal.PlainDate, months: number): Temporal.PlainDate {
  return startDate.add({ months }).subtract({ days: 1 });
}

export function dateText(date: Temporal.PlainDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function instantText(value: string): string {
  const time = Temporal.Instant.from(value).toZonedDateTimeISO(KST);
  return `${dateText(time.toPlainDate())} ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export type SeatStanding = 'upcoming' | 'active' | 'ended';

export function seatStanding(seat: Pick<OperatorMarketSeat, 'startsAt' | 'endsAt'>, now: Temporal.Instant): SeatStanding {
  if (Temporal.Instant.compare(Temporal.Instant.from(seat.endsAt), now) <= 0) return 'ended';
  if (Temporal.Instant.compare(Temporal.Instant.from(seat.startsAt), now) > 0) return 'upcoming';
  return 'active';
}

export function standingText(standing: SeatStanding, seat: Pick<OperatorMarketSeat, 'endsAt'>, now: Temporal.Instant): string {
  if (standing === 'ended') return '끝남';
  if (standing === 'upcoming') return '시작 전';
  const days = remainingDays(seat, now);
  if (days <= 7) return `곧 끝남 · ${days}일 남음`;
  return days <= 14 ? `쓰는 중 · ${days}일 남음` : '쓰는 중';
}

/** 끝나는 날을 포함해 남은 KST 날 수다. 오늘 끝나면 1이다. */
export function remainingDays(seat: Pick<OperatorMarketSeat, 'endsAt'>, now: Temporal.Instant): number {
  return todayInKst(now).until(lastDayOf(seat.endsAt), { largestUnit: 'days' }).days + 1;
}

/** 쓰는 중·시작 전 자리를 끝나는 날 순으로 먼저, 끝난 자리를 뒤에 둔다. 운영자가 손댈 자리가 위에 온다. */
export function seatOrder(now: Temporal.Instant): (left: OperatorMarketSeat, right: OperatorMarketSeat) => number {
  return (left, right) => {
    const leftEnded = seatStanding(left, now) === 'ended';
    const rightEnded = seatStanding(right, now) === 'ended';
    if (leftEnded !== rightEnded) return leftEnded ? 1 : -1;
    const byEnd = Temporal.Instant.compare(Temporal.Instant.from(left.endsAt), Temporal.Instant.from(right.endsAt));
    return leftEnded ? -byEnd : byEnd;
  };
}

/** 저장하지 못한 이유를 운영자가 할 일과 함께 말한다. 거절 종류마다 다음 행동이 다르다. */
export function rejectionText(rejection: MarketSeatRejection): string {
  switch (rejection.reason) {
    case 'period-overlap':
      return `기간이 겹칩니다. 이 시장은 ${rejection.holder.name} 업체가 ${dateText(lastDayOf(rejection.holderEndsAt))}까지 씁니다. 그다음 날부터로 바꿔 주세요.`;
    case 'business-claimed-elsewhere':
      return `${rejection.holder.name} 업체가 이 사업자번호(${businessNumberText(rejection.businessNumber)})로 이미 자리를 받았습니다. 한 업체는 한 계정으로만 자리를 받습니다. 그쪽 자리를 먼저 정리해 주세요.`;
    case 'no-registered-business':
      return '이 업체에 등록된 사업자번호가 없습니다. 사업자번호를 등록한 뒤 다시 주세요.';
    case 'item-not-observed':
      return '"품목 제한 없음" 공고가 아직 수집되지 않았습니다. 다음 정시 수집 뒤 다시 주세요.';
    case 'region-not-eligibility-area':
      return '고른 지역이 eaT 참가제한지역이 아닙니다. 지역을 다시 골라 주세요.';
    case 'start-in-past':
      return '시작일이 지났습니다. 오늘이나 그 뒤 날짜를 골라 주세요.';
    case 'seat-ended':
      return '이미 끝난 자리입니다. 새로 주세요.';
    case 'memo-required':
      return '사유가 기타이면 메모를 적어 주세요.';
  }
}
