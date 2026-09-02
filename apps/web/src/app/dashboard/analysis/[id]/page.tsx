/** @module 책임: legacy 분석 route에서 학교 ID·검색 조건을 해석해 analysis board에 전달한다. */
import { AnalysisBoard } from './analysis-board';
import { schoolIdFromParam, parseSchoolId } from '@/lib/school-id';

export default async function AnalysisPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ rate?: string; base?: string; bidNo?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const API = process.env.API_URL ?? 'http://localhost:8081';
  const decoded = schoolIdFromParam(id);
  const [schoolRes, roundsRes] = await Promise.all([
    fetch(`${API}/api/schools?q=${encodeURIComponent(parseSchoolId(decoded).name)}&limit=5`, { cache: 'no-store' }),
    fetch(`${API}/api/rounds/school/${encodeURIComponent(decoded)}`, { cache: 'no-store' }),
  ]);
  const schools = await schoolRes.json();
  // schools[0] 로 떨어지고 있었다. id 가 안 맞으면 검색 결과 첫 번째 학교를
  // 조용히 대신 그려서, URL 은 A 인데 화면은 B 였다. 오류도 안 났다.
  // 못 찾으면 못 찾았다고 말한다 — 다른 학교의 데이터를 보여주는 것보다 낫다.
  const school = schools.find((s: any) => s.id === decoded) ?? null;
  const rounds = await roundsRes.json();
  return <AnalysisBoard school={school} rounds={rounds}
    initialRate={sp.rate ?? null} initialBase={sp.base ?? null} initialBidNo={sp.bidNo ?? null} />;
}
