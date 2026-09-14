/** @module 책임: 열린 공고 행을 마감일 묶음으로 끊어 순번·마감·기관·품목·기초금액·참여 여섯 칸으로 그리고, 열의 정렬·폭별 접힘·줄바꿈을 한 열 서술에서 파생하며 상태색은 묶음 머리의 오늘·내일에만 건다. */
import Link from 'next/link';
import type { ReactNode } from 'react';

import { summarizeItemLabel } from '@/entities/item/item-label';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { ClosingDayGroup } from '../_model/group-closing-days';
import type { ClosesTone, OpenAuctionRowPresentation } from '../_model/present-open-auctions';
import type { FloorRateSpread } from '../_model/present-open-summary';

// 빨강은 상태 색으로만 쓴다. 오늘 마감은 red, 내일 마감은 amber(주의)이며 그 밖의 셀·헤더·칩에는 쓰지 않는다
// (screen-system §9.2, EAT-39 판정 F). 색과 함께 `오늘`·`내일` 텍스트가 같이 있다.
//
// 색이 붙는 자리는 묶음 머리 하나다. 행마다 칠하면 같은 날 스무 행이 통째로 빨개져 임박이 상태가 아니라
// 배경이 된다. 상태 색을 다른 셀이 빌려 쓰면 색이 뜻을 잃는 것도 같은 이유다 — 제한지역 미관측이 한동안
// amber를 쓰고 있었는데 그건 급한 일이 아니라 사실이라 색이 아니라 굵기로 드러낸다.
const CLOSES_TONE: Record<ClosesTone, string> = {
  today: 'text-destructive',
  tomorrow: 'text-pushed',
  later: 'text-foreground',
  unknown: 'text-muted-foreground'
};

const MUTED = 'text-[13px] leading-tight font-medium text-muted-foreground';

function OrganizationCell({ row, search }: { readonly row: OpenAuctionRowPresentation; readonly search: TodaySearch }) {
  const { organization, region } = row;
  // 지역 어휘 계약이 아직 없어 라벨을 관측하지 못한 지역이 있다. 그때 `코드 657`을 적으면 사용자가 읽을 수
  // 없는 글자가 기관 이름 아래 줄을 차지한다. 라벨이 있는 것만 보인다(EAT-100까지).
  const places = [region.sido, region.sigungu].filter(
    (reference): reference is NonNullable<typeof reference> => reference !== null && !reference.text.startsWith('코드 ')
  );
  return (
    <div className='grid min-w-0 gap-0.5'>
      {/* 행을 여는 자리는 기관 이름이다. 별도의 `열기` 열을 두면 모든 행에 같은 단어가 서른 번 서고,
          그 열의 너비만큼 기관 이름이 줄어든다. */}
      <Link
        href={row.href}
        className={`line-clamp-2 break-keep wrap-anywhere text-[15px] font-semibold hover:underline ${organization.tone === 'named' ? '' : 'text-muted-foreground'}`}
      >
        {organization.text}
      </Link>
      <span className={`flex flex-wrap gap-x-2 empty:hidden ${MUTED}`}>
        {/* 지역 링크는 라벨이 아니라 code value id로 거른다. 라벨은 표시일 뿐이다(AGENTS 2·6). */}
        {places.map((reference) => (
          <Link key={reference.codeValueId} href={buildTodayFilterRoute(search, { sido: reference.codeValueId })} className='hover:underline'>
            {reference.text}
          </Link>
        ))}
        {/* 제한지역은 공고지역과 다른 축이라 링크가 아니라 사실 표시다. 관측한 제한은 위 조건 줄이 이미
            세고 있으므로 행에는 관측하지 못한 경우만 남긴다 — 제한 없음으로 바꿔 적으면 낼 수 있는
            공고가 목록에서 조용히 사라진다. */}
        {row.eligibilityText === null ? <span className='font-semibold text-foreground'>제한지역 미관측</span> : null}
        {/* 좁은 폭에서 접힌 품목을 둘째 줄에 둔다. 참여는 어느 폭에서나 제 열에 있다. */}
        <span className='lg:hidden'>{row.itemLabel === null ? '품목 미확인' : summarizeItemLabel(row.itemLabel).text}</span>
      </span>
    </div>
  );
}

