/** @module 책임: 2주 마감 달력을 칸마다 링크로 그리고, 지나간 칸을 0건이 아니라 지남으로 표시한다. 머리 문장은 today-lede가 소유한다. */
import Link from 'next/link';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { CalendarCellPresentation, OpenSummaryPresentation } from '../_model/present-open-summary';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'] as const;

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
      // 선택 링은 채움과 다른 역할의 색이어야 보인다. 오늘 칸은 primary로 차 있어 primary 링이 1:1로 사라지므로
      // 그 칸만 primary-foreground 링을 쓴다(2026-09-16 실측, EAT-229). 링은 aria-current와 짝이라 색만으로 말하지 않는다.
      className={`${base} ring-inset ${
        cell.selected ? (cell.tone === 'today' ? 'ring-2 ring-primary-foreground' : 'ring-2 ring-primary') : 'hover:ring-1 hover:ring-border'
      } ${
        cell.tone === 'today' ? 'bg-primary text-primary-foreground' : filled ? '' : 'hover:bg-muted/60'
      }`}
      // 농도는 창 안 최댓값을 분모로 한 비율이라 한산한 주와 바쁜 주가 같은 눈금 위에 있지 않다.
      // 색은 그 주 안에서의 상대 크기만 말하고 절대 수는 칸의 숫자가 말한다.
      style={cell.tone === 'today' || cell.weight === 0
        ? undefined
        : { backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(10 + cell.weight * 42)}%, transparent)` }}
    >
      {/* 농도가 실린 칸에서 muted 날짜는 2.66:1까지 떨어진다(52% 농도 실측). 바쁜 날일수록 날짜를 못 읽으면 안 되므로
          채운 칸의 날짜는 본문 색이다. 빈 칸만 muted로 두어 날짜와 건수의 층을 유지한다(EAT-229). */}
      <span className={cell.tone === 'today' ? '' : cell.weight > 0 ? 'text-foreground' : 'text-muted-foreground'}>{cell.dayText}</span>
      <span className={cell.tone === 'today' ? '' : cell.count === 0 ? 'text-muted-foreground' : 'text-foreground'}>{cell.count}</span>
    </Link>
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
      {/* 요일 줄은 칸 격자와 같은 gap·같은 안쪽 여백이어야 요일이 칸 위에 선다. 묶음 여백만 주면 일곱 칸이 오른쪽으로 갈수록
          어긋난다(2026-09-16 실측 최대 8px, EAT-229). */}
      <div className='grid grid-cols-7 gap-0.5 text-[13px] font-semibold text-muted-foreground'>
        {WEEKDAYS.map((day) => <span key={day} className='px-2'>{day}</span>)}
      </div>
      <div className='grid grid-cols-7 gap-0.5'>
        {summary.calendar.map((cell) => <CalendarCell key={cell.date} cell={cell} search={search} />)}
      </div>
    </div>
  );
}
