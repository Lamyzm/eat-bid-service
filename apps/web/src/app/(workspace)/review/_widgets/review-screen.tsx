/**
 * @module 책임: 복기 화면의 상태(대조할 달·내 공고 없음·권한 없음)를 하나씩 그린다. 상태마다 사용자가 할 일이 다르므로 같은 빈 화면으로
 * 합치지 않는다.
 */
import Link from 'next/link';

import { MonthNav } from '../_features/review-board/ui/month-nav';
import { ReviewRows } from '../_features/review-board/ui/review-rows';
import { ReviewSummary } from '../_features/review-board/ui/review-summary';
import type { ReviewView } from '../_features/review-board/model/present-review';
import { ReviewFrame } from './review-frame';

export type ReviewScreenView = ReviewView | { readonly kind: 'forbidden' };

function Notice({ title, body, action }: { readonly title: string; readonly body: string; readonly action?: React.ReactNode }) {
  return (
    <div role='status' className='mt-8 grid max-w-xl gap-2 rounded-xl bg-muted px-5 py-4'>
      <p className='text-[15px] font-bold'>{title}</p>
      <p className='text-[14px] text-muted-foreground'>{body}</p>
      {action}
    </div>
  );
}

export function ReviewScreen({ view }: { readonly view: ReviewScreenView }) {
  if (view.kind === 'forbidden') {
    return (
      <ReviewFrame lede={null} stamp={null}>
        <Notice title='이 화면을 볼 권한이 없어요.' body='복기는 운영자 계정에서만 열려요.' />
      </ReviewFrame>
    );
  }
  if (view.kind === 'empty') {
    return (
      <ReviewFrame lede={null} stamp={null}>
        <Notice
          title='아직 대조할 공고가 없어요.'
          body='내 사업자로 등록한 업체가 넣은 공고가 개찰되면 여기에 달마다 쌓여요.'
          action={<Link href='/setup' className='text-[14px] font-bold text-primary hover:underline'>내 사업자 확인하기</Link>}
        />
      </ReviewFrame>
    );
  }
  return (
    <ReviewFrame lede={view.lede} stamp={view.stamp}>
      <MonthNav year={view.year} month={view.month} years={view.years} monthTabs={view.monthTabs} />
      <ReviewSummary rows={view.summary} />
      <section aria-label='읽는 법' className='mt-5 grid max-w-[76ch] gap-1.5 rounded-xl bg-muted/60 px-4 py-3 text-[13.5px] text-muted-foreground'>
        <p>
          <b className='text-foreground'>1등 자리</b>는 그날 하한(예정가격 ÷ 기초금액) 이상이면서 다른 업체의 가장 낮은 유효 투찰보다 낮은 구간이에요. 그날
          실제로 뽑힌 예정가격으로 가린 것이고, 우리 값이 들어가면 예정가격 추첨도 달라지므로 실제 낙찰과 같지 않아요.
        </p>
        <p>
          <b className='text-foreground'>맞춤 값이 하한 미달로 자주 보이는 이유.</b> 예정가격이 낮게 뽑힌 날에 1등이 되도록 고른 값이라 보통 날에는 하한
          아래예요. 그래서 공고 하나하나보다 한 달을 모은 위 표로 견줘요. 추첨 평균 기대는 예정가격 추첨을 평균한 낙찰 수예요.
        </p>
        {view.notes.map((note) => <p key={note}>{note}</p>)}
      </section>
      <ReviewRows rows={view.rows} hasHabit={view.hasHabit} />
    </ReviewFrame>
  );
}
