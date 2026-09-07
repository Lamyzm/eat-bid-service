/** @module 책임: 선택한 과거 회차의 관측 명단과 정확한 금액·비율·판정을 접을 수 있는 상세 영역으로 보여준다. */
'use client';

import { useQuery } from '@tanstack/react-query';
import type { AuctionRosterV1Response } from '@eatbid/contracts/api/v1/auctions';
import { auctionQueries } from '@/api/auctions';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import type { HistoryRow } from '../_model/attempt-history';

function withdrawalText(value: AuctionRosterV1Response['rows'][number]['withdrawal']): string {
  if (value === null) return '미확인';
  // 검토된 eaT WITHDRAWAL_YN 코드만 번역한다. 낙찰 상태와 독립이며 미관측을 N으로 메우지 않는다.
  if (value.scheme === 'eat:withdrawal-flag') {
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
export function AuctionRosterPanel({ row, onClose }: {
  readonly row: HistoryRow;
  readonly onClose: () => void;
}) {
  const query = useQuery(auctionQueries.roster(row.attemptId));
  const data = query.data;
  return (
    <section className='border-t border-border p-4' aria-label='선택 회차 참여 기록'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <h3 className='text-lg font-semibold'>참여 기록</h3>
          <p className='mt-1 text-sm text-muted-foreground'>{row.openedText} · {row.itemLabel}</p>
        </div>
        <Button variant='ghost' size='sm' onClick={onClose}>닫기</Button>
      </div>
      {query.isPending ? <p className='py-6 text-sm' role='status'>참여 기록을 불러오고 있어요.</p> : null}
      {query.isError ? (
        <div className='flex items-center gap-3 py-6' role='alert'>
          <p className='text-sm'>참여 기록을 불러오지 못했어요.</p>
          <Button variant='outline' size='sm' onClick={() => query.refetch()}>다시 불러오기</Button>
        </div>
      ) : null}
      {data ? (
        <>
          <div className='my-4 flex flex-wrap gap-x-6 gap-y-2 text-sm'>
            <span>참여 기록 <strong>{data.meta.rowCount}건</strong></span>
            <span>낙찰값 <strong className='tabular-nums'>{data.award ? `${data.award.bidRate.value}%` : '—'}</strong></span>
            <span>2등 값 <strong className='tabular-nums'>{data.award?.secondRate ? `${data.award.secondRate.value}%` : '—'}</strong></span>
          </div>
          <p className='mb-3 text-xs text-muted-foreground'>비율은 예정가격 대비이며, 순위와 결과는 해당 회차의 기록입니다.</p>
          {data.state === 'not-observed' ? (
            <p className='py-6 text-sm'>아직 확인된 참여 기록이 없어요.</p>
          ) : (
            <div className='max-h-[28rem] overflow-auto rounded-lg border border-border'>
              <Table>
                <TableHeader className='sticky top-0 z-10 bg-card'>
                  <TableRow>
                    <TableHead>순위</TableHead><TableHead>업체</TableHead>
                    <TableHead className='text-right'>제출금액</TableHead>
                    <TableHead className='text-right'>예정가격 대비 (%)</TableHead><TableHead>결과</TableHead><TableHead>철회 여부</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((submission) => (
                    <TableRow key={submission.submissionId} data-state={data.award?.rosterOrdinal === submission.rosterOrdinal ? 'selected' : undefined}>
                      <TableCell className='tabular-nums'>{submission.rank ?? '—'}</TableCell>
                      <TableCell className='font-medium'>{submission.supplier.name ?? '업체명 미확인'}</TableCell>
                      <TableCell className='text-right tabular-nums'>{submission.submittedAmount
                        ? `${amountText(submission.submittedAmount.amount)} ${submission.submittedAmount.currency === 'KRW' ? '원' : submission.submittedAmount.currency}`
                        : '미확인'}</TableCell>
                      <TableCell className='text-right tabular-nums'>{submission.bidRate.value}</TableCell>
                      <TableCell>{submission.sourceStatus.label ?? '상태 미확인'}</TableCell>
                      <TableCell>{withdrawalText(submission.withdrawal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <details className='mt-4 text-xs text-muted-foreground'>
            <summary className='cursor-pointer'>자료 정보</summary>
            <div className='mt-2 grid gap-1 break-all'>
              <div>원천 관측 시각: <time dateTime={data.meta.observedAt}>{data.meta.observedAt}</time></div>
              <div>관측된 공고 참여 수: {data.meta.sourceRosterSize ?? '미확인'}</div>
              <div>회차 {data.auctionId} · 기록 {data.revisionId}</div>
              <div>원본 확인값: {data.meta.provenance.contentSha256}</div>
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}
