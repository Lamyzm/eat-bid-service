'use client';
/**
 * 회차별 낙찰률 흐름 — 하한별 small multiples
 * 방법론: 하한 혼재 시 겹치지 않고 패널 분리(공유 시간축) · 직접 라벨(최근 3회 값,
 * 하한선 위 라벨) · 보조 수치(참여수)는 툴팁 (NN/g clutter-free, docs/COPY-GUIDE.md)
 */
type Pt = {
  openedAt: string; winRate: number; floorRate: number | null;
  nValid: number; myRate?: number | null;
};

export function TimeDotChart({ points, denseByFloor }: {
  points: Pt[];
  denseByFloor: Record<string, { lo: number; hi: number } | undefined>;
}) {
  const W = 960, L = 16, R = 78, PH = 116, PT = 24, PB = 8, AXIS = 42;
  const usable = points.filter(p => p.winRate != null);
  if (usable.length === 0) return null;

  // 시간축 (전 패널 공유)
  const ts = usable.map(p => +new Date(p.openedAt));
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const X = (d: string) => L + (W - L - R) * ((+new Date(d)) - t0) / Math.max(t1 - t0, 1);

  // 하한별 그룹 (건수 내림차순)
  const groups = new Map<string, Pt[]>();
  for (const p of usable) {
    const k = p.floorRate != null ? String(p.floorRate) : '기타';
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p);
  }
  const panels = [...groups.entries()]
    .filter(([, ps]) => ps.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  const H = panels.length * PH + AXIS;

  // 하단 연/월 눈금 (간격 필터)
  const dateTicks: { x: number; label: string }[] = [];
  {
    let last = -Infinity;
    for (const p of [...usable].sort((a, b) => +new Date(a.openedAt) - +new Date(b.openedAt))) {
      const x = X(p.openedAt);
      if (x - last >= 90) { last = x; dateTicks.push({ x, label: p.openedAt.slice(2, 7) }); }
    }
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}
        style={{ width: '100%', height: 'auto', minWidth: 660 }} role='img' aria-label='하한별 회차 낙찰률'>
        {panels.map(([key, ps], pi) => {
          const top = pi * PH;
          const floor = key === '기타' ? null : parseFloat(key);
          const dense = floor != null ? (denseByFloor[String(floor)] ?? denseByFloor[floor.toFixed(1)]) : undefined;
          const vals = ps.flatMap(p => [p.winRate, ...(p.myRate != null ? [p.myRate] : [])]);
          const yLo = Math.min(floor ?? Infinity, ...vals) - 0.04;
          const yHi = Math.max(...vals) + 0.06;
          const Y = (v: number) => top + PT + (PH - PT - PB) * (1 - (v - yLo) / (yHi - yLo));
          const sorted = [...ps].sort((a, b) => +new Date(a.openedAt) - +new Date(b.openedAt));
          const last3 = new Set(sorted.slice(-3));
          return (
            <g key={key}>
              {pi > 0 && <line x1={L} y1={top} x2={W - R} y2={top} stroke='var(--border)' />}
              {/* 잘 나온 구간 음영 */}
              {dense && <rect x={L} y={Y(dense.hi)} width={W - L - R} height={Y(dense.lo) - Y(dense.hi)}
                fill='var(--primary)' opacity={0.08} />}
              {/* 하한선 + 직접 라벨 */}
              {floor != null && <>
                <line x1={L} y1={Y(floor)} x2={W - R} y2={Y(floor)}
                  stroke='var(--destructive)' strokeWidth={1.5} opacity={0.8} />
                <text x={W - R + 6} y={Y(floor) + 4} fontSize={12} fill='var(--destructive)'
                  fontFamily='var(--font-mono, monospace)'>하한 {floor}</text>
              </>}
              {/* 패널 제목 */}
              <text x={L} y={top + 15} fontSize={13} fontWeight={700} fill='var(--foreground)'>
                하한 {key} · {ps.length}회
              </text>
              {/* 점 + 내 △ + 최근 3회 직접 라벨 */}
              {sorted.map((p, i) => (
                <g key={i}>
                  {p.myRate != null && (
                    <path d={`M ${X(p.openedAt)} ${Y(p.myRate) - 6} l 6 10 l -12 0 z`}
                      fill='none' stroke='var(--foreground)' strokeWidth={1.8}>
                      <title>내 투찰 {p.myRate.toFixed(3)} ({p.openedAt})</title>
                    </path>
                  )}
                  <circle cx={X(p.openedAt)} cy={Y(p.winRate)} r={4}
                    fill='var(--primary)' opacity={last3.has(p) ? 1 : 0.5}>
                    <title>{p.openedAt} · 낙찰 {p.winRate.toFixed(3)} · 참여 {p.nValid}곳</title>
                  </circle>
                </g>
              ))}
              {/* 최근 3회 직접 라벨 — 겹치면 계단식 상향 */}
              {(() => {
                const ls = sorted.filter(p => last3.has(p));
                let prevX = -Infinity, lift = 0;
                return ls.map((p, i) => {
                  const x = X(p.openedAt);
                  lift = x - prevX < 42 ? lift + 14 : 0;
                  prevX = x;
                  return (
                    <text key={`l-${i}`} x={x} y={Y(p.winRate) - 8 - lift} textAnchor='middle'
                      fontSize={12.5} fontWeight={700} fill='var(--foreground)'
                      fontFamily='var(--font-mono, monospace)'>{p.winRate.toFixed(2)}</text>
                  );
                });
              })()}
            </g>
          );
        })}
        {/* 공유 시간축 */}
        <line x1={L} y1={H - AXIS} x2={W - R} y2={H - AXIS} stroke='var(--border)' />
        {dateTicks.map(t => (
          <text key={t.x} x={t.x} y={H - AXIS + 17} textAnchor='middle' fontSize={12}
            fill='var(--muted-foreground)' fontFamily='var(--font-mono, monospace)'>{t.label}</text>
        ))}
        <text x={W - R} y={H - AXIS + 34} textAnchor='end' fontSize={12} fill='var(--muted-foreground)'>
          점에 올리면 참여 수 표시 · ▲ = 내 투찰
        </text>
      </svg>
    </div>
  );
}
