'use client';
/**
 * 시장 지도 — 실제 지도 위 시군구 버블 (크기 = 연간 공고, 색 = 기대낙찰)
 * 클릭 → 지역 상세: 판 두께·연도 흐름·월별 물량·단골. 낙찰을 예측하지 않습니다.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { REGION_COORDS } from '@/lib/region-coords';
import { useTrack } from '@/lib/track';
import { RegionStatus } from '@/components/region-status';
import { eok, CATS } from '@/lib/format';
import { CHART, myMarker, bubbleColor, mapTiles } from '@/lib/chart-colors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia
} from '@/components/ui/empty';
import { IconMapPin } from '@tabler/icons-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';

type Region = {
  sido: string; sigungu: string; category: string; perYear: number; medField: number | null;
  expWin: number | null; medBase: number | null; marketYr: number | null; top5Share: number | null;
  detail: {
    mons: number[]; ytrend: [number, number, number][];
    schools: { n: number; medf: number; name: string; medbase: number }[];
    topwinners: [string, number][];
  } | null;
};

const MONTH_LABEL = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];


export function MarketMap() {
  useTrack('market');
  const { resolvedTheme } = useTheme();
  const tiles = mapTiles();
  const [cat, setCat] = useState('축산');
  const [rows, setRows] = useState<Region[]>([]);
  const [sel, setSel] = useState<Region | null>(null);

  useEffect(() => {
    fetch(`/api/market?category=${encodeURIComponent(cat)}`)
      .then(r => r.json()).then((xs: Region[]) => {
        setRows(Array.isArray(xs) ? xs : []);
        setSel(s => s ? xs.find(x => x.sigungu === s.sigungu && x.sido === s.sido) ?? null : null);
      });
  }, [cat]);

  const maxYr = useMemo(() => Math.max(1, ...rows.map(r => r.perYear)), [rows]);
  const d = sel?.detail;
  const maxMon = d ? Math.max(1, ...d.mons) : 1;

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold'>시장 지도</h1>
          <p className='text-muted-foreground text-sm'>
            낙찰을 예측하지 않습니다. 공고량·업체 수·계약 규모를 지역별로 정리한 판입니다.
          </p>
          <div className='mt-1'><RegionStatus /></div>
        </div>
        <div className='flex gap-1.5'>
          {CATS.map(c => (
            <Button key={c} size='sm' variant={cat === c ? 'default' : 'outline'} onClick={() => setCat(c)}>{c}</Button>
          ))}
        </div>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_400px]'>
        <Card>
          <CardContent className='p-2'>
            <div className='relative' style={{ height: 560 }}>
              <MapContainer center={[35.6, 127.9]} zoom={7} style={{ height: '100%', width: '100%', borderRadius: 6 }}>
                {/* 다크에선 다크 타일 — OSM 라이트 타일이 다크 화면을 찢는 문제 (R5 ⑧) */}
                <TileLayer key={resolvedTheme} attribution={tiles.attribution} url={tiles.url} />
                {rows.map(r => {
                  const co = REGION_COORDS[`${r.sido}|${r.sigungu}`];
                  if (!co) return null;
                  const isSel = sel?.sigungu === r.sigungu && sel?.sido === r.sido;
                  const isHome = r.sigungu === '김해시';
                  return (
                    <CircleMarker key={`${r.sido}|${r.sigungu}`} center={co}
                      radius={6 + Math.sqrt(r.perYear / maxYr) * 22}
                      pathOptions={{
                        color: isHome ? CHART.floor : isSel ? myMarker() : bubbleColor(r.expWin),
                        weight: isHome || isSel ? 2.5 : 1,
                        fillColor: bubbleColor(r.expWin), fillOpacity: 0.55,
                      }}
                      eventHandlers={{ click: () => setSel(r) }}>
                      <Tooltip>
                        <b>{r.sigungu}</b> · 연 {r.perYear}건 · 보통 {r.medField ?? '-'}곳 ·
                        기대낙찰 {r.expWin ?? '-'}건/업체{isHome ? ' · ★ 내 자격 지역' : ''}
                      </Tooltip>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
              {/* 범례 — 지도 밖 각주 2줄 대신 지도 우하단 오버레이 (R5 ⑧) */}
              <div className='bg-card/90 text-muted-foreground absolute right-2 bottom-7 z-[1000] space-y-0.5 rounded border px-2.5 py-1.5 text-xs backdrop-blur-sm'>
                <div>버블 크기 = 연간 공고 수</div>
                <div>색 = 기대낙찰(연 공고 ÷ 참여 업체) · 진할수록 업체당 몫이 큼</div>
                <div className='text-destructive'>빨간 테두리 = 내 자격 지역</div>
              </div>
            </div>
            <p className='text-muted-foreground px-2 pt-2 text-xs'>
              참가 자격은 사무소 소재지 기준입니다. 다른 지역은 사무소를 내야 들어갑니다.
            </p>
          </CardContent>
        </Card>

        {/* 지역 상세 */}
        <Card>
          <CardContent className='p-4'>
            {!sel ? (
              <Empty className='h-full py-10'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'><IconMapPin /></EmptyMedia>
                  <EmptyTitle>지역을 고르면 상세가 보입니다</EmptyTitle>
                  <EmptyDescription>
                    지도 버블 클릭 = 연간 공고·참여 업체·월별 물량·최다 낙찰 업체.
                  </EmptyDescription>
                </EmptyHeader>
                {rows.length > 0 && (
                  <EmptyContent>
                    <div className='text-muted-foreground text-xs'>공고 많은 지역 바로 보기</div>
                    <div className='flex flex-wrap justify-center gap-1.5'>
                      {[...rows].sort((a, b) => b.perYear - a.perYear).slice(0, 5).map(r => (
                        <Button key={`${r.sido}|${r.sigungu}`} size='sm' variant='outline'
                          onClick={() => setSel(r)}>
                          {r.sigungu} <span className='text-muted-foreground ml-1 tabular-nums'>연 {r.perYear}건</span>
                        </Button>
                      ))}
                    </div>
                  </EmptyContent>
                )}
              </Empty>
            ) : (
              <div className='space-y-4'>
                <div>
                  <div className='text-lg font-semibold'>{sel.sido} {sel.sigungu} <Badge variant='secondary'>{sel.category}</Badge></div>
                  <div className='text-muted-foreground text-xs tabular-nums'>연간 시장 {eok(sel.marketYr)}원</div>
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  {/* 히어로 숫자 — 화면당 1개: 기대낙찰 (DESIGN C표) */}
                  {[['연간 공고', sel.perYear, '건', ''], ['보통 참여', sel.medField ?? '-', '곳', ''],
                    ['기대낙찰', sel.expWin ?? '-', '건/업체', 'text-primary text-3xl'],
                    ['상위5 점유', sel.top5Share ?? '-', '%', '']].map(([l, v, unit, cls]) => (
                    <div key={l as string} className='rounded border px-3 py-2'>
                      <div className='text-muted-foreground text-xs'>{l}</div>
                      <div className={`font-bold tabular-nums ${cls || 'text-lg'}`}>
                        {v}<span className='text-muted-foreground ml-0.5 text-sm font-normal'>{unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {d && (<>
                  {/* 월별 물량 */}
                  <div>
                    <div className='mb-1 text-sm font-medium'>월별 물량 <span className='text-muted-foreground font-normal'>· 학기 전이 성수기</span></div>
                    <div className='flex items-end gap-0.5' style={{ height: 64 }}>
                      {d.mons.map((n, i) => (
                        <div key={i} className='flex flex-1 flex-col items-center' title={`${i + 1}월 · ${n}건`}>
                          <div className='bg-primary w-full rounded-t opacity-70' style={{ height: `${n / maxMon * 48}px` }} />
                          <div className='text-muted-foreground text-xs'>{MONTH_LABEL[i]}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* 연도별 흐름 */}
                  <div>
                    <div className='mb-1 text-sm font-medium'>연도별 <span className='text-muted-foreground font-normal'>· 판이 두꺼워지는가</span></div>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>연도</TableHead><TableHead className='text-right'>공고</TableHead>
                        <TableHead className='text-right'>참여 업체(중앙)</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {d.ytrend.map(([y, n, f]) => (
                          <TableRow key={y}>
                            <TableCell className='tabular-nums'>{y}</TableCell>
                            <TableCell className='text-right tabular-nums'>{n}건</TableCell>
                            <TableCell className='text-right tabular-nums'>{f}곳</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* 단골 */}
                  <div>
                    <div className='mb-1 text-sm font-medium'>최다 낙찰 업체</div>
                    <div className='space-y-1 text-sm tabular-nums'>
                      {d.topwinners.slice(0, 6).map(([name, n]) => (
                        <div key={name} className='flex justify-between'>
                          <span className='truncate pr-2'>{name}</span><span>{n}승</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
