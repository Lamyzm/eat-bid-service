/** @module 책임: 오늘 화면을 조립한다. 제목 아래 머리 문장을 두고, 왼쪽 기둥에 프리셋과 조건 세 구역을, 본문에 달력·검색·목록을 세우며 목록 자리는 표시 모델이 정한 세 상태(계보 없음·결과 0·목록)를 그대로 고른다. */
import Link from 'next/link';

import { EmptyState } from '@/shared/ui/empty-state';

import { presentConditionRail } from '../_features/condition-rail/model/present-condition-rail';
import { ConditionRail } from '../_features/condition-rail/ui/condition-rail';
import { CombinationRail } from '../_features/filter-combinations/ui/combination-rail';
import { presentListSearch } from '../_features/list-search/model/present-list-search';
import { ListSearchForm } from '../_features/list-search/ui/list-search-form';
import { RegionSetupRequest } from '../_features/region-scope/ui/region-scope-strip';
import { describeTodaySearch } from '../_lib/describe-today-search';
import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { TodayPageData } from '../_model/load-today-page';
import { groupClosingDays } from '../_model/group-closing-days';
import type { OpenAuctionListPresentation, OpenAuctionRowPresentation } from '../_model/present-open-auctions';
import { kstToday, type OpenSummaryPresentation } from '../_model/present-open-summary';
import { OpenAuctionTable } from './open-auction-table';
import { TodayFrame } from './today-frame';
import { TodayCalendar } from './today-tabs';
import { TodayLede } from './today-lede';

// 지역 칩의 표시 이름은 응답 행에서 읽는다. 지역 어휘 계약이 없는 동안 그 id의 라벨을 아는 곳은 행뿐이다.
function regionTextOf(rows: readonly OpenAuctionRowPresentation[], region: string | null): string | null {
  if (region === null) return null;
  for (const row of rows) {
    for (const reference of [row.region.sido, row.region.sigungu]) {
      if (reference?.codeValueId === region) return reference.text;
    }
  }
  return null;
}

const LINK = 'inline-flex h-8 items-center rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold hover:bg-foreground/10';

function NoSnapshot() {
  // 활성 build가 없는 것은 오류가 아니라 파생물이 아직 만들어지지 않은 정상 상태다(ADR 0011·0034).
  return <EmptyState title='열린 공고' status='수집 전' description='열린 공고 스냅샷이 아직 만들어지지 않았습니다.' />;
}

/**
 * 0건인 날의 출구다. 조건을 자동으로 넓히지 않는다 — 사용자가 고른 날에 없다는 사실이 먼저고, 어디로
 * 갈지는 사용자가 고른다.
 *
 * 다음 마감일은 요약이 세어 둔 값이라 여기서 다시 묻지 않는다. 요약은 날짜 축으로 좁히지 않으므로
 * 0건인 날을 보고 있어도 마감이 있는 가장 이른 날을 말할 수 있다.
 */
function EmptyResult({
  search,
  regionText,
  summary
}: {
  readonly search: TodaySearch;
  readonly regionText: string | null;
  readonly summary: OpenSummaryPresentation | null;
}) {
  const sentence = describeTodaySearch(search, regionText);
  const next = summary?.nextClosingDay ?? null;
  return (
    <EmptyState
      title='열린 공고'
      description={sentence === null ? '지금 열린 공고가 없습니다.' : `${sentence} 조건에서 열린 공고가 없습니다.`}
      action={
        next === null && sentence === null ? undefined : (
          <div className='flex flex-wrap gap-2'>
            {next === null ? null : (
              <Link
                href={buildTodayFilterRoute(search, { closesOn: next.date, announcedOn: null, closesWithinHours: null })}
                className={LINK}
              >
                마감이 가장 이른 날 {next.dayText} · {next.count}건
              </Link>
            )}
            {sentence === null ? null : <Link href='/today' className={LINK}>조건 모두 해제</Link>}
          </div>
        )
      }
    />
  );
}

function OpenAuctionList({
  rows,
  presentation,
  search,
  summary,
  nowIso,
  cursorReset
}: {
  readonly rows: readonly OpenAuctionRowPresentation[];
  readonly presentation: OpenAuctionListPresentation;
  readonly search: TodaySearch;
  readonly summary: OpenSummaryPresentation | null;
  readonly nowIso: string;
  readonly cursorReset: boolean;
}) {
  // 하한 판정은 축 줄과 표가 같은 값을 써야 조건 줄이 세는 수와 행에 붙는 값이 어긋나지 않는다.
  // 요약이 소유하므로 여기서는 받아서 내려보내기만 한다.
  const floorRates = summary?.floorSpread ?? { axisText: '', rareRates: new Set<string>() };
  // 마감일 묶음은 행 순서를 바꾸지 않는다. 이미 마감 임박 순인 목록을 날짜가 바뀌는 자리에서 끊을 뿐이라
  // `마감 임박 순`이라는 제목이 따로 필요 없어졌다 — 묶음 머리가 순서를 보여 준다.
  const groups = groupClosingDays(rows, nowIso, summary);
  return (
    <div className='grid min-w-0'>
      <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1 empty:hidden'>
        {/* 더보기를 두지 않기로 했으므로(사용자 결정) 못 보는 행이 생기면 그 사실을 수로 적는다. 좁히는
            길 셋(달력 칸·지역 칩·검색)은 이미 화면에 있다. */}
        {rows.length === presentation.sampleCount ? null : (
          <span className='text-[13px] font-semibold text-pushed'>
            {presentation.sampleCount}건 중 {rows.length}건
          </span>
        )}
        {cursorReset ? <span className='text-[13px] font-semibold text-pushed'>목록이 갱신되어 처음부터 다시 보입니다.</span> : null}
      </div>
      <div className='min-w-0'>
        <OpenAuctionTable
          groups={groups}
          search={search}
          floorRates={floorRates}
          organizationCount={summary?.organizationCount ?? null}
          observedText={summary?.latestObservedText ?? null}
        />
      </div>
    </div>
  );
}