function ItemCell({ row, search }: { readonly row: OpenAuctionRowPresentation; readonly search: TodaySearch }) {
  if (row.itemLabel === null) return <span className='text-muted-foreground'>미확인</span>;
  const item = summarizeItemLabel(row.itemLabel);
  // 품목은 아직 code scheme이 없어 관측 라벨 완전일치로 거른다(EAT-39 판정 B).
  return (
    <Link href={buildTodayFilterRoute(search, { item: row.itemLabel })} title={item.full ?? undefined} className='hover:underline'>
      {item.text}
    </Link>
  );
}

/**
 * 기초금액과, 이 목록에서 드문 하한일 때만 그 값이다.
 *
 * 하한을 열로 두지 않는 이유는 요약의 `floorSpread`가 소유한다. 여기서는 그 판정을 받아 적을 뿐이라
 * 드문 값이 하나도 없는 흔한 경우에는 둘째 줄 자체가 없다.
 */
function BaseAmountCell({ row, rareRates }: { readonly row: OpenAuctionRowPresentation; readonly rareRates: ReadonlySet<string> }) {
  return (
    <span className='grid justify-items-end gap-0.5 tabular-nums'>
      <span className='whitespace-nowrap'>{row.baseAmountText}</span>
      {rareRates.has(row.floorRateText) ? <span className={`${MUTED} whitespace-nowrap`}>하한 {row.floorRateText}</span> : null}
    </span>
  );
}

/**
 * 오늘 몇 곳 들어왔는지와 그 판의 보통이 한 칸에 있다.
 *
 * 열을 나누지 않는 이유는 둘이 **함께 읽어야 뜻이 생기는 한 쌍**이기 때문이다. `0`만 보면 한산한
 * 판인지 아직 안 찬 판인지 알 수 없다. 보통 17인 곳의 0과 보통 60인 곳의 0은 다른 말이다.
 *
 * 표본 수를 함께 적는다. 같은 `보통 68`이라도 다섯 회를 본 것과 열다섯 회를 본 것은 무게가
 * 다르고, 표본 없는 중앙값을 화면에 내면 그 차이가 사라진다(AGENTS 7).
 */
function ParticipationCell({ row }: { readonly row: OpenAuctionRowPresentation }) {
  return (
    <span className='grid justify-items-end gap-0.5 tabular-nums'>
      <span className='whitespace-nowrap'>{row.bidCountText}</span>
      {row.orgSummary === null
        ? null
        : (
            <span className={`${MUTED} whitespace-nowrap`}>
              보통 {row.orgSummary.medianListText} · {row.orgSummary.listCountSampleCount}회
            </span>
          )}
    </span>
  );
}

/** 셀이 행 하나만으로는 알 수 없는 것들이다. 순번은 목록에서의 자리고, 드문 하한은 목록 전체의 성질이다. */
type OpenAuctionCellContext = {
  readonly search: TodaySearch;
  readonly rank: number;
  readonly rareRates: ReadonlySet<string>;
};

