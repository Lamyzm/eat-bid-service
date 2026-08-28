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
  const school = schools.find((s: any) => s.id === decoded) ?? schools[0] ?? null;
  const rounds = await roundsRes.json();
  return <AnalysisBoard school={school} rounds={rounds}
    initialRate={sp.rate ?? null} initialBase={sp.base ?? null} initialBidNo={sp.bidNo ?? null} />;
}
