/** @module 책임: 흐름 차트 위에서 내 투찰 사업자 선택과 조회 상태를 사용자 문장으로 말하고 build 전환에서 latest 전환·재시도 진입을 제공한다. */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { RegisteredBusiness } from '@/api/account/index';
import { businessNumberDisplay } from '@/shared/lib/business-number-display';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/shared/ui/dropdown-menu';
import { IconSelector } from '@/shared/ui/workspace-icons';
import { loginRouteWithReturn, setupRouteWithReturn } from '@/shell/auth/return-path';
import type { DecisionSearch } from '../../../_lib/decision-search-params';
import { ownSummaryText } from '../model/own-bid-points';
import { BuildRecovery } from '../../history/ui/history-build-recovery';
import { useOptionalOwnBid, type OwnBidStatus, type OwnBidValue } from '../model/own-bid-context';

const linkClass = 'inline-flex h-8 items-center rounded-md bg-primary/10 px-2.5 font-semibold whitespace-nowrap text-primary';

function BusinessPicker({ ownBid }: { readonly ownBid: OwnBidValue }) {
  const selected = ownBid.businesses.find((business) => business.businessId === ownBid.selectedBusinessId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant='outline' size='sm' data-slot='own-bid-business' />}
        aria-label='내 투찰 사업자 선택'
      >
        {selected ? businessNumberDisplay(selected.businessNumber) : '사업자 선택'}
        <IconSelector className='size-4' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-52'>
        {/* Base UI의 group label은 Group·RadioGroup 안에서만 산다. 밖에 두면 메뉴를 여는 순간 route 오류 경계로 떨어진다. */}
        {/* 선택이 없을 때도 빈 문자열로 controlled를 유지한다. undefined로 시작하면 첫 선택에서 Base UI가 uncontrolled→controlled 전환을 경고한다. */}
        <DropdownMenuRadioGroup value={ownBid.selectedBusinessId ?? ''} onValueChange={(value) => ownBid.select(String(value))}>
          <DropdownMenuLabel>내 투찰을 볼 사업자</DropdownMenuLabel>
          {ownBid.businesses.map((business: RegisteredBusiness) => (
            // 사업자 하나를 고르는 순간 메뉴를 닫는다. radio 항목의 기본값은 열어 두는 것이라 뒤 캔버스 조작이 막힌다.
            <DropdownMenuRadioItem key={business.businessId} value={business.businessId} closeOnClick>
              {businessNumberDisplay(business.businessNumber)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 문구는 사용자가 할 일과 실패만 말한다. 내부 상태(초기화·워크스페이스·캐시·build id)를 설명하지 않고,
 * "명단 미관측"을 "미참여"로 바꿔 말하지 않는다(apps/web AGENTS, AGENTS 3).
 */
function StatusLine({
  status,
  ownBid,
  auctionId,
  search,
  pathname
}: {
  readonly status: OwnBidStatus;
  readonly ownBid: OwnBidValue;
  readonly auctionId: string;
  readonly search: DecisionSearch;
  readonly pathname: string;
}) {
  switch (status.kind) {
    case 'signed-out':
      return (
        <>
          <span>로그인하면 내 투찰을 볼 수 있어요</span>
          <Link href={loginRouteWithReturn(pathname)} className={linkClass}>Google로 로그인</Link>
        </>
      );
    case 'checking':
      return <span role='status'>내 투찰 확인 중</span>;
    case 'loading':
      return <span role='status'>내 투찰 불러오는 중</span>;
    case 'auth-unavailable':
      return <span>지금은 내 투찰을 확인할 수 없어요</span>;
    case 'uninitialized':
    case 'no-businesses':
      return (
        <>
          <span>사업자를 등록하면 내 투찰을 볼 수 있어요</span>
          <Link href={setupRouteWithReturn(pathname)} className={linkClass}>내 사업자 설정</Link>
        </>
      );
    case 'select-business':
      return <span>사업자를 고르면 내 투찰을 표시해요</span>;
    case 'history-not-ready':
      return <span>회차 이력을 아직 준비하지 못해 내 투찰을 표시할 수 없어요</span>;
    case 'observed': {
      const selected = ownBid.businesses.find((business) => business.businessId === ownBid.selectedBusinessId);
      return (
        <>
          {ownBid.businesses.length === 1 && selected ? <span className='font-semibold text-foreground'>{businessNumberDisplay(selected.businessNumber)}</span> : null}
          <span data-slot='own-bid-summary'>{ownSummaryText(status.summary)}</span>
        </>
      );
    }
    case 'unobserved':
      return <span>수집 원본에 아직 이 번호가 없어 표시할 기록이 없어요</span>;
    case 'evidence-conflict':
      return <span>이 번호가 서로 다른 두 업체를 가리켜 내 투찰을 판정할 수 없어요</span>;
    case 'build-changed':
      return <BuildRecovery auctionId={auctionId} search={search} subject='내 투찰' />;
    case 'error':
      return (
        <>
          <span role='alert'>내 투찰을 불러오지 못했어요</span>
          <Button variant='outline' size='sm' onClick={status.retry}>다시 시도</Button>
        </>
      );
  }
}

export function OwnBidControls({ auctionId, search }: { readonly auctionId: string; readonly search: DecisionSearch }) {
  const ownBid = useOptionalOwnBid();
  // 로그인·설정으로 갔다가 보던 공고로 돌아오게 한다. 값은 받는 쪽이 한 번 더 판정한다(return-path).
  const pathname = usePathname();
  if (!ownBid) return null;
  return (
    <div
      data-slot='own-bid-controls'
      data-own-status={ownBid.status.kind}
      className='flex min-w-0 flex-wrap items-center gap-2 text-[13px] font-medium text-muted-foreground'
    >
      <span className='inline-flex items-center gap-1 font-semibold text-foreground'>
        <span aria-hidden='true' className='text-fuchsia-700 dark:text-fuchsia-300'>◆</span>
        내 투찰
      </span>
      {ownBid.businesses.length > 1 ? <BusinessPicker ownBid={ownBid} /> : null}
      <StatusLine status={ownBid.status} ownBid={ownBid} auctionId={auctionId} search={search} pathname={pathname} />
    </div>
  );
}
