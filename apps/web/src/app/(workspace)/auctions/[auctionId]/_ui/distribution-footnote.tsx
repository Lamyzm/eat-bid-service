/** @module 책임: 사다리 아래 각주 한 줄에 모집단·품목·하한율·기간·표본·수집분·계산 버전을 적는다. */
import { Temporal } from '@eatbid/domain';
import type { WinRateDistributionMeta } from '@/api/win-rate-distribution';

import type { DecisionSearch } from '../_lib/decision-search-params';
import { sampleSizeText } from '../_model/sample-size';

function computedAtText(instant: string | null): string | null {
  if (instant === null) return null;
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul');
  return `${zoned.month.toString().padStart(2, '0')}-${zoned.day.toString().padStart(2, '0')} 수집분`;
}

/**
 * 각주는 표본을 응답만으로 재현하게 하는 자리다(AGENTS 7). 계보가 null이면 값을 지어내지 않고 그
 * 조각을 통째로 빼며, `품목 전체`는 분포 mart에 품목 축이 없다는 사실을 화면에서 말하는 자리다.
 */
export function DistributionFootnote({
  meta,
  scope
}: {
  readonly meta: WinRateDistributionMeta;
  readonly scope: DecisionSearch['scope'];
}) {
  const parts = [
    scope,
    '품목 전체',
    `하한율 ${meta.floorRate.value}`,
    `${meta.period.from} ~ ${meta.period.to}`,
    sampleSizeText(meta.sampleCount),
    computedAtText(meta.computedAt),
    meta.calcVersion === null ? null : `계산 ${meta.calcVersion}`
  ].filter((part): part is string => part !== null);

  return (
    <p className='text-[13px] font-medium text-muted-foreground'>
      {parts.join(' · ')}
    </p>
  );
}