type OpenAuctionColumn = {
  readonly id: string;
  readonly header: string;
  /**
   * 머리글 아래 한 줄이다. 그 열의 값이 **무엇에서 온 값인지**를 말한다 — 품목이 우리가 정한 범주가
   * 아니라 저장된 라벨이라는 사실, 참여 수가 지금이 아니라 마지막 훑기의 값이라는 사실이 열 이름만으로는
   * 안 보인다(AGENTS 7). 말할 것이 없으면 두지 않는다.
   */
  readonly subheader?: string;
  readonly align: 'text-left' | 'text-right';
  /**
   * 고정 폭이다. `auto`인 열 하나가 남는 폭을 전부 가져간다.
   *
   * 표를 폭에 맡기면 본문이 넓어질수록 여섯 칸이 같이 벌어져 기관 이름과 기초금액 사이가 손가락 두 개만큼
   * 떨어진다. 한 행을 읽는 데 눈이 가로로 두 번 움직이면 마감 임박 순이라는 세로 흐름이 끊긴다.
   */
  readonly width: string;
  /** 폭이 좁아질 때 접히는 규칙이다. 빈 문자열은 어느 폭에서나 보인다. */
  readonly visibility: string;
  /**
   * 머리글을 눈에서만 감추는 열이다. 행동 열은 화면에 머리글이 필요 없지만 이름이 없으면 그 열이 무엇인지
   * 말하지 않는다. `th` 자체가 아니라 안쪽 문구만 감춰야 `scope` 연결과 열 폭이 그대로 남는다.
   */
  readonly headerHidden?: true;
  /** 셀 안에서 줄을 바꾸는 열이다. 나머지 숫자 열은 nowrap에 tabular-nums다. */
  readonly wraps?: true;
  readonly cell: (row: OpenAuctionRowPresentation, context: OpenAuctionCellContext) => ReactNode;
};

/**
 * 열의 머리글·부제·정렬·접힘·줄바꿈·셀을 한 줄에 모은다. 이 여섯을 따로 둔 표로 관리하면 열 하나를 더할 때
 * 여섯 곳을 맞춰야 하고, 하나를 빠뜨려도 className에 `undefined`가 들어갈 뿐 조용히 지나간다.
 *
 * 여섯 칸이고 머리글은 다섯이다. 마감 임박 순이 이미 정해진 목록이라 순번은 `몇 번째로 닫히나`라는
 * 뜻을 갖고, 그 열에는 부를 이름이 따로 없어 머리글을 눈에서만 감춘다.
 *
 * 마감 칸은 시각만이다. 날짜는 묶음 머리가 한 번 말한다. 하한은 열이 아니다(요약의 `floorSpread`).
 * 최근 낙찰은 투찰률 축이라 사정률 축인 이 목록과 눈금이 다르고, 한 행을 고른 뒤에 볼 것이라 상세로
 * 보낸다. 좁은 폭에서는 품목만 접어 기관 셀 둘째 줄로 내리고 나머지 다섯은 어느 폭에서나 남는다.
 */
const COLUMNS: readonly OpenAuctionColumn[] = [
  { id: 'rank', header: '순번', align: 'text-left', width: '2.25rem', visibility: '', headerHidden: true, cell: (_row, context) => <span className={MUTED}>{context.rank}</span> },
  { id: 'closes', header: '마감', align: 'text-left', width: '4.5rem', visibility: '', cell: (row) => <span className='tabular-nums'>{row.closes.clockText}</span> },
  { id: 'organization', header: '기관', align: 'text-left', width: 'auto', visibility: '', wraps: true, cell: (row, context) => <OrganizationCell row={row} search={context.search} /> },
  { id: 'item', header: '품목', subheader: '저장된 라벨', align: 'text-left', width: '8rem', visibility: 'hidden lg:table-cell', cell: (row, context) => <ItemCell row={row} search={context.search} /> },
  { id: 'baseAmount', header: '기초금액', subheader: '저장된 값', align: 'text-right', width: '8.5rem', visibility: '', cell: (row, context) => <BaseAmountCell row={row} rareRates={context.rareRates} /> },
  { id: 'participation', header: '참여', align: 'text-right', width: '7rem', visibility: '', cell: (row) => <ParticipationCell row={row} /> }
];

/**
 * 마감일 묶음 머리다. 이 한 줄이 그 아래 행들의 날짜를 대신 말하므로 행의 마감 칸에는 시각만 남는다.
 *
 * `2건 · 7건 중`의 뒤쪽은 품목·금액을 푼 수다. 조건을 좁힌 채로도 그날 판이 얼마나 큰지 보이지 않으면
 * 사용자가 자기 조건이 무엇을 가렸는지 모른다. 셀 근거가 없는 날(달력 창 밖)은 수를 적지 않는다.
 */
