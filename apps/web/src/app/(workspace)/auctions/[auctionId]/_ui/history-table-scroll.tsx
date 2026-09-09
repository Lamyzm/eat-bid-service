/** @module 책임: 회차 표 컨테이너의 가로·세로 스크롤 상태 하나를 소유하고, 고정 열 그림자와 확대 복귀 위치를 그 상태로만 알린다. */
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type ScrollEdges = { readonly left: boolean; readonly right: boolean };

/**
 * 가로: 넘칠 때만 고정 열 안쪽에 그림자를 걸어 "이 밑에 열이 더 있다"를 알린다. 넘치지 않으면 아무 힌트도
 * 없어야 표가 열에 맞는 폭에서 장식이 남지 않는다(EAT-86). 그림자를 거는 일은 셀이 스스로 하고 여기서는
 * 넘쳤다는 사실만 attribute로 알린다 — 그래야 셀 전부가 server component로 남는다(EAT-139).
 *
 * 세로: 확대를 닫으면 12행만 남아 컨테이너가 더 이상 세로로 넘치지 않고, 그 순간 브라우저가 `scrollTop`을
 * 0으로 잘라 버린다. 다시 확대해도 두 번째 페이지에서 보던 자리를 잃으므로, 넘치는 동안의 위치를 기억했다가
 * 다시 넘치게 되는 전환에서만 되돌린다. 사용자가 맨 위로 올린 것도 0으로 기억하므로 임의로 끌어내리지 않는다.
 * 조회 조건이 바뀌면 다른 집단이라 기억을 물려받으면 안 되는데, 그 초기화는 `HistoryCard`가 코호트 key로
 * 이 컴포넌트를 다시 만들어 처리한다(EAT-115).
 */
function useTableScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });
  const rememberedTop = useRef(0);
  const wasScrollable = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const left = node.scrollLeft > 1;
      const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      const scrollable = node.scrollHeight > node.clientHeight + 1;
      if (scrollable) {
        if (wasScrollable.current) rememberedTop.current = node.scrollTop;
        else node.scrollTop = Math.min(rememberedTop.current, node.scrollHeight - node.clientHeight);
      }
      wasScrollable.current = scrollable;
      setEdges((previous) =>
        previous.left === left && previous.right === right ? previous : { left, right }
      );
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    // 폭·높이는 viewport뿐 아니라 손잡이 값(머리글 길이)·행 수·집중 모드 전환으로도 바뀌므로 컨테이너와 표
    // 둘 다 관측한다. 확대 전환도 이 관측으로 도착하므로 별도 mode prop이 필요 없다.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);
  return { ref, edges };
}

export function HistoryTableScroll({ children }: { readonly children: ReactNode }) {
  const { ref, edges } = useTableScroll();
  return (
    <div
      ref={ref}
      data-slot='history-table-scroll'
      data-scroll-left={edges.left ? '' : undefined}
      data-scroll-right={edges.right ? '' : undefined}
      className='min-w-0 overflow-x-auto'
    >
      {children}
    </div>
  );
}
