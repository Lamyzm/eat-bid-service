/** @module 책임: 실제 화면과 로딩 화면의 공고·스티키 조건·분석·전체 이력 배치를 공유한다. */
import type { ReactNode } from 'react';
import { ChartFullscreenFrame } from '@/shared/ui/chart-fullscreen-frame';
import './analysis-layout.css';

export function AnalysisFrame({
  header,
  toolbar,
  evidence,
  history,
  inspector,
  inspectorOpen = false,
  full = false
}: {
  readonly header: ReactNode;
  readonly toolbar: ReactNode;
  readonly evidence: ReactNode;
  readonly history: ReactNode;
  /** 고른 회차의 명단이다. 넓은 화면에서는 분석·이력 옆 열에 붙어 스크롤을 따라온다. */
  readonly inspector?: ReactNode;
  readonly inspectorOpen?: boolean;
  readonly full?: boolean;
}) {
  return (
    <ChartFullscreenFrame
      active={full}
      surface='workspace'
      data-slot='analysis-screen'
      className='analysis-screen'
      role='region'
      aria-label='공고 낙찰 분석'
      data-inspector={inspectorOpen ? 'open' : 'closed'}
    >
      <header data-slot='analysis-header'>{header}</header>
      <div data-slot='analysis-sticky'>{toolbar}</div>
      <section data-slot='analysis-evidence' aria-label='기관과 지역 분석'>
        {evidence}
      </section>
      <section data-slot='analysis-history' aria-label='전체 개찰 이력'>
        {history}
      </section>
      {inspector === undefined ? null : <div data-slot='analysis-inspector'>{inspector}</div>}
    </ChartFullscreenFrame>
  );
}
