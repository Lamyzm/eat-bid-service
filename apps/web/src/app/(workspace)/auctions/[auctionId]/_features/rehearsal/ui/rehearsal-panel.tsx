/** @module 책임: 손잡이가 가리키는 값을 선택 품목의 과거 회차에 적용한 "이 값이면" 결과와, 그 아래 접힌 "이 학교와 내 기록" 기관 요약·내 기록 슬롯을 레일 안에 보인다. */
'use client';

import { useState } from 'react';

import type { HistoryRow } from '../../history/model/attempt-history';
import { summarizeOrganization } from '../model/organization-summary';
import { rehearse, type Rehearsal } from '../model/rehearsal';
import { NO_RATE_PHRASE, REHEARSAL_PHRASE } from '../model/verdict-vocabulary';
import { useBidRate } from '../../../_lib/bid-rate-context';

// 칸 하나가 회차 하나다. 이보다 많아지면 칸이 1px 아래로 뭉개져 세는 뜻을 잃으므로 비율 막대로 바꾼다.
const CELL_LIMIT = 24;

// 값은 16px, 그 뒤 분모·비율 같은 꼬리만 13px muted다. 라벨을 13px로 내리지 않는다.
function StatRow({
  label,
  sub,
  value,
  tail,
  tone
}: {
  readonly label: string;
  readonly sub?: string;
  readonly value: string;
  readonly tail?: string;
  readonly tone?: string;
}) {
  return (
    <div className='grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-t border-border py-[11px]'>
      <span className='flex min-w-0 flex-col gap-px'>
        <span className='text-[15px] font-semibold'>{label}</span>
        {sub ? <span className='text-[15px] font-medium whitespace-nowrap text-muted-foreground'>{sub}</span> : null}
      </span>
      <span className={`text-[16px] font-semibold tabular-nums whitespace-nowrap ${tone ?? ''}`}>
        {value}
        {tail ? <span className='text-[13px] font-semibold text-muted-foreground'> {tail}</span> : null}
      </span>
    </div>
  );
}

// 칸 스트립은 바로 위 행이 이미 숫자로 읽어 준 값을 그림으로 되풀이한다. 보조기술에는 칸 수십 개가
// 의미 없는 잡음이라 감춘다.
function WonCells({ wonFlags }: { readonly wonFlags: readonly boolean[] }) {
  return (
    <div aria-hidden='true' className='flex gap-[3px] pb-2'>
      {wonFlags.map((won, index) => (
        <span key={index} className={`h-2.5 flex-1 rounded-sm ${won ? 'bg-primary' : 'bg-border'}`} />
      ))}
    </div>
  );
}

