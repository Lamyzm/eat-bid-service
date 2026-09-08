/** @module 책임: 선택한 과거 회차의 관측 명단과 정확한 금액·비율·판정을 접을 수 있는 상세 영역으로 보여준다. */
'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import type { AuctionRosterV1Response } from '@eatbid/contracts/api/v1/auctions';
import { CODE_SCHEME_NAMES } from '@eatbid/contracts/atoms/code-scheme-names';
import { auctionQueries } from '@/api/auctions';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import type { HistoryRow } from '../_model/attempt-history';
import { useAttemptSelection } from './attempt-selection';
import { ResponsiveDock } from '@/shared/ui/responsive-dock';
import { DecisionTools } from './decision-tools';

/** 현재 공고의 보조 정보와 선택 회차 명단이 같은 rail을 사용하도록 기존 명단 컴포넌트를 배치한다. */
export function SelectedAttemptRail({ fallback }: { readonly fallback: ReactNode }) {
  const { row, panel, close, returnFocus } = useAttemptSelection();
  return (
    <div data-slot='decision-dock' data-open={panel !== null || undefined}>
      <ResponsiveDock
        open={panel !== null}
        title={panel === 'record' ? '선택 회차 기록' : '현재 공고 정보'}
        onClose={close}
        returnFocus={returnFocus}
      >
        <div hidden={panel !== 'current'}>{fallback}</div>
        {row && panel === 'record' ? (
          <AuctionRosterPanel
            key={row.attemptId}
            row={row}
            onClose={close}
            showCloseButton={false}
          />
        ) : null}
      </ResponsiveDock>
      <DecisionTools placement='rail' />
    </div>
  );
}

function withdrawalText(value: AuctionRosterV1Response['rows'][number]['withdrawal']): string {
  if (value === null) return '미확인';
  // 검토된 eaT WITHDRAWAL_YN 코드만 번역한다. 낙찰 상태와 독립이며 미관측을 N으로 메우지 않는다.
  if (value.scheme === CODE_SCHEME_NAMES.withdrawalFlag) {
    if (value.code === 'Y') return '철회';
    if (value.code === 'N') return '철회 아님';
  }
  return value.label ?? '미확인';
}

function amountText(value: string): string {
  const [whole, fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined || fraction === '00' ? grouped : `${grouped}.${fraction}`;
}
export function AuctionRosterPanel({
  row,
  onClose,
  showCloseButton = true
}: {
  readonly row: HistoryRow;
  readonly onClose: () => void;
  readonly showCloseButton?: boolean;
}) {
  const query = useQuery(auctionQueries.roster(row.attemptId));
  const data = query.data;
  const panel = useRef<HTMLElement>(null);
  // rail이 회차 ID를 key로 사용하므로 새로운 상세를 열 때만 포커스를 옮기고 재조회는 읽기를 방해하지 않는다.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const element = panel.current;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    element?.addEventListener('keydown', dismiss);
    return () => element?.removeEventListener('keydown', dismiss);
  }, [onClose]);
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className='p-3 focus-visible:outline-2 focus-visible:outline-primary'
      aria-label='선택 회차 참여 기록'
    >
      <div className='flex items-start justify-between gap-3'>
        <div>
          <p className='mb-1 text-xs text-muted-foreground'>선택한 과거 회차</p>
          <h3 className='text-base font-semibold'>참여 기록</h3>
          <p className='mt-1 text-xs text-muted-foreground'>
            {row.openedText} · {row.itemLabel} · 회차 {row.attemptId}
          </p>
        </div>
        {showCloseButton ? (
          <Button variant='ghost' size='sm' onClick={onClose}>
            닫기
          </Button>
        ) : null}
      </div>
      {query.isPending ? (
        <p className='py-6 text-sm' role='status'>
          참여 기록을 불러오고 있어요.
        </p>
      ) : null}
      {query.isError ? (
        <div className='flex items-center gap-3 py-6' role='alert'>
          <p className='text-sm'>참여 기록을 불러오지 못했어요.</p>
          <Button variant='outline' size='sm' onClick={() => query.refetch()}>
            다시 불러오기
          </Button>
        </div>
      ) : null}
      {data ? (
        <>
          <div className='my-4 flex flex-wrap gap-x-6 gap-y-2 text-sm'>
            <span>
              참여 기록 <strong>{data.meta.rowCount}건</strong>
            </span>
            <span>
              낙찰값{' '}
              <strong className='tabular-nums'>
                {data.award ? `${data.award.bidRate.value}%` : '—'}
              </strong>
            </span>
            <span>
              2등 값{' '}
              <strong className='tabular-nums'>
                {data.award?.secondRate ? `${data.award.secondRate.value}%` : '—'}
              </strong>
            </span>
          </div>
          <p className='mb-3 text-xs text-muted-foreground'>
            비율은 예정가격 대비이며, 순위와 결과는 해당 회차의 기록입니다.
          </p>
          {data.state === 'not-observed' ? (
            <p className='py-6 text-sm'>아직 확인된 참여 기록이 없어요.</p>
          ) : (
            <div>
              <Table className='table-fixed text-[13px]'>
                <colgroup>
                  <col className='w-[42%]' />
                  <col className='w-[23%]' />
                  <col className='w-[35%]' />
                </colgroup>
                <TableHeader className='bg-card'>
                  <TableRow>
                    <TableHead className='px-1 text-xs'>순위·업체</TableHead>
                    <TableHead className='px-1 text-right text-xs whitespace-normal'>
                      예정가격 대비 (%)
                    </TableHead>
                    <TableHead className='px-1 text-right text-xs'>제출금액</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((submission) => (
                    <TableRow
                      key={submission.submissionId}
                      data-state={
                        data.award?.rosterOrdinal === submission.rosterOrdinal
                          ? 'selected'
                          : undefined
                      }
                    >
                      <TableCell className='px-1 py-3 whitespace-normal'>
                        <span className='font-medium break-keep wrap-anywhere'>
                          {submission.rank === null ? '순위 미확인' : `${submission.rank}위`} ·{' '}
                          {submission.supplier.name ?? '업체명 미확인'}
                        </span>
                        <div className='mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground'>
                          <span>{submission.sourceStatus.label ?? '상태 미확인'}</span>
                          <span aria-label='철회 여부'>
                            {withdrawalText(submission.withdrawal)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className='px-1 text-right tabular-nums'>
                        {submission.bidRate.value}
                      </TableCell>
                      <TableCell className='px-1 text-right tabular-nums'>
                        {submission.submittedAmount
                          ? `${amountText(submission.submittedAmount.amount)} ${submission.submittedAmount.currency === 'KRW' ? '원' : submission.submittedAmount.currency}`
                          : '미확인'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
