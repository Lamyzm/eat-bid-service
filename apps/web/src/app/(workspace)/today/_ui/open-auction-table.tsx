/** @module 책임: 열린 공고 행을 마감일 묶음으로 끊어 순번·마감·기관·품목·기초금액·참여·지난번·보통 여덟 칸을 44px 한 줄로 그리고, 열의 정렬·폭별 접힘·줄바꿈을 한 열 서술에서 파생하며 상태색은 묶음 머리의 오늘·내일에만 건다. */
import type { ReactNode } from 'react';

import type { TodaySearch } from '../_lib/today-search-params';
import type { ClosingDayGroup } from '../_model/group-closing-days';
import type { ClosesTone, OpenAuctionRowPresentation } from '../_model/present-open-auctions';
import type { FloorRateSpread } from '../_model/present-open-summary';
import { BaseAmountCell, ItemCell, LastRoundCell, MedianCell, MUTED, OrganizationCell } from './open-auction-cells';

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
   * 고정 폭이다. `w-auto`인 열 하나가 남는 폭을 전부 가져간다.
   *
   * 표를 폭에 맡기면 본문이 넓어질수록 칸이 같이 벌어져 기관 이름과 기초금액 사이가 손가락 두 개만큼
   * 떨어진다. 한 행을 읽는 데 눈이 가로로 두 번 움직이면 마감 임박 순이라는 세로 흐름이 끊긴다.
   *
   * 폭은 셀 값이 아니라 **머리글 두 줄**이 정한다. 부제가 열보다 넓으면 옆 칸으로 흘러넘치므로
   * `개찰 한 시간 뒤`(77px)와 `MM-DD HH:mm 기준`(98px)이 들어갈 만큼을 잡았다(2026-09-15 실측).
   * 글꼴이 기기마다 달라 딱 맞게 잡으면 CI에서만 2px이 모자라므로 열마다 10px 넘게 여유를 둔다 — 참여 칸이
   * w-28일 때 웹 글꼴이 안 실린 실행에서 부제가 1px 넘쳐 폭 검사가 깨졌다(2026-09-16 e2e 실측).
   * md(768)에서는 표에 448px뿐이라 그만큼을 줄 수 없어 부제를 감추고 열을 w-16·w-12로 좁힌다.
   *
   * 여덟 칸이 다 서는 폭은 xl(1280)부터다. 조건 기둥이 옆에 붙는 것은 2xl(1536)부터라 xl에서는 표가 본문
   * 폭 976px을 다 쓴다 — 기둥을 xl에서 옆에 두면 표가 708px뿐이라 여덟 칸의 기관 칸이 0이 된다(2026-09-16
   * dev 실측). lg(1024)에서 셸 탐색을 빼면 표에 736px이 남아 여섯 칸까지 서고, md(768)에서는 398px뿐이라
   * 넷만 선다. 접힌 칸은 지워지지 않고 기관 셀 둘째 줄로 내려간다.
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
 * 여덟 칸이고 머리글은 일곱이다. 마감 임박 순이 이미 정해진 목록이라 순번은 `몇 번째로 닫히나`라는
 * 뜻을 갖고, 그 열에는 부를 이름이 따로 없어 머리글을 눈에서만 감춘다.
 *
 * 마감 칸은 시각만이다. 날짜는 묶음 머리가 한 번 말한다. 하한은 열이 아니다(요약의 `floorSpread`).
 * 낙찰 투찰률은 열이 아니다 — 사정률 축인 이 목록과 눈금이 다르고 행마다 서면 앵커링이라 상세로 보낸다.
 * 우리만 가진 값은 오른쪽 두 칸이다. 지난번은 개별 회차의 관측이고 보통은 코호트의 중앙값이라 갈라 둔다.
 */
const COLUMNS: readonly OpenAuctionColumn[] = [
  { id: 'rank', header: '순번', align: 'text-left', width: 'w-9', visibility: '', headerHidden: true, cell: (_row, context) => <span className={MUTED}>{context.rank}</span> },
  { id: 'closes', header: '마감', subheader: '개찰 한 시간 뒤', align: 'text-left', width: 'w-16 lg:w-24', visibility: '', cell: (row) => <span className='tabular-nums'>{row.closes.clockText}</span> },
  { id: 'organization', header: '기관', align: 'text-left', width: 'w-auto', visibility: '', wraps: true, cell: (row, context) => <OrganizationCell row={row} search={context.search} rareRates={context.rareRates} /> },
  { id: 'item', header: '품목', subheader: '저장된 라벨', align: 'text-left', width: 'lg:w-24', visibility: 'hidden lg:table-cell', cell: (row, context) => <ItemCell row={row} search={context.search} /> },
  { id: 'baseAmount', header: '기초금액', subheader: '저장된 값', align: 'text-right', width: 'lg:w-28', visibility: 'hidden lg:table-cell', cell: (row, context) => <BaseAmountCell row={row} rareRates={context.rareRates} /> },
  { id: 'participation', header: '참여', align: 'text-right', width: 'w-12 lg:w-32', visibility: '', cell: (row) => <span className='tabular-nums'>{row.bidCountText}</span> },
  { id: 'lastRound', header: '지난번', subheader: '같은 하한 직전', align: 'text-right', width: 'xl:w-40', visibility: 'hidden xl:table-cell', cell: (row) => <LastRoundCell row={row} /> },
  { id: 'median', header: '보통', subheader: '중앙값 · 표본', align: 'text-right', width: 'xl:w-24', visibility: 'hidden xl:table-cell', cell: (row) => <MedianCell row={row} /> }
];

