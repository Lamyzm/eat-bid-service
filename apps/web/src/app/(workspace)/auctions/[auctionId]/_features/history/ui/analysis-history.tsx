/** @module 책임: 그림과 같은 조건의 전체 개찰 이력을 이 기관·비교 전체 두 목록으로 이어 읽고, 줄을 고르면 회차 선택을 알린다. */
'use client';
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult
} from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type {
  AnalysisFilterValue,
  AnalysisHistoryV1Response
} from '@eatbid/contracts/api/v1/analysis';
import {
  analysisHistoryConditionOf,
  analysisQueries,
  isAnalysisSnapshotChangedError
} from '@/api/analysis/index';
import { Button } from '@/shared/ui/button';
import { presentHistoryRow, type HistoryRowView } from '../model/present-history';

type Population = 'target' | 'comparison';

export function AnalysisHistory({
  filter,
  organizationLabel,
  comparisonLabel,
  selectedAttemptId,
  onSelectRow
}: {
  readonly filter: AnalysisFilterValue;
  readonly organizationLabel: string;
  readonly comparisonLabel: string;
  readonly selectedAttemptId: string | null;
  readonly onSelectRow: (row: { readonly attemptId: string; readonly revisionId: string }) => void;
}) {
  const [population, setPopulation] = useState<Population>('target');
  const condition = useMemo(() => analysisHistoryConditionOf(filter), [filter]);
  const options = analysisQueries.history(condition, population);
  const query = useInfiniteQuery(options);
  const client = useQueryClient();
  /*
   * 다시 읽기는 첫 페이지부터다. 받아 둔 페이지를 그대로 다시 물으면 옛 build를 되돌려 보내 같은 409를 또
   * 받는다. 항목을 비우고 처음부터 읽어야 새 build 하나로 목록이 다시 선다.
   */
  const restart = () => void client.resetQueries({ queryKey: options.queryKey });
  const rows = useMemo(
    () =>
      (query.data?.pages ?? []).flatMap((page) =>
        page.rows.map((row) => presentHistoryRow(row, filter.dateBasis))
      ),
    [query.data, filter.dateBasis]
  );
  const total = query.data?.pages[0]?.meta.totalCount ?? null;
  return (
    <>
      <div className='analysis-history-heading'>
        <h2 className='text-xl font-semibold tracking-tight'>전체 개찰 이력</h2>
        <p className='mt-2 text-xs leading-relaxed text-muted-foreground'>
          위 그림과 같은 조건의 개찰 회차예요. 차트 눈금 밖 기록도 들어 있어요. 줄을 누르면 그
          회차의 명단이 열려요.
        </p>
        <div
          className='mt-4 flex flex-wrap items-center gap-2'
          role='group'
          aria-label='이력 목록 고르기'
        >
          {(
            [
              ['target', organizationLabel],
              ['comparison', comparisonLabel]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type='button'
              aria-pressed={population === value}
              onClick={() => setPopulation(value)}
              className='rounded-md border border-border px-3 py-1.5 text-sm aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-accent-foreground'
            >
              {label}
            </button>
          ))}
          <span className='text-xs text-muted-foreground tabular-nums'>
            {total === null
              ? ''
              : `${total.toLocaleString('ko-KR')}건 중 ${rows.length.toLocaleString('ko-KR')}건`}
          </span>
        </div>
      </div>
      <HistoryBody
        query={query}
        rows={rows}
        population={population}
        selectedAttemptId={selectedAttemptId}
        onSelectRow={onSelectRow}
        restart={restart}
      />
    </>
  );
}

