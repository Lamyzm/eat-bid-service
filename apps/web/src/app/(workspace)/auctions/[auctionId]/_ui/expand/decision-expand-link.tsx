/** @module 책임: 확대 링크의 URL 전환과 Escape·일반 보기 스크롤 복귀를 연결하며 차트·표 인스턴스와 필터 상태는 부모에 둔다. */
'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef } from 'react';
import { Button } from '@/shared/ui/button';
import { buildDecisionExpandRoute, type DecisionExpand, type DecisionSearch } from '../../_lib/decision-search-params';
import { useDecisionRoute } from '../evidence-view';

export function DecisionExpandLink({ auctionId, search, target }: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  /** 이 링크가 키우는 본문. 흐름 차트와 과거 회차 표는 같은 집중 모드를 쓰므로 링크 하나를 공유한다. */
  readonly target: DecisionExpand;
}) {
  // 비교집단만 모달로 열리고 자신의 닫기를 갖는다. 이 링크는 그 본문에서는 여는 방향만 맡는다.
  const expanded = search.expand === target && target !== '비교집단';
  const label = expanded ? '작게 보기' : '크게 보기';
  // 근거 탭이 서버 왕복 없이 바뀜므로 확대 주소도 지금 보는 본문을 실어야 한다.
  const route = useDecisionRoute();
  const link = useRef<HTMLAnchorElement>(null);
  const previousScroll = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!expanded) {
      if (previousScroll.current !== null) {
        window.scrollTo({ top: previousScroll.current, behavior: 'instant' });
        previousScroll.current = null;
        link.current?.focus({ preventScroll: true });
      }
      return;
    }
    // 직접 열린 확대 주소는 위에서 시작한다. 클릭 진입은 DOM 높이가 줄기 전에 원래 위치를 저장한다.
    previousScroll.current ??= 0;
    window.scrollTo({ top: 0, behavior: 'instant' });
    const close = (event: KeyboardEvent) => {
      // Base UI 메뉴·Sheet가 먼저 소비한 Escape로 뒤의 차트까지 닫지 않는다.
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      link.current?.click();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded]);

  return (
    <Button
      render={<Link
        ref={link}
        aria-label={label}
        href={route(buildDecisionExpandRoute(auctionId, search, expanded ? null : target))}
        replace={expanded}
        scroll={false}
        onClick={(event) => {
          if (!expanded && target !== '비교집단' && !event.defaultPrevented &&
              event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            previousScroll.current = window.scrollY;
          }
        }}
      />}
      nativeButton={false}
      role='link'
      variant='outline'
      size='default'
      className='ml-auto'
      data-slot='decision-expand-link'
    >
      {label}
    </Button>
  );
}