function DayHeadRow({ group, columns }: { readonly group: ClosingDayGroup; readonly columns: number }) {
  return (
    <tr className='border-b border-border/60 bg-muted/40'>
      <th scope='colgroup' colSpan={columns} className='px-2 py-1 text-left font-semibold'>
        <span data-slot='closes' className={`inline-flex flex-wrap items-baseline gap-x-2 ${CLOSES_TONE[group.tone]}`}>
          <span className='text-[15px]'>{group.dateText}</span>
          {group.awayText === '' ? null : <span className={MUTED}>{group.awayText}</span>}
          {group.count === null ? null : <span className='text-[13px] font-semibold tabular-nums'>{group.count}건</span>}
          {group.releasedCount === null ? null : <span className={`${MUTED} tabular-nums`}>{group.releasedCount}건 중</span>}
        </span>
      </th>
    </tr>
  );
}

/**
 * 행 값은 서버에서 이미 문자열로 만들어졌고 셀 안 상호작용은 링크뿐이라 이 표는 server component다.
 * 정렬·필터·페이징이 이 화면의 표에 생기기 전까지 headless 표 라이브러리를 다시 들이지 않는다 —
 * 그 순간 표 전체가 브라우저로 넘어가고 hydration 비용이 따라온다.
 */
export function OpenAuctionTable({
  groups,
  search,
  floorRates,
  organizationCount,
  observedText
}: {
  readonly groups: readonly ClosingDayGroup[];
  readonly search: TodaySearch;
  /** 하한 판정은 결과 집합의 성질이라 표가 혼자 정하지 않는다. 조건 줄과 같은 판정을 받아 쓴다. */
  readonly floorRates: FloorRateSpread;
  /** 기관 머리글 아래 `N곳`이다. 한 기관이 품목별로 여러 건을 내므로 행 수와 다르다. */
  readonly organizationCount: number | null;
  /** 참여 머리글 아래 `N 기준`이다. 참여 수가 지금이 아니라 마지막 훑기의 값이라는 사실을 말한다. */
  readonly observedText: string | null;
}) {
  const rareRates = floorRates.rareRates;
  const subheaders: Record<string, string | undefined> = {
    organization: organizationCount === null ? undefined : `${organizationCount}곳`,
    participation: observedText === null ? undefined : `${observedText} 기준`
  };
  return (
    <table className='w-full table-fixed border-collapse'>
      <thead>
        <tr className='border-b border-border'>
          {COLUMNS.map((column) => {
            const subheader = subheaders[column.id] ?? column.subheader;
            return (
              <th
                key={column.id}
                scope='col'
                // `colgroup`이 아니라 머리 칸이 폭을 정한다. `col`에 접힘 규칙을 걸면 `display:none`이 그 열을
                // 격자에서 빼 버려 나머지 폭이 한 칸씩 밀린다.
                style={column.width === 'auto' ? undefined : { width: column.width }}
                className={`px-2 pb-1.5 align-top text-[13px] leading-tight font-semibold whitespace-nowrap text-muted-foreground ${column.align} ${column.visibility}`}
              >
                {column.headerHidden ? <span className='sr-only'>{column.header}</span> : (
                  <span className='grid gap-0.5'>
                    <span>{column.header}</span>
                    {subheader === undefined ? null : <span className='font-medium text-muted-foreground/70'>{subheader}</span>}
                  </span>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.key}>
          <DayHeadRow group={group} columns={COLUMNS.length} />
          {group.rows.map((row, index) => (
            <tr key={row.auctionAttemptId} data-closes={row.closes.tone} className='border-b border-border/60 last:border-0'>
              {COLUMNS.map((column) => (
                <td
                  key={column.id}
                  className={`px-2 py-1.5 align-middle text-[15px] leading-tight font-semibold ${column.align} ${column.visibility} ${column.wraps ? '' : 'whitespace-nowrap tabular-nums'}`}
                >
                  {column.cell(row, { search, rank: group.firstRank + index, rareRates })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