function HistoryBody({
  query,
  rows,
  population,
  selectedAttemptId,
  onSelectRow,
  restart
}: {
  readonly query: UseInfiniteQueryResult<InfiniteData<AnalysisHistoryV1Response>, Error>;
  readonly restart: () => void;
  readonly rows: readonly HistoryRowView[];
  readonly population: Population;
  readonly selectedAttemptId: string | null;
  readonly onSelectRow: (row: { readonly attemptId: string; readonly revisionId: string }) => void;
}) {
  if (query.isPending) {
    return (
      <p className='analysis-history-note' aria-busy='true'>
        이력을 불러오고 있어요.
      </p>
    );
  }
  if (query.isError && rows.length === 0) {
    return (
      <div className='analysis-history-note'>
        <p>이력을 불러오지 못했어요.</p>
        <Button type='button' variant='outline' size='sm' onClick={restart}>
          다시 불러오기
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <p className='analysis-history-note'>
        이 조건의 개찰 회차가 없어요. 기간을 넓히거나 조건을 풀어 보세요.
      </p>
    );
  }
  const showOrganization = population === 'comparison';
  return (
    <>
      <div className='analysis-history-scroll'>
        <table className='analysis-history-table'>
          <caption className='sr-only'>
            선택 조건의 전체 개찰 이력, 최신순. 줄의 단추로 그 회차 명단을 연다
          </caption>
          <thead>
            <tr>
              <th scope='col'>개찰일</th>
              <th scope='col'>{showOrganization ? '기관·품목' : '품목'}</th>
              <th scope='col'>낙찰 사정률</th>
              <th scope='col'>2순위 차</th>
              <th scope='col'>낙찰 업체</th>
              <th scope='col'>명단</th>
              <th scope='col'>기초금액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.attemptId} data-selected={row.attemptId === selectedAttemptId}>
                <td className='tabular-nums'>
                  {/* 줄 전체가 아니라 단추 하나가 명단을 연다. 키보드와 읽기 도구가 같은 조작에 닿는다. */}
                  <button
                    type='button'
                    className='analysis-history-open'
                    aria-current={row.attemptId === selectedAttemptId ? 'true' : undefined}
                    onClick={() => onSelectRow(row)}
                  >
                    {row.dateText}
                    <span className='sr-only'> 명단 열기</span>
                  </button>
                </td>
                <td>
                  {showOrganization ? (
                    <span className='block truncate font-medium'>{row.organizationText}</span>
                  ) : null}
                  <span className='text-muted-foreground'>{row.itemText}</span>
                </td>
                <td className='tabular-nums font-semibold'>{row.rateText}</td>
                <td className='tabular-nums text-muted-foreground'>{row.secondGapText}</td>
                <td className='truncate'>{row.winnerText}</td>
                <td className='tabular-nums'>{row.listText}</td>
                <td className='tabular-nums'>{row.baseAmountText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className='analysis-history-list' aria-label='전체 개찰 이력, 최신순'>
        {rows.map((row) => (
          <li key={row.attemptId} data-selected={row.attemptId === selectedAttemptId}>
            <button
              type='button'
              aria-current={row.attemptId === selectedAttemptId ? 'true' : undefined}
              aria-label={`${row.dateText} 낙찰 ${row.rateText}, ${row.listText}. 명단 열기`}
              onClick={() => onSelectRow(row)}
            >
              <span className='flex items-baseline justify-between gap-3'>
                <span className='tabular-nums text-muted-foreground'>{row.dateText}</span>
                <span className='text-base font-semibold tabular-nums'>{row.rateText}</span>
              </span>
              <span className='mt-1 flex items-baseline justify-between gap-3 text-xs text-muted-foreground'>
                <span className='truncate'>
                  {showOrganization ? `${row.organizationText} · ` : ''}
                  {row.itemText} · {row.winnerText}
                </span>
                <span className='shrink-0 tabular-nums'>{row.listText}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className='analysis-history-more'>
        {isAnalysisSnapshotChangedError(query.error) ? (
          // 기준 build가 바뀌면 이어 읽을 수 없다. 두 기준의 줄을 섞지 않고 처음부터 다시 읽게 한다.
          <>
            <span className='text-xs text-muted-foreground'>
              자료가 새로 발행돼 이어 볼 수 없어요.
            </span>
            <Button type='button' variant='outline' size='sm' onClick={restart}>
              처음부터 다시 불러오기
            </Button>
          </>
        ) : query.hasNextPage ? (
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? '불러오는 중' : '더 보기'}
          </Button>
        ) : null}
      </div>
    </>
  );
}
