/** @module 책임: 넣을 공고 화면과 로딩 화면이 함께 쓰는 배치(공통 화면 틀 위의 제목·기준 시각·본문)를 소유한다. */
import type { ReactNode } from 'react';

import { PageFrame, PageHeader } from '@/shared/ui/page-frame';

export function WorkFrame({
  stamp,
  children
}: {
  readonly stamp: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <PageFrame labelledBy='work-title' slot='work-screen' className='gap-6'>
      <PageHeader id='work-title' title='넣을 공고' aside={stamp} />
      {children}
    </PageFrame>
  );
}
