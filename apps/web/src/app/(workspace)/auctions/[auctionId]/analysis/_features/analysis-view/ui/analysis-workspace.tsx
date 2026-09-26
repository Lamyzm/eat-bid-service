/** @module 책임: 표시 전용 분석 탭과 전체보기의 주소·초점·스크롤을 연결하고 데이터는 서버 슬롯으로 받는다. */
'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useQueryStates } from 'nuqs';
import { Button } from '@/shared/ui/button';
import { analysisSearchParsers } from '@/app/(workspace)/auctions/[auctionId]/analysis/_lib/analysis-search';
import { AnalysisFrame } from '@/app/(workspace)/auctions/[auctionId]/analysis/_widgets/analysis-frame';

export function AnalysisWorkspace({
  header,
  filters,
  reset,
  context,
  time,
  distribution,
  history,
  inspector
}: {
  readonly header: ReactNode;
  readonly filters: ReactNode;
  /** 탭 줄 오른쪽 끝이다. 조건 막대는 폭이 모자라 되돌리는 조작을 담지 못한다. */
  readonly reset: ReactNode;
  readonly context: ReactNode;
  readonly time: ReactNode;
  readonly distribution: ReactNode;
  readonly history: ReactNode;
  /** 고른 회차의 명단이다. 열림 여부는 주소의 회차 선택이 정한다. */
  readonly inspector?: ReactNode;
}) {
  const [{ view, full, round }, setView] = useQueryStates(
    {
      view: analysisSearchParsers.view,
      full: analysisSearchParsers.full,
      round: analysisSearchParsers.round
    },
    { shallow: true, history: 'replace', scroll: false }
  );
  const expand = useRef<HTMLButtonElement>(null);
  const previousScroll = useRef<number | null>(null);
  const timeTab = useRef<HTMLButtonElement>(null);
  const distributionTab = useRef<HTMLButtonElement>(null);
  /*
   * 명단 패널은 조건 막대 바로 아래에 붙어야 한다. 막대 높이는 폭과 펼친 조건에 따라 253~539px로 바뀌므로
   * (2026-09-18 실측) 숫자로 박지 않고 재서 CSS 변수로 넘긴다. 막대 뒤로 패널 머리가 숨으면 닫기 단추를 못 누른다.
   */
  useLayoutEffect(() => {
    const sticky = document.querySelector<HTMLElement>("[data-slot='analysis-sticky']");
    const screen = sticky?.closest<HTMLElement>('.analysis-screen');
    if (!sticky || !screen) return;
    const measure = () =>
      screen.style.setProperty('--analysis-sticky-height', `${sticky.offsetHeight}px`);
    measure();
    const size = new ResizeObserver(measure);
    size.observe(sticky);
    return () => size.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!full) {
      if (previousScroll.current !== null) {
        window.scrollTo({ top: previousScroll.current, behavior: 'instant' });
        previousScroll.current = null;
        expand.current?.focus({ preventScroll: true });
      }
      return;
    }
    previousScroll.current ??= 0;
    window.scrollTo({ top: 0, behavior: 'instant' });
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      void setView({ full: false });
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [full, setView]);
  return (
    <AnalysisFrame
      full={full}
      header={header}
      toolbar={
        <>
          <div className='analysis-tabs-row'>
            <div
              role='tablist'
              tabIndex={-1}
              aria-label='분석 방법'
              className='flex gap-7'
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === 'Home' || (event.key !== 'End' && view === 'distribution')
                    ? 'time'
                    : 'distribution';
                void setView({ view: next });
                (next === 'time' ? timeTab : distributionTab).current?.focus();
              }}
            >
              <button
                type='button'
                role='tab'
                id='analysis-time-tab'
                ref={timeTab}
                aria-selected={view === 'time'}
                aria-controls='analysis-time-panel'
                tabIndex={view === 'time' ? 0 : -1}
                onClick={() => void setView({ view: 'time' })}
              >
                시간별 추이
              </button>
              <button
                type='button'
                role='tab'
                id='analysis-distribution-tab'
                ref={distributionTab}
                aria-selected={view === 'distribution'}
                aria-controls='analysis-distribution-panel'
                tabIndex={view === 'distribution' ? 0 : -1}
                onClick={() => void setView({ view: 'distribution' })}
              >
                낙찰값 분포
              </button>
            </div>
            {reset}
          </div>
          {filters}
        </>
      }
      evidence={
        <>
          <div className='analysis-context-row'>
            {context}
            <Button
              ref={expand}
              type='button'
              variant='outline'
              size='sm'
              aria-pressed={full}
              onClick={() => {
                if (!full) previousScroll.current = window.scrollY;
                void setView({ full: !full });
              }}
            >
              {full ? '전체보기 닫기' : '전체보기'}
            </Button>
          </div>
          <div
            role='tabpanel'
            id='analysis-time-panel'
            aria-labelledby='analysis-time-tab'
            tabIndex={0}
            hidden={view !== 'time'}
            className='analysis-method-panel'
          >
            {time}
          </div>
          <div
            role='tabpanel'
            id='analysis-distribution-panel'
            aria-labelledby='analysis-distribution-tab'
            tabIndex={0}
            hidden={view !== 'distribution'}
            className='analysis-method-panel'
          >
            {distribution}
          </div>
        </>
      }
      history={history}
      inspector={inspector}
      inspectorOpen={round !== null}
    />
  );
}
