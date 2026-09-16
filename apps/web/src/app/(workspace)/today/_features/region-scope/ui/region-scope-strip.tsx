/**
 * @module 책임: 지역을 아직 확인하지 않은 워크스페이스에 목록 대신 설정 요청을 보인다. 확인한 뒤 "무엇으로 좁혔는지"는 조건 기둥의 지역 구역이 말한다(EAT-241).
 */
import Link from 'next/link';

/**
 * 지역을 아직 확인하지 않은 워크스페이스가 보는 화면이다. 목록을 대신하며, 전국 목록을 미리 보여 주고
 * 설정을 권하지 않는다 — 사장님이 낼 수 없는 공고를 걸러내는 것이 이 화면의 첫 번째 일이다.
 */
export function RegionSetupRequest() {
  return (
    <div className='grid gap-3 rounded-xl bg-card px-5 py-6 shadow-xs'>
      <h2 className='text-xl font-bold'>먼저 지역을 고르세요</h2>
      <p className='text-[15px] leading-relaxed text-muted-foreground'>
        공고는 참가할 수 있는 지역을 제한합니다. 배달 다니는 범위를 고르면 그 지역의 공고만 보여 드립니다.
        지금은 전국 공고가 전부 쏟아져 낼 수 없는 공고를 사장님이 직접 걸러 내야 합니다.
      </p>
      <div>
        <Link
          href='/setup?return=%2Ftoday'
          className='inline-flex h-10 items-center rounded-lg bg-primary px-4 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90'
        >
          내 지역 고르기
        </Link>
      </div>
    </div>
  );
}
