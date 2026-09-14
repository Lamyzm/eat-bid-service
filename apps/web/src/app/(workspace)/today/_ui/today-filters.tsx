/** @module 책임: 오늘 화면의 축 줄(지역·품목·금액 버튼과 결과 건수·하한 구성)을 URL 링크로 그리고, 적용된 조건의 해제와 조건 문장을 소유한다. */
import Link from 'next/link';

import {
  BASE_AMOUNT_PRESETS,
  buildTodayFilterRoute,
  type TodayRoute,
  type TodaySearch
} from '../_lib/today-search-params';
import type { FloorRateSpread } from '../_model/present-open-summary';

const AXIS = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[15px] font-semibold whitespace-nowrap';
const AXIS_OFF = `${AXIS} text-muted-foreground hover:bg-foreground/5`;
const AXIS_ON = `${AXIS} bg-primary/10 text-primary`;

function baseAmountLabel(search: TodaySearch): string | null {
  const preset = BASE_AMOUNT_PRESETS.find((candidate) => candidate.min === search.baseAmountMin && candidate.max === search.baseAmountMax);
  if (preset) return preset.label;
  if (search.baseAmountMin === null && search.baseAmountMax === null) return null;
  return `${search.baseAmountMin ?? ''}~${search.baseAmountMax ?? ''}`;
}

/**
 * 결과 0 상태가 되풀이해 말하는 조건 문장. 조건이 없으면 null이다.
 *
 * 날짜 축 둘을 빠뜨리면 달력에서 0건인 날을 골랐을 때 화면이 `지금 열린 공고가 없습니다`라고만 말하고
 * 해제할 것도 못 내놓는다. 무엇 때문에 0인지를 문장이 말해야 사용자가 되돌릴 자리를 안다.
 */
export function describeTodaySearch(search: TodaySearch, regionText: string | null): string | null {
  const parts: string[] = [];
  if (search.sido !== null) parts.push(`지역 ${regionText ?? `코드 ${search.sido}`}`);
  if (search.item !== null) parts.push(`품목 ${search.item}`);
  if (search.closesOn !== null) parts.push(`마감 ${search.closesOn}`);
  if (search.announcedOn !== null) parts.push(`게시 ${search.announcedOn}`);
  if (search.closesWithinHours !== null) parts.push(`기간 ${search.closesWithinHours}시간 안`);
  const amount = baseAmountLabel(search);
  if (amount !== null) parts.push(`기초금액 ${amount}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * 값이 걸린 축이다. 이름과 값을 한 버튼 안에 함께 두고 누르면 해제한다.
 *
 * 이름과 값을 따로 두지 않는 이유는 축이 셋이기 때문이다. `지역`·`전체`를 나눠 적으면 여섯 조각이
 * 나란히 서서 무엇이 무엇의 값인지 눈이 다시 짝지어야 한다.
 */
function AxisChip({ name, value, href }: { readonly name: string; readonly value: string; readonly href: TodayRoute }) {
  return (
    <Link href={href} aria-current='true' className={AXIS_ON}>
      {name} <span aria-hidden className='text-primary/50'>·</span> {value}
      <span aria-hidden>×</span>
      <span className='sr-only'>{name} 조건 해제</span>
    </Link>
  );
}

/**
 * 금액 축이다. 여는 방식이 `details`인 것은 이 화면이 server component이기 때문이다 — 프리셋 넷을
 * 고르자고 표 위쪽을 통째로 브라우저로 넘기지 않는다.
 *
 * 프리셋을 줄줄이 펼쳐 두지 않는 이유는 축이 셋인데 그중 하나만 다섯 칸을 차지하면 줄이 금액 줄로
 * 보이기 때문이다. 고른 값은 버튼 자리에 그대로 남는다.
 */
function AmountAxis({ search }: { readonly search: TodaySearch }) {
  const label = baseAmountLabel(search);
  return (
    <details className='relative'>
      <summary className={`${label === null ? AXIS_OFF : AXIS_ON} cursor-pointer list-none`}>
        금액{label === null ? '' : ` · ${label}`} <span aria-hidden>▾</span>
      </summary>
      <div className='absolute top-full left-0 z-10 mt-1 grid w-56 gap-0.5 rounded-xl border border-border bg-card p-1 shadow-lg'>
        <Link
          href={buildTodayFilterRoute(search, { baseAmountMin: null, baseAmountMax: null })}
          className={`rounded-lg px-3 py-1.5 text-[15px] font-medium hover:bg-muted ${label === null ? 'text-primary' : ''}`}
        >
          전체
        </Link>
        {BASE_AMOUNT_PRESETS.map((preset) => (
          <Link
            key={preset.label}
            href={buildTodayFilterRoute(search, { baseAmountMin: preset.min, baseAmountMax: preset.max })}
            className={`rounded-lg px-3 py-1.5 text-[15px] font-medium hover:bg-muted ${label === preset.label ? 'text-primary' : ''}`}
          >
            {preset.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

/**
 * 축 줄이다. 왼쪽이 무엇으로 좁혔는지, 오른쪽이 그래서 몇 건인지다.
 *
 * 지역·품목 어휘를 내려주는 계약이 아직 없어 두 축은 값이 걸렸을 때만 버튼이 되고, 값을 고르는 일은
 * 표의 행(지역·품목 링크)이 맡는다. 어휘가 생기면 금액 축과 같은 모양의 목록이 여기 붙는다(EAT-66·100).
 */
export function TodayFilters({
  search,
  regionText,
  totalCount,
  floorSpread
}: {
  readonly search: TodaySearch;
  readonly regionText: string | null;
  /** 조건을 만족하는 전체 건수다. 목록은 `limit`으로 끊기지만 이 수는 안 끊긴다. */
  readonly totalCount: number | null;
  readonly floorSpread: FloorRateSpread | null;
}) {
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
      {search.sido !== null ? (
        <AxisChip name='지역' value={regionText ?? `코드 ${search.sido}`} href={buildTodayFilterRoute(search, { sido: null })} />
      ) : (
        <span className={`${AXIS} text-muted-foreground`}>지역 전체</span>
      )}
      {search.item !== null ? (
        <AxisChip name='품목' value={search.item} href={buildTodayFilterRoute(search, { item: null })} />
      ) : (
        <span className={`${AXIS} text-muted-foreground`}>품목 전체</span>
      )}
      <AmountAxis search={search} />
      {/* 하한은 열이 아니라 이 한 문장이다. 조건 전체를 센 값이라 페이지를 넘겨도 바뀌지 않는다. */}
      <span className='ml-auto flex items-baseline gap-3'>
        {floorSpread === null || floorSpread.axisText === '' ? null : (
          <span className='text-[13px] font-medium text-muted-foreground'>{floorSpread.axisText}</span>
        )}
        {totalCount === null ? null : <span className='text-xl font-bold tabular-nums'>{totalCount}건</span>}
      </span>
    </div>
  );
}
