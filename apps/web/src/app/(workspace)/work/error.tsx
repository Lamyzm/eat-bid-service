/** @module 책임: 넣을 공고 route 오류에서 내부 정보를 숨기고, 화면과 같은 틀 위에서 다시 시도하게 한다. */
'use client';

import { ReadFailure } from '@/shared/ui/empty-state';
import { PageFrame, PageHeader } from '@/shared/ui/page-frame';

export default function WorkError({ reset }: { readonly reset: () => void }) {
  return (
    <PageFrame labelledBy='work-title' slot='work-screen'>
      <PageHeader id='work-title' title='넣을 공고' />
      <ReadFailure
        size='page'
        title='넣을 공고를 불러오지 못했어요.'
        description='잠시 뒤 다시 시도해 주세요.'
        onRetry={reset}
      />
    </PageFrame>
  );
}