function WonYears({ byYear, won, total }: { readonly byYear: Rehearsal['byYear']; readonly won: number; readonly total: number }) {
  return (
    <div className='grid gap-1 pb-2'>
      <div className='h-2.5 overflow-hidden rounded-sm bg-border'>
        <span className='block h-2.5 bg-primary' style={{ width: `${(won / total) * 100}%` }} />
      </div>
      {byYear.map((bucket) => (
        <div key={bucket.year} className='grid grid-cols-[44px_1fr_72px] items-center gap-x-3'>
          <span className='text-[13px] font-semibold text-muted-foreground'>{bucket.year}</span>
          <span className='block h-1.5 overflow-hidden rounded-sm bg-border'>
            <span className='block h-1.5 bg-primary' style={{ width: `${bucket.total === 0 ? 0 : (bucket.won / bucket.total) * 100}%` }} />
          </span>
          <span className={`text-right text-[15px] font-semibold tabular-nums ${bucket.won > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
            {bucket.won} <span className='text-[13px] font-medium text-muted-foreground'>/ {bucket.total}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// 기관 요약은 손잡이 값과 무관한 사실이라 값이 없어도 보인다. 내 기록은 인증(EAT-47) 전에는 누구의
// 기록인지 알 수 없으므로 숫자 대신 빈 슬롯만 둔다. 접힘은 한 단계다 — 두 번 접히면 어디까지 열렸는지 잊는다.
function OrganizationDetails({ rows }: { readonly rows: readonly HistoryRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeOrganization(rows);
  const none = 'text-muted-foreground';

  return (
    <div className='flex flex-col'>
      <button
        type='button'
        aria-expanded={expanded}
        aria-controls='rehearsal-organization-details'
        onClick={() => setExpanded((value) => !value)}
        className='flex h-11 items-center justify-between border-t border-border text-[15px] font-semibold'
      >
        <span>{expanded ? '접기' : '이 학교와 내 기록 더 보기'}</span>
        <span aria-hidden='true' className='text-[13px] font-semibold text-muted-foreground'>{expanded ? '⌃' : '⌄'}</span>
      </button>
      {/* 접힌 동안은 DOM에도 두지 않는다. 숨긴 채 두면 "값 없음" 상태의 레일에 세어 놓은 숫자가 남아 있게 된다. */}
      {expanded ? (
        <div id='rehearsal-organization-details' className='flex flex-col'>
          <span className='pt-1 pb-1 text-[15px] font-semibold'>이 학교</span>
          <StatRow label='누적 회차' sub='이 품목 · 받아 온 개찰 회차' value={`${summary.rounds}회`} />
          <StatRow
            label='최근 낙찰'
            sub={summary.latestWin ? `${summary.latestWin.openedText} 개찰` : '관측된 낙찰률 없음'}
            value={summary.latestWin ? summary.latestWin.rateText : '기록 없음'}
            // 레일 손잡이는 투찰률인데 이 값은 사정률이다. 축 이름을 붙여야 두 숫자를 바로 견주지 않는다(PDR-0004).
            tail={summary.latestWin ? '사정률' : undefined}
            tone={summary.latestWin ? undefined : none}
          />
          <StatRow
            label='발주 주기'
            sub='개찰일 간격의 가운데값'
            value={summary.cadenceDays === null ? '기록 없음' : `보통 ${summary.cadenceDays}일`}
            tail={summary.cadenceDays === null ? undefined : '마다'}
            tone={summary.cadenceDays === null ? none : undefined}
          />
          <span className='pt-1 pb-1 text-[15px] font-semibold'>내 기록</span>
          <StatRow label='이 학교에 낸 값' sub='사업자 인증 뒤에 붙습니다' value='기록 없음' tone={none} />
        </div>
      ) : null}
    </div>
  );
}

export function RehearsalPanel({ rows }: { readonly rows: readonly HistoryRow[] }) {
  const { rate } = useBidRate();
  // 값이 없으면 세지 않는다. 어떤 값으로든 대신 세어 보이면 그 값이 추천값이 된다(AGENTS 8, EAT-84).
  const result = rate === null ? null : rehearse(rows, rate);
  const byCells = result !== null && result.total <= CELL_LIMIT;

  return (
    <div className='flex flex-col'>
      <span className='pt-1 pb-1 text-[15px] font-semibold'>이 값이면</span>
      {result === null ? (
        <p className='flex flex-col gap-px pb-2 text-[15px]'>
          <span className='font-semibold text-muted-foreground'>{NO_RATE_PHRASE.panel.text}</span>
          <span className='font-medium text-muted-foreground'>{NO_RATE_PHRASE.panel.sub}</span>
        </p>
      ) : result.total === 0 ? (
        <p className='pb-2 text-[15px] font-medium text-muted-foreground'>비교할 회차가 없습니다</p>
      ) : (
        <>
          {/* 판정어는 verdict-vocabulary가 소유한다. 소스에 없는 판정(무효 등)을 여기서 만들지 않는다(PDR-0002). */}
          <StatRow
            label={`지난 ${result.total}회 중 ${REHEARSAL_PHRASE.won.text}`}
            sub={REHEARSAL_PHRASE.won.sub}
            value={`${result.won}회`}
            // 칸 스트립은 칸을 세면 비율이 보이지만 비율 막대는 그렇지 않아 숫자로 함께 말한다.
            tail={byCells ? undefined : `${Math.round((result.won / result.total) * 100)}%`}
            tone='text-primary'
          />
          {byCells ? <WonCells wonFlags={result.wonFlags} /> : <WonYears byYear={result.byYear} won={result.won} total={result.total} />}
          {result.belowDayFloor > 0 ? (
            <StatRow
              label={REHEARSAL_PHRASE.belowDayFloor.text}
              sub={REHEARSAL_PHRASE.belowDayFloor.sub}
              value={`${result.belowDayFloor}회`}
              // 낙찰 행과 같은 분모를 명시한다. 두 행이 다른 기간을 말하는 것처럼 읽히면 안 된다.
              tail={`${result.total}회 중`}
              tone='text-destructive'
            />
          ) : null}
          <StatRow
            label='보통 참여 업체'
            sub='그 회차에 참여한 업체 수'
            value={result.usualListCount === null ? '기록 없음' : `${result.usualListCount}곳`}
            tone={result.usualListCount === null ? 'text-muted-foreground' : undefined}
          />
          {/* 낙찰값 이하였을 회차 중 낙찰값이 0.1%p 안에 붙어 있던 회차. 분모는 바로 위 낙찰 행의 값이다. */}
          <StatRow
            label={REHEARSAL_PHRASE.nearAbove.text}
            sub={REHEARSAL_PHRASE.nearAbove.sub}
            value={`${result.nearAbove}회`}
            tail={`${result.won}회 중`}
            tone={result.nearAbove === 0 ? 'text-muted-foreground' : undefined}
          />
        </>
      )}
      <OrganizationDetails rows={rows} />
    </div>
  );
}
