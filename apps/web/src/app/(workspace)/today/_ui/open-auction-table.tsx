/** @module 책임: 열린 공고 행을 마감 임박 순 그대로 순번·마감·기관·품목·기초금액·참여 여섯 칸으로 그리고, 열의 정렬·폭별 접힘·줄바꿈을 한 열 서술에서 파생하며 상태색은 마감 셀의 D-0·D-1에만 건다. */
import Link from 'next/link';
import type { ReactNode } from 'react';

import { summarizeItemLabel } from '@/entities/item/item-label';

import { buildTodayFilterRoute, type TodaySearch } from '../_lib/today-search-params';
import type { ClosesTone, FloorRateSpread, OpenAuctionRowPresentation } from '../_model/present-open-auctions';

// 빨강은 상태 색으로만 쓴다. 오늘 마감은 red, 내일 마감은 amber(주의)이며 그 밖의 셀·헤더·칩에는 쓰지 않는다
// (screen-system §9.2, EAT-39 판정 F). 색과 함께 `D-0`·`D-1` 텍스트가 같이 있다.
//
// 상태 색을 다른 셀이 빌려 쓰면 색이 뜻을 잃는다. 제한지역 미관측이 한동안 amber를 쓰고 있었는데, 그건
// 급한 일이 아니라 사실이라 색이 아니라 굵기로 드러낸다. 선택자도 함께 무너져서 마감 셀을 고르던 검사가
// 미관측 배지를 같이 잡았다. 마감 셀에 `data-slot='closes'`를 둔 이유가 그것이다.
const CLOSES_TONE: Record<ClosesTone, string> = {
  today: 'text-destructive font-bold',
  tomorrow: 'text-pushed font-bold',
  later: 'text-foreground',
  unknown: 'text-muted-foreground'
};

const MUTED = 'text-[13px] font-medium text-muted-foreground';

