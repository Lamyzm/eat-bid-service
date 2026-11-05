/** @module 책임: 업체에 시장 자리를 주는 한 command의 입력(업체·지역·품목 칸·시작일·개월 수·사유)과 끝나는 날 미리보기·거절 문구를 소유한다. */
'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import { Temporal } from '@eatbid/domain';

import { eligibilityAreaQueries } from '@/api/eligibility-areas';
import {
  AUCTION_ITEM_ATOMS,
  grantMarketSeat,
  maxMarketSeatMonths,
  type MarketSeatCommandResult,
  type MarketSeatItem,
  type MarketSeatReason,
  type OperatorWorkspace
} from '@/api/operator';
import { Label } from '@/shared/ui/label';
import { LoadingButton } from '@/shared/ui/loading-button';
import { Textarea } from '@/shared/ui/textarea';
import {
  NO_RESTRICTION_TEXT,
  REASON_OPTIONS,
  businessNumberText,
  dateText,
  marketText,
  grantLastDay,
  rejectionText
} from '@/app/(workspace)/seats/_lib/seat-text';

const NO_RESTRICTION = 'no-main-item-restriction';
const MONTHS = Array.from({ length: maxMarketSeatMonths }, (_, index) => index + 1);
const fieldClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring';

function itemOf(value: string): MarketSeatItem {
  if (value === NO_RESTRICTION) return { kind: 'no-main-item-restriction' };
  const atom = AUCTION_ITEM_ATOMS.find((candidate) => candidate === value);
  if (atom === undefined) throw new Error(`알 수 없는 품목 칸: ${value}`);
  return { kind: 'atom', atom };
}

