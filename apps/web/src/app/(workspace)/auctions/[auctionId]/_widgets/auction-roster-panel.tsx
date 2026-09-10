/** @module 책임: 선택한 과거 회차의 관측 명단과 정확한 금액·비율·판정을 접을 수 있는 상세 영역으로 보여준다. */
'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { AuctionRosterV1Response } from '@eatbid/contracts/api/v1/auctions';
import { CODE_SCHEME_NAMES } from '@eatbid/contracts/atoms/code-scheme-names';
import { auctionQueries } from '@/api/auctions/index';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import type { AttemptKey } from '../_features/history/model/attempt-history';

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
  attempt,
  onClose,
  showCloseButton = true
}: {
  /** 표·차트가 이미 그린 행이 아니라 그 회차의 열쇠와 이름만 받는다(EAT-139). */
  readonly attempt: AttemptKey;
  readonly onClose: () => void;
  readonly showCloseButton?: boolean;
}) {
  // 표와 차트가 읽은 요약의 revision을 그대로 전달한다. null이면 서버가 opt-in을 무시한 응답이라 최신 명단으로
  // 추정하지 않고 확인 불가로 닫는다(ADR 0041 §1). 최신 명단은 그 요약이 말한 회차 결과와 다를 수 있다.
  const query = useQuery({
    ...auctionQueries.roster(attempt.attemptId, attempt.revisionId ?? undefined),
    enabled: attempt.revisionId !== null
  });
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
            {attempt.openedText} · {attempt.itemLabel} · 회차 {attempt.attemptId}
          </p>
        </div>
        {showCloseButton ? (
          <Button variant='ghost' size='sm' onClick={onClose}>
            닫기
          </Button>
        ) : null}
      </div>
      {attempt.revisionId === null ? (
        <p className='py-6 text-sm' role='alert'>
          회차 해석을 확인하지 못해 기록을 열 수 없습니다. 화면을 새로 열어 주세요.
        </p>
      ) : query.isPending ? (
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
                          {/* 맨 span은 role이 generic이라 aria-label이 무시되고, 역할을 줘 이름을 살리면 그 이름이
                              "철회 아님"이라는 값 자체를 덮는다. 어느 항목인지는 값 앞의 sr-only 문구로 말한다.
                              값과 같은 span에 넣지 않아야 값 문구가 그대로 남는다. */}
                          <span className='sr-only'>철회 여부</span>
                          <span>
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
