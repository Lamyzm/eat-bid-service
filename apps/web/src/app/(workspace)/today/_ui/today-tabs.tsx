/** @module 책임: 탭 셋과 2주 마감 달력을 링크로 그리고, 못 센 수를 0이 아니라 물음표로, 지나간 칸을 0건이 아니라 지남으로 표시한다. */
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
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[15px] font-semibold whitespace-nowrap ${
        tab.active ? 'bg-foreground/8 text-foreground' : 'text-muted-foreground hover:bg-foreground/5'
      }`}
    >
      {tab.label}
      {/* 셀 수 없었던 수는 0이 아니라 `?`다. 0은 세었는데 없다는 말이라 사용자가 할 일이 다르다. */}
      <span className={`tabular-nums ${tab.count === null ? 'text-muted-foreground' : ''}`}>
        {tab.count === null ? '?' : tab.count}
      </span>
    </Link>
  );
}

/**
 * 달력 칸 하나다. 색 농도는 건수를 견준 것이고 수는 언제나 함께 적는다 — 농도만으로는 12건과 23건이
 * 같은 칸으로 보이고, 색을 못 보는 사용자에게는 아무 말도 하지 않는다.
 */
function CalendarCell({
  cell,
  search
}: {
  readonly cell: CalendarCellPresentation;
  readonly search: TodaySearch;
}) {
  const label = `${cell.date} ${cell.count}건`;
  if (cell.tone === 'past') {
    return (
      <span className='grid h-11 place-items-center rounded-md text-[13px] font-medium text-muted-foreground/40' aria-hidden>
        {cell.dayText}
      </span>
    );
  }
  return (
    <Link
      href={buildTodayFilterRoute(search, {
        closesOn: cell.selected ? null : cell.date,
        announcedOn: null,
        closesWithinHours: null
      })}
      aria-label={label}
      aria-current={cell.selected ? 'date' : undefined}
      className={`grid h-11 content-center justify-items-center rounded-md text-[13px] font-semibold tabular-nums ring-inset ${
        cell.selected
          ? 'ring-2 ring-primary'
          : cell.tone === 'today'
            ? 'ring-1 ring-border hover:ring-foreground/30'
            : 'ring-0 hover:ring-1 hover:ring-border'
      }`}
      // 농도는 관측된 최댓값을 분모로 한 비율이라 한산한 주와 바쁜 주가 같은 눈금 위에 있지 않다.
      // 색은 그 주 안에서의 상대 크기만 말하고 절대 수는 칸의 숫자가 말한다.
      style={cell.weight === 0 ? undefined : { backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(10 + cell.weight * 38)}%, transparent)` }}
    >
      <span className={cell.tone === 'today' ? 'text-foreground' : 'text-muted-foreground'}>{cell.dayText}</span>
      <span className={cell.count === 0 ? 'text-muted-foreground/50' : 'text-foreground'}>{cell.count}</span>
    </Link>
  );
}

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
    <div className='grid gap-3'>
      <div className='flex flex-wrap items-center gap-1'>
        {summary.tabs.map((tab) => (
          <TabLink key={tab.id} tab={tab} href={tabRoute(search, tab, today)} />
        ))}
        {/* 게시일을 못 센 수는 `오늘 열린`의 물음표가 무엇 때문인지를 말한다. 0이면 적지 않는다. */}
        {summary.announcedUnobservedCount > 0 ? (
          <span className='text-[13px] font-medium text-muted-foreground'>게시일 미관측 {summary.announcedUnobservedCount}건</span>
        ) : null}
      </div>
      {/* 달력은 두 주치 격자라 폭이 넓어질수록 읽기 어려워진다. 목록과 달리 늘려서 얻는 것이 없다. */}
      <div className='grid w-full max-w-xl gap-1 rounded-xl bg-card p-3 shadow-xs'>
        <div className='grid grid-cols-7 text-center text-[13px] font-semibold text-muted-foreground'>
          {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className='grid grid-cols-7 gap-0.5'>
          {summary.calendar.map((cell) => <CalendarCell key={cell.date} cell={cell} search={search} />)}
        </div>
      </div>
    </div>
  );
}