/** 목록 자리의 네 상태를 한 곳에서 고른다. 종류가 늘면 이 switch가 컴파일에서 막는다. */
function TodayList({ data, regionText }: { readonly data: TodayPageData; readonly regionText: string | null }) {
  const { presentation, search } = data;
  // 지역 미설정은 목록의 상태가 아니라 목록 앞의 상태다. 조회 자체를 하지 않았으므로 표시 모델이 없다.
  if (presentation === null) return <RegionSetupRequest />;
  const view = presentation.view;
  switch (view.kind) {
    case 'no-snapshot':
      return <NoSnapshot />;
    case 'empty':
      return <EmptyResult search={search} regionText={regionText} summary={data.summary} />;
    case 'list':
      return (
        <OpenAuctionList
          rows={view.rows}
          presentation={presentation}
          search={search}
          summary={data.summary}
          nowIso={data.nowIso}
          cursorReset={data.cursorReset}
        />
      );
  }
}

export function TodayScreen({ data }: { readonly data: TodayPageData }) {
  const { presentation, search } = data;
  const view = presentation?.view ?? null;
  const regionText = regionTextOf(view?.kind === 'list' ? view.rows : [], search.sido);
  return (
    <TodayFrame
      header={
        /* 제목 아래 한 문장이 이 화면의 유일한 숫자 hero다(U9). 탭 줄을 따로 두면 같은 수가 두 자리에 서고
           언젠가 한쪽만 고쳐져 둘이 다른 말을 한다(screen-system §9.1). */
        <div className='grid min-w-0 gap-2.5'>
          <h1 id='today-title' className='text-[26px] font-extrabold tracking-[-0.04em]'>오늘</h1>
          {data.summary === null ? null : (
            <TodayLede summary={data.summary} search={search} today={kstToday(data.nowIso).toString()} asOfText={presentation?.asOfText ?? null} />
          )}
        </div>
      }
      rail={
        /* 2xl 아래에서는 기둥이 본문 위로 가므로 프리셋과 조건 세 구역을 가로로 펼친다. 세로로 쌓으면 1280에서
           목록이 첫 화면 밖으로 밀린다(2026-09-16 실측: 표가 y=1,100 아래). */
        <div className='grid min-w-0 items-start gap-5 lg:grid-cols-[252px_minmax(0,1fr)] 2xl:grid-cols-1'>
          {/* 조건을 바꿔 가며 판을 찾는 자리다. 매번 축 셋을 다시 누르면 탐색이 일이 된다(EAT-208). */}
          {data.combinations === null ? null : (
            <CombinationRail combinations={data.combinations} search={search} />
          )}
          {/* 무엇으로 좁혔는지는 목록 옆에 계속 남는다(screen-system §6.4.1). 본문 위에 가로로 두면 한 줄을
              통째로 쓰면서 목록을 아래로 밀고, 스크롤하면 사라져 자기 조건을 잊는다. 지역·품목·기초금액
              세 구역은 시안 U9의 순서이고 건수는 요약이 "그 축 하나만 푼 집합"으로 센 수다(EAT-241). */}
          {data.regionGate.kind === 'unset' ? null : (
            /* 프리셋이 없어도(읽기 실패·fixture) 조건은 둘째 칸에 선다. 첫 칸(240px)에 들어가면 세 구역이 70px로 눌린다
               (2026-09-16 e2e 실측). */
            <div className='min-w-0 lg:col-start-2 2xl:col-start-auto'>
              <ConditionRail rail={presentConditionRail({ search, summary: data.summary, gate: data.regionGate })} />
            </div>
          )}
          {/* 표본 수·계보·산출 시각을 숨기지 않는다(AGENTS 7). 표 위 한 줄로 두면 780px에서 두 줄로 넘쳐
              목록을 읽는 눈이 먼저 걸리므로, 조건과 같은 기둥에 두어 목록 옆에 계속 남긴다. */}
          {presentation === null ? null : (
            <div className='grid gap-0.5 text-[13px] leading-tight font-medium text-muted-foreground/70 lg:col-span-2 2xl:col-span-1'>
              {presentation.lineageLines.map((line) => <span key={line}>{line}</span>)}
            </div>
          )}
        </div>
      }
      filters={
        /* 문장 → 달력 → 검색 순서다. 조건은 왼쪽 기둥이 소유하고(EAT-241) 본문에는 축 줄을 두지 않는다 — 한 줄을
           통째로 쓰면서 목록을 아래로 밀고 `하한 N · N건`처럼 사용자가 지우라고 한 숫자가 거기 살았다. 달력은 탭
           아래, 검색은 달력 아래 목록 바로 위다(U9). 검색이 기둥이 아니라 본문에 있는 이유는 조건이 아니라
           "이 조건 안에서 찾기"이기 때문이다 — 상한 200건 밖의 행에 닿는 유일한 길이다(EAT-247). */
        <div className='grid min-w-0 gap-2.5'>
          {data.summary === null ? null : <TodayCalendar summary={data.summary} search={search} />}
          {presentation === null ? null : (
            <ListSearchForm search={presentListSearch(search, presentation.view.kind === 'no-snapshot' ? null : presentation.sampleCount)} />
          )}
        </div>
      }
      list={<TodayList data={data} regionText={regionText} />}
    />
  );
}
