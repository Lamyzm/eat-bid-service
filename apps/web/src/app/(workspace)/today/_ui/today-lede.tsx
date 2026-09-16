/** @module 책임: 오늘 화면 머리의 한 문장(진행중·오늘 마감·오늘 열린 건수)과 기준 시각 줄을 그린다. 수는 날짜 축을 거는 링크이고 못 센 수는 0이 아니라 "셀 수 없어요"다. */
import Link from 'next/link';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { OpenSummaryPresentation, TabPresentation } from '../_model/present-open-summary';

/**
 * 수가 고르는 것은 날짜 축이다. 시간 창과 함께 보내면 계약이 400으로 답하므로 링크가 시간 창을 지운다.
 * 세 수가 서로를 지우는 것도 여기서 한 번에 정해 링크마다 무엇을 남길지 다시 고르지 않게 한다.
 */
function tabRoute(search: TodaySearch, tab: TabPresentation, today: string) {
  const cleared = { closesOn: null, announcedOn: null, closesWithinHours: null };
  if (tab.id === 'live') return buildTodayFilterRoute(search, cleared);
  if (tab.id === 'openedToday') return buildTodayFilterRoute(search, { ...cleared, announcedOn: today });
  return buildTodayFilterRoute(search, { ...cleared, closesOn: today });
}

/**
 * 문장 속 수 하나다. 이름은 `진행중 4건`처럼 라벨과 수를 함께 갖고, 켜진 축은 밑줄로 말한다 — 색만으로 말하지
 * 않는다. 문장이 라벨을 이미 말한 자리(`오늘 열린 공고는 …`)에서는 라벨을 눈에서 숨기고 이름에만 남긴다.
 */
function Count({
  tab,
  href,
  labelHidden = false
}: {
  readonly tab: TabPresentation;
  readonly href: ReturnType<typeof buildTodayFilterRoute>;
  readonly labelHidden?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={tab.active ? 'page' : undefined}
      className={`whitespace-nowrap hover:underline ${tab.active ? 'underline decoration-primary/40 decoration-2 underline-offset-4' : ''}`}
    >
      <span className={labelHidden ? 'sr-only' : undefined}>{tab.label} </span>
      <b className='font-extrabold text-foreground tabular-nums'>{tab.count}건</b>
    </Link>
  );
}

/**
 * 머리 문장이다(U9). 탭 셋 대신 한 문장이 진행중·오늘 마감·오늘 열린을 말하고, 아래 한 줄이 기준 시각과
 * 게시일 결손을 말한다. 수를 두 자리에 두지 않는다 — 이 문장이 이 화면의 유일한 숫자 hero다(screen-system §9.1).
 */
export function TodayLede({
  summary,
  search,
  today,
  asOfText
}: {
  readonly summary: OpenSummaryPresentation;
  readonly search: TodaySearch;
  /** KST 오늘이다. 링크가 넣을 날짜라 컴포넌트가 스스로 시계를 읽지 않는다(AGENTS 15). */
  readonly today: string;
  readonly asOfText: string | null;
}) {
  const [live, openedToday, closingToday] = summary.tabs;
  if (live === undefined || openedToday === undefined || closingToday === undefined) return null;
  return (
    <div className='grid min-w-0 gap-2'>
      <p className='text-[17px] leading-relaxed font-semibold text-muted-foreground'>
        <Count tab={live} href={tabRoute(search, live, today)} />, <Count tab={closingToday} href={tabRoute(search, closingToday, today)} />이에요.{' '}
        {/* 셀 수 없었던 수는 0이 아니라 "셀 수 없어요"다. 0은 세었는데 없다는 말이라 사용자가 할 일이 다르다(AGENTS 3). */}
        {openedToday.count === null
          ? <span className='whitespace-nowrap'>오늘 열린 공고는 <span className='text-muted-foreground/70'>셀 수 없어요</span>.</span>
          : <span className='whitespace-nowrap'>오늘 열린 공고는 <Count tab={openedToday} href={tabRoute(search, openedToday, today)} labelHidden />이에요.</span>}
      </p>
      <p className='text-[13px] font-medium text-muted-foreground/70'>
        {asOfText === null ? null : `${asOfText} 기준`}
        {/* 게시일을 못 센 수는 `오늘 열린`이 왜 셀 수 없는지를 말한다. 0이면 적지 않는다. */}
        {summary.announcedUnobservedCount > 0
          ? `${asOfText === null ? '' : ' · '}게시일이 관측되지 않은 공고가 ${summary.announcedUnobservedCount}건 있어요`
          : null}
      </p>
    </div>
  );
}
