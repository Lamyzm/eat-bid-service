'use client';
/**
 * 데이터 범위 한 줄 — "무엇을 근거로 말하는가"를 화면이 밝히는 자리.
 *
 * 예전에는 `전국 137개 시군구 · 공고 10만 건 · 투찰 694만`이 세 파일에 복사돼 있었고
 * 세 숫자가 전부 틀렸다. 이제 서버 실측을 받아 쓰고, 문장은 여기서만 만든다.
 *
 * 시군구 수·학교 수는 쓰지 않는다. `schools.sigungu` 에 주소 파싱 쓰레기가 섞여 있어
 * (`급식실` 26곳이 시군구로 세어지고, 같은 학교가 두 번 세어진다) 그 두 값은 사실이 아니다.
 * SIGUNGU_CD·PURR_CD 재파싱이 들어온 뒤에 붙인다.
 *
 * `bidCountApprox`는 이름 그대로 추정치다(913만 행 count(*)가 느려 플래너 추정을 쓴다).
 * 필드가 정직한데 화면이 단언하면 그 정직함이 사라지므로 `약`을 붙인다.
 */
import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';

type Stats = {
  auctionCount: number;
  bidCountApprox: number;
  openedFrom: string | null;
  openedTo: string | null;
};

/** 만 단위 축약 — 181294 → 18.1만, 9147891 → 915만 */
function man(n: number): string {
  const v = n / 10_000;
  return v >= 100 ? `${Math.round(v)}만` : `${v.toFixed(1)}만`;
}

/** 근거가 없으면 규모를 주장하지 않는다 */
const NO_CLAIM = '공공 개찰 결과를 정리해 보여줍니다.';

export function dataScopeText(s: Stats | null): string {
  if (!s) return NO_CLAIM;
  const period = s.openedFrom && s.openedTo
    ? `${s.openedFrom.slice(0, 7)} ~ ${s.openedTo.slice(0, 7)} · `
    : '';
  return `${period}공고 ${man(s.auctionCount)} 건 · 투찰 약 ${man(s.bidCountApprox)} 건`;
}

export function DataScope({ className }: { className?: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    fetchJson<Stats>('/api/stats').then(setStats).catch(() => setStats(null));
  }, []);
  return <>{dataScopeText(stats)}</>;
}
