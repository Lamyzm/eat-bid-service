import { AnalysisBoard } from './analysis-board';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ rate?: string; base?: string; bidNo?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const API = process.env.API_URL ?? 'http://localhost:8081';
  // Next 가 이미 디코드해서 준다. 한 번 더 풀면 학교명에 `%` 가 있을 때 URIError 로
  // 화면이 죽는다. 형제 라우트 auction/[bidNo] 도 풀지 않는다.
  const decoded = id;
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