export function GrantSeatForm({ workspaces, today }: { readonly workspaces: readonly OperatorWorkspace[]; readonly today: string }) {
  const router = useRouter();
  const id = useId();
  const areas = useQuery(eligibilityAreaQueries.list());
  const [workspaceId, setWorkspaceId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [item, setItem] = useState<string>(AUCTION_ITEM_ATOMS[0]);
  const [startDate, setStartDate] = useState(today);
  const [months, setMonths] = useState(1);
  const [reason, setReason] = useState<MarketSeatReason>('pilot');
  const [memo, setMemo] = useState('');
  const [result, setResult] = useState<MarketSeatCommandResult | null>(null);

  const regionOptions = useMemo(() => (areas.data?.groups ?? []).flatMap((group) => [group.all, ...group.parts])
    .map((area) => ({ id: area.codeValueId, label: area.label ?? `지역 코드 ${area.code}` })), [areas.data]);
  const chosen = workspaces.find((entry) => entry.workspaceId === workspaceId) ?? null;
  const lastDay = startDate === '' ? null : grantLastDay(Temporal.PlainDate.from(startDate), months);

  const grant = useMutation({
    mutationFn: () => grantMarketSeat({
      workspaceId,
      regionCodeValueId: regionId,
      item: itemOf(item),
      startDate,
      months,
      reason,
      memo: memo.trim() === '' ? undefined : memo.trim()
    }),
    onSuccess: (outcome) => {
      setResult(outcome);
      if (outcome.kind === 'saved') {
        setMemo('');
        router.refresh();
      }
    }
  });

  const messageId = `${id}-message`;
  const message = grant.isError
    ? '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
    : result?.kind === 'rejected'
      ? `저장할 수 없습니다: ${rejectionText(result.rejection)}`
      : result?.kind === 'saved'
        ? `${result.seat.workspace.name}에 ${marketText(result.seat)} 자리를 주었습니다.`
        : null;
  // 버튼이 꺼져 있으면 무엇을 더 골라야 하는지 말한다. 꺼진 이유를 모르면 운영자는 버튼이 고장 난 줄 안다.
  const missing = [workspaceId === '' ? '업체' : null, regionId === '' ? '참가제한지역' : null, startDate === '' ? '시작일' : null]
    .filter((field): field is string => field !== null);

  return (
    <form
      aria-labelledby={`${id}-title`}
      className='grid gap-4 rounded-2xl border border-border bg-card p-5'
      onSubmit={(event) => {
        event.preventDefault();
        setResult(null);
        grant.mutate();
      }}
    >
      <h2 id={`${id}-title`} className='text-[18px] font-bold'>자리 주기</h2>
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-workspace`}>업체</Label>
          <select id={`${id}-workspace`} required value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setResult(null); }} className={fieldClass}>
            <option value=''>고르세요</option>
            {workspaces.map((entry) => (
              <option key={entry.workspaceId} value={entry.workspaceId}>
                {entry.name}
              </option>
            ))}
          </select>
          {/* 자리를 주면 이 번호들이 자리 기간 동안 묶인다. 운영자가 누구의 번호를 묶는지 보고 누른다. */}
          <p className='text-[13px] text-muted-foreground'>
            {chosen === null
              ? '업체를 고르면 묶일 사업자번호가 보입니다.'
              : chosen.businessNumbers.length === 0
                ? '등록된 사업자번호가 없어 자리를 줄 수 없습니다.'
                : `묶일 사업자번호: ${chosen.businessNumbers.map(businessNumberText).join(', ')}`}
          </p>
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-region`}>참가제한지역</Label>
          <select id={`${id}-region`} required value={regionId} onChange={(event) => { setRegionId(event.target.value); setResult(null); }} className={fieldClass} disabled={areas.isPending}>
            <option value=''>{areas.isPending ? '지역을 불러오는 중' : areas.isError ? '지역을 불러오지 못했습니다' : '고르세요'}</option>
            {regionOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className='text-[13px] text-muted-foreground'>코드가 정확히 같은 지역만 같은 시장입니다. 경남 전체와 김해시는 다른 시장입니다.</p>
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-item`}>품목</Label>
          <select id={`${id}-item`} value={item} onChange={(event) => setItem(event.target.value)} className={fieldClass}>
            {AUCTION_ITEM_ATOMS.map((atom) => (
              <option key={atom} value={atom}>
                {atom}
              </option>
            ))}
            <option value={NO_RESTRICTION}>{NO_RESTRICTION_TEXT}</option>
          </select>
          {item === NO_RESTRICTION ? (
            <p className='text-[13px] text-muted-foreground'>{NO_RESTRICTION_TEXT}은 학교가 품목으로 참가를 제한하지 않은 소액 견적 공고입니다.</p>
          ) : null}
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div className='grid gap-1.5'>
            <Label htmlFor={`${id}-start`}>시작일</Label>
            <input id={`${id}-start`} type='date' required min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} className={fieldClass} />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor={`${id}-months`}>기간</Label>
            <select id={`${id}-months`} value={months} onChange={(event) => setMonths(Number(event.target.value))} className={fieldClass}>
              {MONTHS.map((count) => (
                <option key={count} value={count}>
                  {count}개월
                </option>
              ))}
            </select>
          </div>
          <p className='col-span-2 text-[14px] font-semibold tabular-nums'>
            {lastDay === null ? '시작일을 고르세요.' : `${dateText(lastDay)} 밤 12시까지 (끝나는 날 포함)`}
          </p>
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-reason`}>사유</Label>
          <select id={`${id}-reason`} value={reason} onChange={(event) => setReason(REASON_OPTIONS.find((option) => option.value === event.target.value)?.value ?? 'other')} className={fieldClass}>
            {REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${id}-memo`}>메모</Label>
          <Textarea id={`${id}-memo`} value={memo} maxLength={500} required={reason === 'other'} onChange={(event) => setMemo(event.target.value)} placeholder='예: 시범 3개월, 아버지 업체' />
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-3'>
        <LoadingButton type='submit' loading={grant.isPending} disabled={workspaceId === '' || regionId === '' || startDate === ''} aria-describedby={message === null ? undefined : messageId}>
          자리 주기
        </LoadingButton>
        {message === null && missing.length > 0 ? <p className='text-[14px] text-muted-foreground'>{missing.join('·')}을 고르세요.</p> : null}
        {message === null ? null : (
          <p id={messageId} role={result?.kind === 'saved' ? 'status' : 'alert'} className={result?.kind === 'saved' ? 'text-[14px] font-semibold' : 'text-[14px] font-semibold text-destructive'}>
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
