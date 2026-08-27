import { SchoolDetail } from './school-detail';

export const dynamic = 'force-dynamic';

export default async function SchoolPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ base?: string; floor?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const API = process.env.API_URL ?? 'http://localhost:8081';
  const decoded = decodeURIComponent(id);

  const [schoolRes, aucsRes] = await Promise.all([
    fetch(`${API}/api/schools?q=${encodeURIComponent(decoded.split('|')[1] ?? decoded)}&limit=5`, { cache: 'no-store' }),
    fetch(`${API}/api/schools/${encodeURIComponent(decoded)}/auctions`, { cache: 'no-store' }),
  ]);
  const schools = await schoolRes.json();
  const school = schools.find((s: any) => s.id === decoded) ?? schools[0] ?? null;
  const auctions = await aucsRes.json();

  return (
    <SchoolDetail
      school={school}
      auctions={auctions}
      prefillBase={sp.base ? Number(sp.base) : null}
      prefillFloor={sp.floor ? Number(sp.floor) : null}
    />
  );
}
