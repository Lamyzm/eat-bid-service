import { MarketRegion } from '@eatbid/shared';
import { z } from 'zod';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

const API = process.env.API_URL ?? 'http://localhost:8081';

const eok = (n: number | null) =>
  n == null ? '-' : n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${Math.round(n / 1e4).toLocaleString()}만`;

export const dynamic = 'force-dynamic';

export default async function MarketPage() {
  const res = await fetch(`${API}/api/market?category=축산`, { cache: 'no-store' });
  // 계약: shared의 zod 스키마로 응답 검증 — 서버·웹이 같은 타입을 공유
  const rows = z.array(MarketRegion).parse(await res.json());

  return (
    <div className='flex flex-1 flex-col space-y-4 p-4 md:p-6'>
      <div>
        <h1 className='text-2xl font-semibold'>축산 시장 지도</h1>
        <p className='text-muted-foreground text-sm'>
          지역마다 공고가 얼마나 나오고 몇 개 업체가 나눠 먹는지. 기대 낙찰 =
          연간 공고 수 ÷ 참여 업체 수 — 자리 잡은 업체 1곳의 자연스러운 몫.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>지역 {rows.length}곳 · 기대 낙찰 많은 순</CardTitle>
          <CardDescription>
            낙찰을 예측하지 않습니다 — 시장 구조(과거 사실)만 보여줍니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>지역</TableHead>
                <TableHead className='text-right'>공고/년</TableHead>
                <TableHead className='text-right'>업체 수</TableHead>
                <TableHead className='text-right'>기대낙찰/년</TableHead>
                <TableHead className='text-right'>계약 중앙</TableHead>
                <TableHead className='text-right'>연간 시장</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.sigungu}-${r.category}`}
                  className={r.sigungu.includes('김해') ? 'bg-amber-500/10 font-medium' : ''}>
                  <TableCell>{r.sido.replace(/광역시|특별자치도|특별자치시/g, '')} <b>{r.sigungu}</b></TableCell>
                  <TableCell className='text-right tabular-nums'>{r.perYear}</TableCell>
                  <TableCell className='text-right tabular-nums'>{r.medField}곳</TableCell>
                  <TableCell className='text-right tabular-nums font-semibold text-primary'>{r.expWin}건</TableCell>
                  <TableCell className='text-right tabular-nums'>{eok(r.medBase)}</TableCell>
                  <TableCell className='text-right tabular-nums'>{eok(r.marketYr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
