/** @module 책임: 시장 자리 route에서 운영자 자리 목록·업체 선택지를 읽어 Suspense 안에서 화면을 조립한다. */
import { Suspense } from 'react';
import { connection } from 'next/server';
import { systemClock } from '@eatbid/domain';

import { listOperatorMarketSeatsFromServer } from '@/api/operator/server';
import { SeatsScreen } from './_widgets/seats-screen';
import { SeatsScreenSkeleton } from './_widgets/seats-screen-skeleton';

async function SeatsLoader() {
  // 주소·검색어를 읽지 않는 화면이라 빌드가 미리 그리려 한다. 운영자 세션 데이터라 미리 그릴 것이 없으므로 요청 시점으로 고정한다.
  await connection();
  const read = await listOperatorMarketSeatsFromServer();
  // 남은 날과 오늘 날짜는 요청 시각의 함수다. 컴포넌트 안에서 시계를 부르지 않고 여기서 한 번 읽는다.
  return <SeatsScreen read={read} now={systemClock.now().toString()} />;
}

export default function SeatsPage() {
  return (
    <Suspense fallback={<SeatsScreenSkeleton />}>
      <SeatsLoader />
    </Suspense>
  );
}
