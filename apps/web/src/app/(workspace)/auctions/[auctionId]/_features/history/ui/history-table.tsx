/** @module 책임: 기관 회차 이력을 일반·확대 어디서나 같은 열·정렬·기록 진입으로 그린다. 열의 머리글·정렬·고정·셀을 한 열 서술에서 파생하고, 몇 행을 넘길지는 상위 composition이 정한다. */
import type { ReactNode } from 'react';

import type { HistoryRow } from '../model/attempt-history';
import { HistoryAttemptRow, HistoryRecordButton } from './history-selection';
import { HistoryTableScroll } from './history-table-scroll';
import { HistoryVerdictCell, HistoryVerdictHead } from './history-verdict';

// 열 머리는 세로로도 고정한다. 확대 집중 모드의 긴 표가 안에서 스크롤할 때 열 이름이 남아야 하고,
// 12행 표에는 세로 스크롤이 없어 보이는 차이가 없으므로 모드 boolean을 두지 않는다.
const HEAD_BASE = 'sticky top-0 border-b border-border bg-card px-2 py-2 text-[13px] font-semibold whitespace-nowrap text-muted-foreground xl:px-3';
const CELL_BASE = 'border-b border-border/60 px-2 py-2 text-[15px] whitespace-nowrap group-last/row:border-b-0 xl:px-3';

// 첫 열(개찰)은 표가 근거 열보다 넓을 때 왼쪽 끝에 고정된다. 넘칠 때만 안쪽에 그림자를 걸어 "이 밑에 열이
// 더 있다"를 알리고, 넘쳤다는 사실은 `HistoryTableScroll`이 컨테이너 attribute로 알려 준다(EAT-86).
// 고정 열이 아래 열을 덮으므로 바탕이 불투명해야 하며, 두 축이 만나는 모서리인 머리는 나머지 머리(z-20)와
// 본문 고정 셀(z-10)보다 위에 있어야 서로 덮지 않는다. 반대쪽 끝의 판정 열은 `history-verdict`가 같은 규칙으로 소유한다.
const OPENED_EDGE = 'left-0 [[data-scroll-left]_&]:shadow-[14px_0_14px_-10px_rgb(0_0_0/0.3)]';

type HistoryColumn = {
  readonly id: string;
  readonly header: string;
  /** 왼쪽 열은 사실, 오른쪽 숫자 열은 같은 자릿수로 읽히도록 tabular-nums다. */
  readonly align: 'text-left' | 'text-right';
  /** 셀의 글꼴 무게. 낙찰률만 굵게 두어 표에서 가장 먼저 읽히게 한다. */
  readonly weight: string;
  /** 양 끝에 고정되는 열만 갖는다. 머리와 셀이 같은 고정·그림자 규칙을 쓴다. */
  readonly edge?: string;
  readonly cell: (row: HistoryRow) => ReactNode;
};

/**
 * 열의 머리글·정렬·고정·셀을 한 줄에 모은다. 이 넷을 따로 둔 표로 관리하면 열 하나를 더할 때 네 곳을
 * 맞춰야 하고, 하나를 빠뜨려도 className에 `undefined`가 들어갈 뿐 조용히 지나간다.
 *
 * 그날 하한·낙찰 업체는 사용자 결정에 따라 표시 열에서 뺐다. 파생 계산인 그날 하한의 가정 비교와 관측
 * 사실인 낙찰 업체의 실제 참여 기록은 그대로 유지한다(EAT-115). 하한 아래 수 같은 내부 세부도 주 표에서
 * 걷고 오른쪽 명단 상세에서 실제 상태와 함께 읽는다.
 */
const COLUMNS: readonly HistoryColumn[] = [
  { id: 'opened', header: '개찰', align: 'text-left', weight: 'font-medium', edge: OPENED_EDGE, cell: (row) => row.openedText },
  { id: 'item', header: '품목', align: 'text-left', weight: 'font-medium', cell: (row) => row.itemLabel },
  // 축을 머리글에 적지 않으면 사정률 두 열과 투찰률 두 열이 같은 눈금으로 읽힌다. 남산초에서
  // 두 축은 최대 2.19%p 벌어지므로 이 표기는 장식이 아니라 값의 의미다(AGENTS 15, PDR-0004).
  { id: 'winRate', header: '낙찰률(사정률)', align: 'text-right', weight: 'font-semibold tabular-nums', cell: (row) => row.winRateText ?? '—' },
  { id: 'secondRate', header: '2등가(사정률)', align: 'text-right', weight: 'font-medium tabular-nums', cell: (row) => row.secondRateText ?? '—' },
  {
    id: 'list',
    header: '명단',
    align: 'text-right',
    weight: 'font-medium tabular-nums',
    cell: (row) => (
      <span className='flex items-center justify-end gap-2'>
        <span className='tabular-nums'>{row.listCount ?? '—'}</span>
        <HistoryRecordButton attemptId={row.attemptId} openedText={row.openedText} />
      </span>
    )
  }
];

/**
 * 행 값은 서버에서 이미 문자열로 만들어졌고 셀 안에서 브라우저가 필요한 것은 선택 표시·기록 진입·손잡이
 * 판정 셋뿐이라 이 표는 server component다. 그 셋은 각각 client leaf가 맡고 표 자체는 서버에 남는다.
 * 정렬·필터·가상화가 이 표에 생기기 전까지 headless 표 라이브러리를 다시 들이지 않는다 — 그 순간 표
 * 전체가 브라우저로 넘어가고 hydration 비용이 따라온다(EAT-136·EAT-139).
 *
 * 응답의 최근 → 오래된 순을 그대로 그린다. 몇 행을 넘길지(일반 12행 / 확대 누적)는 `HistoryCard`가 정하고
 * 열 클릭 정렬은 넣지 않는다. 여기서 다시 자르면 확대에서 같은 표를 쓸 수 없다(EAT-115).
 */
export function HistoryTable({ rows }: { readonly rows: readonly HistoryRow[] }) {
  // 좁은 폭에서도 열이 근거 영역 안에 들어가도록 xl 아래에서는 셀 여백을 줄인다. 그래도 넘치면 페이지가
  // 아니라 이 컨테이너만 가로로 움직이고, 첫·마지막 열은 고정돼 판정 열이 잘려 보이지 않는다.
  // border-collapse에서는 sticky 셀이 행 테두리를 끌고 가지 못해 separate로 두고 테두리를 셀에 건다.
  return (
    <HistoryTableScroll>
      <table className='w-full border-separate border-spacing-0'>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.id}
                scope='col'
                className={`${HEAD_BASE} ${column.align} ${column.edge ? `${column.edge} z-30` : 'z-20'}`}
              >
                {column.header}
              </th>
            ))}
            <HistoryVerdictHead />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <HistoryAttemptRow key={row.attemptId} attemptId={row.attemptId}>
              {COLUMNS.map((column) => (
                <td
                  key={column.id}
                  className={`${CELL_BASE} ${column.align} ${column.weight} ${column.edge ? `sticky ${column.edge} z-10 bg-card` : ''}`}
                >
                  {column.cell(row)}
                </td>
              ))}
              <HistoryVerdictCell dayFloorMilli={row.dayFloorMilli} awardedBidRateMilli={row.awardedBidRateMilli} />
            </HistoryAttemptRow>
          ))}
        </tbody>
      </table>
    </HistoryTableScroll>
  );
}
