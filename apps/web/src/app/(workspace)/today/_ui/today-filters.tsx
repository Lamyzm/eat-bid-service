/** @module 책임: 오늘 화면의 축 줄(지역·품목·금액 버튼과 결과 건수·하한 구성)을 URL 링크로 그리고, 적용된 조건의 해제와 조건 문장을 소유한다. */
import Link from 'next/link';

import {
  buildTodayFilterRoute,
  todaySearchParsers,
  type TodayRoute,
  type TodaySearch
} from '../_lib/today-search-params';
import type { FloorRateSpread } from '../_model/present-open-summary';

const AXIS = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[15px] font-semibold whitespace-nowrap';
const AXIS_OFF = `${AXIS} text-muted-foreground hover:bg-foreground/5`;
const AXIS_ON = `${AXIS} bg-primary/10 text-primary`;

/** 계약의 소수 둘째 자리 고정 형식을 사람이 읽는 천 단위로 되돌린다. 반올림하지 않고 소수부만 뗀다. */
function wonText(amount: string): string {
  return amount.split('.')[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function baseAmountLabel(search: TodaySearch): string | null {
  const { baseAmountMin: min, baseAmountMax: max } = search;
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${wonText(min)}~${wonText(max)}`;
  return min === null ? `${wonText(max!)} 이하` : `${wonText(min)} 이상`;
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
  if (search.items !== null) parts.push(`품목 ${search.items.join(' · ')}`);
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

const AMOUNT_FIELD = 'h-9 w-full rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold tabular-nums';

/**
 * 금액 축이다. **최소·최대 두 칸이고 구간 프리셋 버튼을 만들지 않는다.**
 *
 * `300만`·`1,000만` 같은 경계는 우리가 고르는 값이고, 버튼으로 두면 그 정의를 우리가 소유하게 된다.
 * 양끝이 다 필요한 근거는 실측이다 — 전국 열린 공고 중 3,000만 이상이 28%인데 사용자가 실제로 낸
 * 849건의 최대가 3,292만이라 그 위는 볼 일이 없다(2026-09-13).
 *
 * `details` 안의 GET form이라 이 화면이 server component로 남는다. 두 칸을 채우자고 표 위쪽을 통째로
 * 브라우저로 넘기지 않는다. 지금 걸린 다른 조건은 hidden으로 함께 보내야 금액만 바꿨을 때 나머지가
 * 조용히 풀리지 않는다. cursor는 일부러 빼서 조건이 바뀌면 처음부터 보게 한다.
 */
function AmountAxis({ search }: { readonly search: TodaySearch }) {
  const label = baseAmountLabel(search);
  const carried = (Object.keys(todaySearchParsers) as (keyof TodaySearch)[])
    .filter((key) => key !== 'baseAmountMin' && key !== 'baseAmountMax' && key !== 'cursor')
    .flatMap((key) => {
      const value = search[key];
      return value === null ? [] : [{ key, value }];
    });
  return (
    <details className='relative'>
      <summary className={`${label === null ? AXIS_OFF : AXIS_ON} cursor-pointer list-none`}>
        금액{label === null ? '' : ` · ${label}`} <span aria-hidden>▾</span>
      </summary>
      <form method='get' action='/today' className='absolute top-full left-0 z-10 mt-1 grid w-64 gap-2 rounded-xl border border-border bg-card p-3 shadow-lg'>
        {carried.map(({ key, value }) => <input key={key} type='hidden' name={key} value={String(value)} />)}
        <label className='grid gap-1 text-[13px] font-semibold text-muted-foreground'>
          최소
          <input
            id='today-base-amount-min'
            name='baseAmountMin'
            type='text'
            inputMode='numeric'
            defaultValue={search.baseAmountMin === null ? '' : wonText(search.baseAmountMin)}
            placeholder='제한 없음'
            className={AMOUNT_FIELD}
          />
        </label>
        <label className='grid gap-1 text-[13px] font-semibold text-muted-foreground'>
          최대
          <input
            id='today-base-amount-max'
            name='baseAmountMax'
            type='text'
            inputMode='numeric'
            defaultValue={search.baseAmountMax === null ? '' : wonText(search.baseAmountMax)}
            placeholder='제한 없음'
            className={AMOUNT_FIELD}
          />
        </label>
        <div className='flex gap-1.5'>
          <button type='submit' className='inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground hover:bg-primary/90'>
            적용
          </button>
          {label === null ? null : (
            <Link
              href={buildTodayFilterRoute(search, { baseAmountMin: null, baseAmountMax: null })}
              className='inline-flex h-8 items-center rounded-lg bg-foreground/5 px-3 text-[13px] font-semibold hover:bg-foreground/10'
            >
              해제
            </Link>
          )}
        </div>
      </form>
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
      {search.items !== null ? (
        <AxisChip name='품목' value={search.items.join(' · ')} href={buildTodayFilterRoute(search, { items: null })} />
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
