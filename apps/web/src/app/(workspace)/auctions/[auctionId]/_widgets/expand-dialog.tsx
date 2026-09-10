/** @module 책임: 크게 보기 모달 셸 하나를 소유한다 — 열림은 URL `expand`가 정하고, ESC·바탕 클릭·닫기는 그 param을 지운 주소로 replace해 뒤로 가기와 같은 경로로 닫힌다. */
'use client';

import { Dialog } from '@base-ui/react/dialog';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { buildDecisionExpandRoute, type DecisionSearch } from '../_lib/decision-search-params';

/**
 * 열림 상태의 진실은 주소다. 서버가 `expand`를 읽어 이 셸을 그리고, 닫을 때는 param을 지운 주소로
 * `replace`한다 — `push`하면 뒤로 가기가 모달을 다시 열고, `back`은 공유 링크로 바로 들어온 사용자를
 * 이 화면 밖으로 내보낸다. 서버 왕복이 끝나기 전에도 사용자에게는 즉시 닫혀 보여야 하므로 로컬
 * `dismissed`로 먼저 감춘다. 이 상태는 본문이 바뀔 때 함께 버려야 하므로 부모가 `key={expand}`로 다시 만든다.
 */
export function ExpandDialog({
  auctionId,
  search,
  title,
  subtitle,
  note,
  children
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  readonly title: string;
  readonly subtitle: string | null;
  readonly note: string | null;
  readonly children: React.ReactNode;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const open = search.expand !== null && !dismissed;

  function close() {
    setDismissed(true);
    router.replace(buildDecisionExpandRoute(auctionId, search, null), { scroll: false });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Backdrop className='fixed inset-0 z-50 bg-foreground/50' />
        {/* 폭은 시안의 1400 상한을 따르되 viewport에서 좌우 여백 16을 남긴다. 본문이 세로로 길면 모달 안에서만
            스크롤하고, 가로로 넓은 표·히트맵은 각자의 overflow-x 컨테이너 안에서 움직인다. */}
        <Dialog.Popup
          data-slot='decision-expand'
          className='fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[1400px] min-w-0 -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_1fr] gap-3 overflow-hidden rounded-2xl bg-card p-4 text-card-foreground shadow-lg outline-none sm:p-6'
        >
          <div className='grid min-w-0 gap-2'>
            <div className='flex min-w-0 items-start gap-3'>
              <div className='flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1'>
                <Dialog.Title className='m-0 text-xl font-bold'>{title}</Dialog.Title>
                {subtitle === null ? null : (
                  <span className='min-w-0 text-[15px] font-medium text-muted-foreground'>{subtitle}</span>
                )}
              </div>
              <Dialog.Close className='inline-flex h-9 shrink-0 items-center rounded-md bg-foreground/5 px-3 text-[15px] font-semibold whitespace-nowrap'>
                닫기 ×
              </Dialog.Close>
            </div>
            {note === null ? null : (
              <Dialog.Description className='m-0 text-[13px] font-medium text-muted-foreground'>{note}</Dialog.Description>
            )}
          </div>
          <div className='min-h-0 min-w-0 overflow-y-auto'>{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
