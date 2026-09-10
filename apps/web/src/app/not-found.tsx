/** @module 책임: 존재하지 않는 route로 들어온 요청에 뒤로 가기와 canonical 시작 화면 복귀만 제공한다. */
'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@/shared/ui/button';

export default function NotFound() {
  const router = useRouter();

  return (
    <div className='absolute top-1/2 left-1/2 mb-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-center'>
      <span className='from-foreground bg-linear-to-b to-transparent bg-clip-text text-[10rem] leading-none font-extrabold text-transparent'>
        404
      </span>
      <h2 className='font-heading my-2 text-2xl font-bold'>찾는 화면이 없습니다</h2>
      <p>주소를 확인해 다시 열거나 아래에서 이동하세요.</p>
      <div className='mt-8 flex justify-center gap-2'>
        <Button onClick={() => router.back()} variant='default' size='lg'>
          뒤로 가기
        </Button>
        <Button onClick={() => router.push('/today')} variant='ghost' size='lg'>
          오늘 공고
        </Button>
      </div>
    </div>
  );
}
