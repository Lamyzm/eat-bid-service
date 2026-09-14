/** @module 책임: 오늘 화면의 조건 칩(지역·품목·기간·기초금액)을 URL 링크로 그리고, 적용된 조건의 해제 링크와 조건 문장을 소유한다. */
import Link from 'next/link';

import {
  BASE_AMOUNT_PRESETS,
  buildTodayFilterRoute,
  type TodayRoute,
  type TodaySearch
} from '../_lib/today-search-params';

const CHIP = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[15px] font-semibold whitespace-nowrap';
const CHIP_OFF = `${CHIP} bg-foreground/5 text-foreground hover:bg-foreground/10`;
const CHIP_ON = `${CHIP} bg-primary/10 text-primary`;

function Chip({ href, active, children }: { readonly href: TodayRoute; readonly active: boolean; readonly children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? 'true' : undefined} className={active ? CHIP_ON : CHIP_OFF}>
      {children}
    </Link>
  );
}

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
 * 지역·품목 어휘를 내려주는 계약이 아직 없어 두 조건은 표의 행(지역·품목 링크)에서 고른다. 여기서는
 * 적용된 값과 해제만 보인다. 기간·기초금액은 등록된 프리셋이다. 칩을 감싸는 별도 컨테이너를 두지 않는다 —
 * flex-wrap은 직계 자식 단위로만 줄을 바꾼다(EAT-82).
 */
export function TodayFilters({ search, regionText }: { readonly search: TodaySearch; readonly regionText: string | null }) {
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-2'>
      {search.sido !== null ? (
        <Chip href={buildTodayFilterRoute(search, { sido: null })} active>
          지역 {regionText ?? `코드 ${search.sido}`} <span aria-hidden>×</span><span className='sr-only'>지역 조건 해제</span>
        </Chip>
      ) : (
        <span className={`${CHIP} text-muted-foreground`}>지역 전체</span>
      )}
      {search.item !== null ? (
        <Chip href={buildTodayFilterRoute(search, { item: null })} active>
          품목 {search.item} <span aria-hidden>×</span><span className='sr-only'>품목 조건 해제</span>
        </Chip>
      ) : (
        <span className={`${CHIP} text-muted-foreground`}>품목 전체</span>
      )}
      {/* 기간 프리셋 줄은 마감 달력이 대신한다. 둘을 함께 두면 같은 것을 두 방식으로 말하게 되고, 계약이
          시간 창과 달력일을 함께 받지 않아 한쪽을 누르면 다른 쪽이 조용히 풀린다. 달력은 `3일 안` 대신
          그 사흘이 각각 몇 건인지를 보여 주므로 묶음보다 말하는 것이 많다. URL에 남은 값은 칩으로 남겨
          해제할 자리를 준다. */}
      {search.closesWithinHours === null ? null : (
        <Chip href={buildTodayFilterRoute(search, { closesWithinHours: null })} active>
          기간 {search.closesWithinHours}시간 안 <span aria-hidden>×</span><span className='sr-only'>기간 조건 해제</span>
        </Chip>
      )}
      <span className='text-[13px] font-semibold text-muted-foreground'>기초금액</span>
      <Chip href={buildTodayFilterRoute(search, { baseAmountMin: null, baseAmountMax: null })} active={search.baseAmountMin === null && search.baseAmountMax === null}>
        전체
      </Chip>
      {BASE_AMOUNT_PRESETS.map((preset) => (
        <Chip
          key={preset.label}
          href={buildTodayFilterRoute(search, { baseAmountMin: preset.min, baseAmountMax: preset.max })}
          active={search.baseAmountMin === preset.min && search.baseAmountMax === preset.max}
        >
          {preset.label}
        </Chip>
      ))}
    </div>
  );
}
