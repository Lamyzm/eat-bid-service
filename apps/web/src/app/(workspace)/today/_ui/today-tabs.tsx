/** @module 책임: 탭 셋과 2주 마감 달력을 각각 링크로 그리고, 못 센 수를 0이 아니라 물음표로, 지나간 칸을 0건이 아니라 지남으로 표시한다. */
import Link from 'next/link';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { CalendarCellPresentation, OpenSummaryPresentation, TabPresentation } from '../_model/present-open-summary';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'] as const;

/**
 * 탭이 고르는 것은 날짜 축이다. 시간 창과 함께 보내면 계약이 400으로 답하므로 탭 링크가 시간 창을 지운다.
 * 세 탭이 서로를 지우는 것도 여기서 한 번에 정해 링크마다 무엇을 남길지 다시 고르지 않게 한다.
 */
function tabRoute(search: TodaySearch, tab: TabPresentation, today: string) {
  const cleared = { closesOn: null, announcedOn: null, closesWithinHours: null };
  if (tab.id === 'live') return buildTodayFilterRoute(search, cleared);
  if (tab.id === 'openedToday') return buildTodayFilterRoute(search, { ...cleared, announcedOn: today });
  return buildTodayFilterRoute(search, { ...cleared, closesOn: today });
}

function TabLink({ tab, href }: { readonly tab: TabPresentation; readonly href: ReturnType<typeof buildTodayFilterRoute> }) {
  return (
    <Link
      href={href}
      aria-current={tab.active ? 'page' : undefined}
      className={`inline-flex items-baseline gap-1.5 whitespace-nowrap ${
        tab.active ? 'text-[17px] font-bold text-foreground' : 'text-[17px] font-semibold text-muted-foreground hover:text-foreground'
      }`}
    >
      {tab.label}
      {/* 셀 수 없었던 수는 0이 아니라 `?`다. 0은 세었는데 없다는 말이라 사용자가 할 일이 다르다. */}
      <span className={`text-[15px] tabular-nums ${tab.count === null ? 'text-muted-foreground' : ''}`}>
        {tab.count === null ? '?' : tab.count}
      </span>
    </Link>
  );
}

/**
 * 달력 칸 하나다. 날짜가 왼쪽 위, 건수가 그 아래다.
 *
 * 가운데 정렬하지 않는 이유는 두 값의 자릿수가 다르기 때문이다. `7`과 `132`를 각각 가운데에 두면 두 줄이
 * 서로 어긋나 칸마다 다른 자리에서 시작한다. 왼쪽에 맞추면 열네 칸의 눈금이 하나로 선다.
 *
 * 색 농도는 건수를 견준 것이고 수는 언제나 함께 적는다 — 농도만으로는 12건과 23건이 같은 칸으로 보이고,
 * 색을 못 보는 사용자에게는 아무 말도 하지 않는다.
 */
function CalendarCell({
  cell,
  search
}: {
  readonly cell: CalendarCellPresentation;
  readonly search: TodaySearch;
}) {
  const base = 'grid h-12 content-center gap-0.5 rounded-md px-2 text-[13px] font-semibold tabular-nums';
  if (cell.tone === 'past') {
    // 지나간 날은 0건이 아니다. 열린 공고만 세는 목록에서 어제의 0은 세어 본 결과가 아니라 질문 밖이다.
    return (
      <span className={`${base} text-muted-foreground/40`} aria-hidden>
        <span>{cell.dayText}</span>
        <span className='font-medium'>지남</span>
      </span>
    );
  }
  const filled = cell.tone === 'today' || cell.weight > 0;
  return (
    <Link
      href={buildTodayFilterRoute(search, {
        closesOn: cell.selected ? null : cell.date,
        announcedOn: null,
        closesWithinHours: null
      })}
      aria-label={`${cell.date} ${cell.count}건`}
      aria-current={cell.selected ? 'date' : undefined}
      className={`${base} ring-inset ${cell.selected ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-border'} ${
        cell.tone === 'today' ? 'bg-primary text-primary-foreground' : filled ? '' : 'hover:bg-muted/60'
      }`}
      // 농도는 창 안 최댓값을 분모로 한 비율이라 한산한 주와 바쁜 주가 같은 눈금 위에 있지 않다.
      // 색은 그 주 안에서의 상대 크기만 말하고 절대 수는 칸의 숫자가 말한다.
      style={cell.tone === 'today' || cell.weight === 0
        ? undefined
        : { backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(10 + cell.weight * 42)}%, transparent)` }}
    >
      <span className={cell.tone === 'today' ? '' : 'text-muted-foreground'}>{cell.dayText}</span>
      <span className={cell.tone === 'today' ? '' : cell.count === 0 ? 'text-muted-foreground/50' : 'text-foreground'}>{cell.count}</span>
    </Link>
  );
}

/**
 * 탭 줄이다. **필터(축 줄)보다 위**에 있어야 한다 — 필터는 부가 설정이 아니라 지금 화면의 모든 숫자가
 * 어떤 집합을 세는지 선언하는 첫 reading group이고, 그 선언은 탭이 고른 판 안에서 읽힌다
 * (screen-system §6.4.1).
 */
export function TodayTabs({
  summary,
  search,
  today
}: {
  readonly summary: OpenSummaryPresentation;
  readonly search: TodaySearch;
  /** KST 오늘이다. 탭 링크가 넣을 날짜라 컴포넌트가 스스로 시계를 읽지 않는다(AGENTS 15). */
  readonly today: string;
}) {
  return (
    <div className='flex flex-wrap items-baseline gap-x-5 gap-y-1'>
      {summary.tabs.map((tab) => (
        <TabLink key={tab.id} tab={tab} href={tabRoute(search, tab, today)} />
      ))}
      {/* 게시일을 못 센 수는 `오늘 열린`의 물음표가 무엇 때문인지를 말한다. 0이면 적지 않는다. */}
      {summary.announcedUnobservedCount > 0 ? (
        <span className='text-[13px] font-medium text-muted-foreground'>게시일 미관측 {summary.announcedUnobservedCount}건</span>
      ) : null}
    </div>
  );
}

/** 마감 달력이다. 축 줄 아래, 목록 바로 위에 둔다 — 달력이 언제를 말하고 축이 무엇을 말한 뒤가 목록이다. */
export function TodayCalendar({
  summary,
  search
}: {
  readonly summary: OpenSummaryPresentation;
  readonly search: TodaySearch;
}) {
  return (
    // 달력은 두 주치 격자라 폭이 넓어질수록 읽기 어려워진다. 목록과 달리 늘려서 얻는 것이 없다.
    <div className='grid w-full max-w-2xl gap-1'>
      <span className='px-2 text-[15px] font-semibold'>{summary.windowText}</span>
      <div className='grid grid-cols-7 px-2 text-[13px] font-semibold text-muted-foreground'>
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className='grid grid-cols-7 gap-0.5'>
        {summary.calendar.map((cell) => <CalendarCell key={cell.date} cell={cell} search={search} />)}
      </div>
    </div>
  );
}
