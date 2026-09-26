/** @module 책임: 고른 회차의 명단을 조회해 낙찰 요약·사정률 띠·전체 명단 표로 보조 패널에 보여 준다. */
'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { auctionQueries } from '@/api/auctions/index';
import { Button } from '@/shared/ui/button';
import { ResponsiveDock } from '@/shared/ui/responsive-dock';
import { presentRoundRoster } from '../model/present-round-roster';
import type { RoundKey } from '../model/use-round-selection';
import { RosterRateStrip } from './roster-rate-strip';

export function RoundInspector({
  selected,
  dateText,
  floorRate,
  onClose
}: {
  readonly selected: RoundKey | null;
  /** 그림이 아는 그 회차의 개찰일이다. 명단 응답에는 날짜가 없어 부르는 쪽이 준다. */
  readonly dateText: string | null;
  /** 적용된 조건의 하한율이다. 분석 표본이 같은 하한율로 걸러져 있어 그 회차의 하한과 같다. */
  readonly floorRate: string | null;
  readonly onClose: () => void;
}) {
  return (
    <ResponsiveDock open={selected !== null} title='선택한 회차 명단' onClose={onClose}>
      {selected === null ? null : (
        <RoundRoster
          key={`${selected.attemptId}:${selected.revisionId}`}
          round={selected}
          dateText={dateText}
          floorRate={floorRate}
          onClose={onClose}
        />
      )}
    </ResponsiveDock>
  );
}

/**
 * 명단을 연 순간 초점을 패널로 옮기고, 패널 안에서 Esc를 누르면 닫는다. 넓은 화면의 패널은 모달이 아니라
 * (primitive가 그냥 section으로 둔다) 스스로 이 둘을 챙겨야 한다. 좁은 화면의 Sheet는 primitive가 챙기며,
 * 둘이 같이 닫기를 불러도 주소의 회차를 지우는 같은 일이라 겹쳐도 해가 없다.
 */
function RosterFocusScope({
  onClose,
  children
}: {
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const scope = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scope.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const element = scope.current;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      // 전체보기의 Esc보다 먼저 닫힌다. 막지 않으면 한 번 눌러 패널과 전체보기가 함께 닫힌다.
      event.preventDefault();
      onClose();
    };
    element?.addEventListener('keydown', dismiss);
    return () => element?.removeEventListener('keydown', dismiss);
  }, [onClose]);
  return (
    <div ref={scope} tabIndex={-1} className='outline-none'>
      {children}
    </div>
  );
}

function RoundRoster({
  round,
  dateText,
  floorRate,
  onClose
}: {
  readonly round: RoundKey;
  readonly dateText: string | null;
  readonly floorRate: string | null;
  readonly onClose: () => void;
}) {
  return (
    <RosterFocusScope onClose={onClose}>
      <RoundRosterBody round={round} dateText={dateText} floorRate={floorRate} />
    </RosterFocusScope>
  );
}

function RoundRosterBody({
  round,
  dateText,
  floorRate
}: {
  readonly round: RoundKey;
  readonly dateText: string | null;
  readonly floorRate: string | null;
}) {
  // 그림의 점이 그려진 revision의 명단을 읽는다. 최신 명단은 그 점이 말한 결과와 다를 수 있다(ADR 0041 §1).
  const query = useQuery(auctionQueries.roster(round.attemptId, round.revisionId));
  const heading = (
    <p className='text-sm font-semibold'>{dateText === null ? '개찰 회차' : `${dateText} 개찰`}</p>
  );
  if (query.isPending) {
    return (
      <div className='space-y-3 p-4' aria-busy='true'>
        {heading}
        <p className='text-sm text-muted-foreground'>명단을 불러오고 있어요.</p>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className='space-y-3 p-4'>
        {heading}
        <p className='text-sm'>명단을 불러오지 못했어요.</p>
        <Button type='button' variant='outline' size='sm' onClick={() => void query.refetch()}>
          다시 불러오기
        </Button>
      </div>
    );
  }
  const view = presentRoundRoster(query.data, floorRate);
  if (view.kind === 'not-observed') {
    return (
      <div className='space-y-2 p-4'>
        {heading}
        {/* 빈 명단을 0곳으로 꾸미지 않는다. 원본에 명단 블록이 없던 것과 실제 0곳을 구별할 근거가 없다. */}
        <p className='text-sm'>이 회차의 명단은 아직 수집되지 않았어요.</p>
        <p className='text-xs text-muted-foreground'>관측 {view.observedAtText}</p>
      </div>
    );
  }
  return (
    <div className='p-4'>
      {heading}
      <dl className='mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm'>
        <div className='col-span-2'>
          <dt className='text-xs text-muted-foreground'>낙찰</dt>
          <dd className='mt-0.5 flex items-baseline gap-2'>
            <span className='truncate font-semibold'>{view.winnerName ?? '낙찰 업체 미확인'}</span>
            <span className='text-xl font-semibold tabular-nums text-primary'>
              {view.winnerRateText ?? '—'}
            </span>
          </dd>
        </div>
        <div>
          <dt className='text-xs text-muted-foreground'>2순위와 차이</dt>
          <dd className='mt-0.5 tabular-nums'>{view.secondGapText ?? '미확인'}</dd>
        </div>
        <div>
          <dt className='text-xs text-muted-foreground'>명단</dt>
          <dd className='mt-0.5 tabular-nums'>
            {view.rowCount}곳
            {view.sourceRosterSize !== null && view.sourceRosterSize !== view.rowCount
              ? ` (원천 ${view.sourceRosterSize}곳)`
              : ''}
            {view.belowFloorCount === null ? '' : ` · 하한 미만 ${view.belowFloorCount}곳`}
          </dd>
        </div>
      </dl>
      <div className='mt-4'>
        <RosterRateStrip strip={view.strip} />
      </div>
      <div className='mt-3 max-h-[min(60vh,560px)] overflow-y-auto border-t border-border'>
        <table className='w-full border-collapse text-[13px]'>
          <caption className='sr-only'>이 회차 명단 {view.rowCount}곳, 순위 순</caption>
          <thead className='sticky top-0 bg-card text-xs text-muted-foreground'>
            <tr>
              <th scope='col' className='py-2 pr-2 text-left font-medium'>
                순위
              </th>
              <th scope='col' className='py-2 pr-2 text-left font-medium'>
                업체
              </th>
              <th scope='col' className='py-2 text-right font-medium'>
                사정률
              </th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.key} className='border-t border-border/60'>
                <td className='py-1.5 pr-2 align-top whitespace-nowrap tabular-nums text-muted-foreground'>
                  {row.rankText}
                </td>
                <td
                  className={`max-w-[160px] truncate py-1.5 pr-2 ${row.isWinner ? 'font-semibold text-primary' : ''}`}
                >
                  {row.supplierName}
                  {row.isWinner ? <span className='ml-1 text-xs'>낙찰</span> : null}
                  <span className='block text-[11px] font-normal text-muted-foreground tabular-nums'>
                    {row.amountText}
                  </span>
                </td>
                <td
                  className={`py-1.5 text-right align-top tabular-nums ${row.belowFloor === true ? 'text-destructive' : ''}`}
                >
                  {row.rateText}
                  {/* 색만으로 전하지 않는다. 하한 미만은 글로도 적는다. */}
                  {row.belowFloor === true ? (
                    <span className='ml-1 text-[11px]'>하한 미만</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className='mt-3 text-xs text-muted-foreground'>명단 관측 {view.observedAtText}</p>
    </div>
  );
}