/**
 * 묶음 머리가 걸치는 칸이다. 여덟 열을 한 칸으로 걸치면 열이 접힌 폭에서 브라우저가 보이지 않는 열의 자리를
 * 빈 열로 만들어 남는 폭을 기관 칸과 셋이 나눠 갖는다(2026-09-16 실측: 1280 여섯 칸에서 기관 67px, 오른쪽에
 * 133px 빈자리). 접힘 규칙이 같은 이웃 열끼리 걸치고 칸이 그 규칙을 그대로 받으면 열과 함께 사라진다.
 */
const HEAD_SPANS = COLUMNS.reduce<readonly { readonly visibility: string; readonly span: number }[]>((spans, column) => {
  const last = spans.at(-1);
  return last !== undefined && last.visibility === column.visibility
    ? [...spans.slice(0, -1), { ...last, span: last.span + 1 }]
    : [...spans, { visibility: column.visibility, span: 1 }];
}, []);

/** 조건을 푼 수가 서는 칸이다. 어느 폭에서나 보이는 마지막 칸이라 접힌 폭에서는 표의 오른쪽 끝이다. */
const RELEASED_SPAN = HEAD_SPANS.map((span) => span.visibility).lastIndexOf('');

/**
 * 마감일 묶음 머리다. 이 한 줄이 그 아래 행들의 날짜를 대신 말하므로 행의 마감 칸에는 시각만 남는다.
 *
 * `2건 · 7건 중`의 뒤쪽은 품목·금액을 푼 수다. 조건을 좁힌 채로도 그날 판이 얼마나 큰지 보이지 않으면
 * 사용자가 자기 조건이 무엇을 가렸는지 모른다. 셀 근거가 없는 날(달력 창 밖)은 수를 적지 않는다.
 * 날짜·요일·건수와 붙여 두면 네 값이 한 덩어리로 읽혀 `3건 13건 중`이 무엇과 무엇의 비교인지 눈이 다시
 * 짝지어야 하므로 오른쪽 칸에 따로 세운다.
 */
function DayHeadRow({ group }: { readonly group: ClosingDayGroup }) {
  const released = group.releasedCount === null ? null : <span className={`${MUTED} tabular-nums`}>{group.releasedCount}건 중</span>;
  return (
    <tr className='h-9 bg-muted/40'>
      {HEAD_SPANS.map((span, index) =>
        index === 0 ? (
          <th key={index} scope='colgroup' colSpan={span.span} className='px-2 text-left font-semibold xl:px-3'>
            <span data-slot='closes' className={`flex flex-wrap items-baseline gap-x-2 ${CLOSES_TONE[group.tone]}`}>
              <span>{group.dateText}</span>
              {group.awayText === '' ? null : <span className={MUTED}>{group.awayText}</span>}
              {group.count === null ? null : <span className='tabular-nums'>{group.count}건</span>}
              {index === RELEASED_SPAN ? <span className='ml-auto'>{released}</span> : null}
            </span>
          </th>
        ) : (
          <td key={index} colSpan={span.span} className={`px-2 text-right xl:px-3 ${span.visibility}`}>
            {index === RELEASED_SPAN ? released : null}
          </td>
        )
      )}
    </tr>
  );
}

/**
 * 행 값은 서버에서 이미 문자열로 만들어졌고 셀 안 상호작용은 링크뿐이라 이 표는 server component다.
 * 정렬·필터·페이징이 이 화면의 표에 생기기 전까지 headless 표 라이브러리를 다시 들이지 않는다 —
 * 그 순간 표 전체가 브라우저로 넘어가고 hydration 비용이 따라온다.
 *
 * 괘선을 긋지 않는다. 행을 가르는 것은 44px 높이의 리듬과 hover 면뿐이고, 날짜가 바뀌는 자리는 묶음 머리의
 * 면이 가른다. 행마다 선을 그으면 성수기 하루 백 행이 선 백 개가 되어 글자보다 선이 먼저 읽힌다.
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
    <table className='w-full table-fixed border-collapse text-[13px] font-semibold'>
      <thead>
        <tr>
          {COLUMNS.map((column) => {
            const subheader = subheaders[column.id] ?? column.subheader;
            return (
              <th
                key={column.id}
                scope='col'
                className={`px-2 py-1.5 align-bottom whitespace-nowrap text-muted-foreground xl:px-3 ${column.align} ${column.width} ${column.visibility}`}
              >
                {column.headerHidden ? <span className='sr-only'>{column.header}</span> : (
                  <span className='grid gap-0.5'>
                    <span>{column.header}</span>
                    {subheader === undefined ? null : <span className={`${MUTED} hidden lg:block`}>{subheader}</span>}
                  </span>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <DayHeadRowGroup key={group.key} group={group} search={search} rareRates={rareRates} />
        ))}
      </tbody>
    </table>
  );
}

/** 묶음 하나다. 머리 한 줄 뒤에 그 날의 행들이 온다. `tbody`를 묶음마다 두지 않는 이유는 열 폭 계산이 하나의 `tbody`를 전제하기 때문이다. */
function DayHeadRowGroup({
  group,
  search,
  rareRates
}: {
  readonly group: ClosingDayGroup;
  readonly search: TodaySearch;
  readonly rareRates: ReadonlySet<string>;
}) {
  return (
    <>
      <DayHeadRow group={group} />
      {group.rows.map((row, index) => (
        <tr key={row.auctionAttemptId} data-closes={row.closes.tone} className='h-11 hover:bg-muted/50'>
          {COLUMNS.map((column) => (
            <td
              key={column.id}
              className={`px-2 py-1 align-middle xl:px-3 ${column.align} ${column.visibility} ${column.wraps ? '' : 'whitespace-nowrap tabular-nums'}`}
            >
              {column.cell(row, { search, rank: group.firstRank + index, rareRates })}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
