/** @module 책임: 실제 화면과 로딩 화면의 공고·스티키 조건·분석·전체 이력 배치를 공유한다. */
import type { ReactNode } from 'react';
import { ChartFullscreenFrame } from '@/shared/ui/chart-fullscreen-frame';
import './analysis-layout.css';

export function AnalysisFrame({
  header,
  toolbar,
  evidence,
  history,
  full = false
}: {
  readonly header: ReactNode;
  readonly toolbar: ReactNode;
  readonly evidence: ReactNode;
  readonly history: ReactNode;
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
    >
      <header data-slot='analysis-header'>{header}</header>
      <div data-slot='analysis-sticky'>{toolbar}</div>
      <section data-slot='analysis-evidence' aria-label='기관과 지역 분석'>
        {evidence}
      </section>
      <section data-slot='analysis-history' aria-label='전체 개찰 이력'>
        {history}
      </section>
    </ChartFullscreenFrame>
  );
}
