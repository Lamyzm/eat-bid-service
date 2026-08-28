import { AnalysisBoard } from './analysis-board';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ rate?: string; base?: string; bidNo?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const API = process.env.API_URL ?? 'http://localhost:8081';
  // 이 라우트는 인코딩된 값이 오기도, 이미 풀린 값이 오기도 한다.
  // 풀린 값에는 구분자 `|` 가 남아 있으니 그때는 건드리지 않고,
  // 인코딩된 값만 한 번 푼다. `%` 가 든 학교명에서 URIError 로 죽지 않게 감싼다.
  const decoded = id.includes("|") ? id : (() => {
    try { return decodeURIComponent(id); } catch { return id; }
  })();
  const [schoolRes, roundsRes] = await Promise.all([
    fetch(`${API}/api/schools?q=${encodeURIComponent(decoded.split('|')[1] ?? decoded)}&limit=5`, { cache: 'no-store' }),
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