function OrganizationCell({ row, search }: { readonly row: OpenAuctionRowPresentation; readonly search: TodaySearch }) {
  const { organization, region } = row;
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
      <span className={`flex flex-wrap gap-x-2 ${MUTED}`}>
        {organization.type !== null && organization.type !== 'unknown' ? <span>{organization.type}</span> : null}
        {/* 지역 링크는 라벨이 아니라 code value id로 거른다. 라벨은 표시일 뿐이다(AGENTS 2·6). */}
        {[region.sido, region.sigungu].map((reference) =>
          reference === null ? null : (
            <Link key={reference.codeValueId} href={buildTodayFilterRoute(search, { sido: reference.codeValueId })} className='hover:underline'>
              {reference.text}
            </Link>
          )
        )}
        {/* 제한지역은 공고지역과 다른 축이라 링크가 아니라 사실 표시다. 관측하지 못한 행은 그 사실을
            그대로 말한다 — 제한 없음으로 바꿔 적으면 낼 수 있는 공고가 목록에서 조용히 사라진다. */}
        <span className={row.eligibilityText === null ? 'font-semibold text-foreground' : undefined}>
          {row.eligibilityText === null ? '제한지역 미관측' : `제한 ${row.eligibilityText}`}
        </span>
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

function ClosesCell({ row }: { readonly row: OpenAuctionRowPresentation }) {
  return (
    <span data-slot='closes' className={`inline-flex items-baseline gap-1.5 whitespace-nowrap tabular-nums ${CLOSES_TONE[row.closes.tone]}`}>
      <span>{row.closes.label}</span>
      {row.closes.timeText ? <span className='text-[13px] font-medium'>{row.closes.timeText}</span> : null}
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

/**
 * 기초금액과, 이 목록에서 드문 하한일 때만 그 값이다.
 *
 * 하한을 열로 두지 않는 이유는 `summarizeFloorRates`가 소유한다. 여기서는 그 판정을 받아 적을 뿐이라
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

/** 셀이 행 하나만으로는 알 수 없는 것들이다. 순번은 목록에서의 자리고, 드문 하한은 목록 전체의 성질이다. */
type OpenAuctionCellContext = {
  readonly search: TodaySearch;
  readonly rank: number;
  readonly rareRates: ReadonlySet<string>;
};

type OpenAuctionColumn = {
  readonly id: string;
  readonly header: string;
  readonly align: 'text-left' | 'text-right';
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
 * 열의 머리글·정렬·접힘·줄바꿈·셀을 한 줄에 모은다. 이 넷을 따로 둔 표로 관리하면 열 하나를 더할 때
 * 네 곳을 맞춰야 하고, 하나를 빠뜨려도 className에 `undefined`가 들어갈 뿐 조용히 지나간다.
 *
 * 여섯 칸이고 머리글은 다섯이다. 마감 임박 순이 이미 정해진 목록이라 순번은 `몇 번째로 닫히나`라는
 * 뜻을 갖고, 그 열에는 부를 이름이 따로 없어 머리글을 눈에서만 감춘다.
 *
 * 하한은 열이 아니다(`summarizeFloorRates`). 최근 낙찰은 투찰률 축이라 사정률 축인 이 목록과 눈금이
 * 다르고, 한 행을 고른 뒤에 볼 것이라 상세로 보낸다. 좁은 폭에서는 품목만 접어 기관 셀 둘째 줄로
 * 내리고 나머지 다섯은 어느 폭에서나 남는다.
 */
const COLUMNS: readonly OpenAuctionColumn[] = [
  { id: 'rank', header: '순번', align: 'text-left', visibility: '', headerHidden: true, cell: (_row, context) => <span className={MUTED}>{context.rank}</span> },
  { id: 'closes', header: '마감', align: 'text-left', visibility: '', cell: (row) => <ClosesCell row={row} /> },
  { id: 'organization', header: '기관', align: 'text-left', visibility: '', wraps: true, cell: (row, context) => <OrganizationCell row={row} search={context.search} /> },
  { id: 'item', header: '품목', align: 'text-left', visibility: 'hidden lg:table-cell', cell: (row, context) => <ItemCell row={row} search={context.search} /> },
  { id: 'baseAmount', header: '기초금액', align: 'text-right', visibility: '', cell: (row, context) => <BaseAmountCell row={row} rareRates={context.rareRates} /> },
  { id: 'participation', header: '참여', align: 'text-right', visibility: '', cell: (row) => <ParticipationCell row={row} /> }
];

/**
 * 행 값은 서버에서 이미 문자열로 만들어졌고 셀 안 상호작용은 링크뿐이라 이 표는 server component다.
 * 정렬·필터·페이징이 이 화면의 표에 생기기 전까지 headless 표 라이브러리를 다시 들이지 않는다 —
 * 그 순간 표 전체가 브라우저로 넘어가고 hydration 비용이 따라온다.
 */
export function OpenAuctionTable({
  rows,
  search,
  floorRates
}: {
  readonly rows: readonly OpenAuctionRowPresentation[];
  readonly search: TodaySearch;
  /** 하한 판정은 결과 집합의 성질이라 표가 혼자 정하지 않는다. 조건 줄과 같은 판정을 받아 쓴다. */
  readonly floorRates: FloorRateSpread;
}) {
  const rareRates = floorRates.rareRates;
  return (
    <table className='w-full border-collapse'>
      <thead>
        <tr className='border-b border-border'>
          {COLUMNS.map((column) => (
            <th key={column.id} scope='col' className={`px-2 py-2 text-[13px] font-semibold whitespace-nowrap text-muted-foreground xl:px-3 ${column.align} ${column.visibility}`}>
              {column.headerHidden ? <span className='sr-only'>{column.header}</span> : column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.auctionAttemptId} data-closes={row.closes.tone} className='border-b border-border/60 last:border-0'>
            {COLUMNS.map((column) => (
              <td
                key={column.id}
                className={`px-2 py-2 align-top text-[15px] font-medium xl:px-3 ${column.align} ${column.visibility} ${column.wraps ? '' : 'whitespace-nowrap tabular-nums'}`}
              >
                {column.cell(row, { search, rank: index + 1, rareRates })}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
