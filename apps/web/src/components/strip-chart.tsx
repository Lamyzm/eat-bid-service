'use client';
/**
 * 착지 스트립 — "이 학교 승자들은 하한선 위 어디에 착지했나?"
 * 규격: 하한 기준선 굵게 · 잘 나온 구간 음영 · 자주 걸린 값 스택+×n ·
 *       최근성 인코딩(최근 3회 진하게) · 내 과거 △ · 입력 중 ▼ 실시간 · n 명시
 */
type Pt = { winRate: number; openedAt: string };

export function StripChart({
  floor, points, denseLo, denseHi, myPast, liveValue,
}: {
  floor: number;
  points: Pt[];                 // 같은 하한 회차의 낙찰률 (시간순)
  denseLo: number | null;
  denseHi: number | null;
  myPast: number[];             // 내 과거 투찰률 (같은 학교)
  liveValue: number | null;     // 계산기 입력 중 값
}) {
  const W = 880, H = 190, L = 30, R = 30, TRACK = 118;
  const vals = points.map(p => p.winRate).concat(myPast).concat(liveValue != null ? [liveValue] : []);
  const xMax = Math.max(floor + 0.15, ...vals.map(v => v + 0.02));
  const xMin = floor - 0.015;
  const X = (v: number) => L + (W - L - R) * (v - xMin) / (xMax - xMin);

  // 같은 값(0.01) 스택
  const stacks = new Map<number, Pt[]>();
  for (const p of points) {
    const k = Math.round(p.winRate * 100) / 100;
    const a = stacks.get(k) ?? []; a.push(p); stacks.set(k, a);
  }
  const recentSet = new Set(points.slice(-3).map(p => p.openedAt));

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}
        style={{ width: '100%', height: 'auto', minWidth: 620 }} role='img'
        aria-label='낙찰률 착지 기록'>
        {/* 잘 나온 구간 음영 */}
        {denseLo != null && denseHi != null && (
          <rect x={X(denseLo)} y={28} width={X(denseHi) - X(denseLo)} height={TRACK}
            fill='var(--primary)' opacity={0.09} />
        )}
        {/* 축 */}
        <line x1={L} y1={28 + TRACK} x2={W - R} y2={28 + TRACK} stroke='var(--border)' />
        {/* 하한 기준선 */}
        <line x1={X(floor)} y1={16} x2={X(floor)} y2={28 + TRACK} stroke='var(--destructive)' strokeWidth={2.5} />
        <text x={X(floor)} y={28 + TRACK + 38} textAnchor='middle' fontSize={13} fontWeight={700}
          fill='var(--destructive)' fontFamily='var(--font-mono, monospace)'>하한 {floor}</text>
        {/* 눈금 */}
        {(() => {
          const ticks: number[] = [];
          for (let v = Math.ceil(xMin / 0.05) * 0.05; v <= xMax + 1e-9; v += 0.05) ticks.push(Math.round(v * 100) / 100);
          const minPx = 52; let lastX = -Infinity;
          return ticks.map(v => {
            const x = X(v); const show = x - lastX >= minPx; if (show) lastX = x;
            return (
              <g key={v}>
                <line x1={x} y1={28 + TRACK} x2={x} y2={28 + TRACK + 5} stroke='var(--border)' />
                {show && <text x={x} y={28 + TRACK + 20} textAnchor='middle' fontSize={13}
                  fill='var(--muted-foreground)' fontFamily='var(--font-mono, monospace)'>{v.toFixed(2)}</text>}
              </g>
            );
          });
        })()}
        {/* 승자 점 스택 (최근성 인코딩) */}
        {[...stacks.entries()].map(([k, pts]) => pts.map((p, i) => {
          const recent = recentSet.has(p.openedAt);
          return (
            <circle key={`${k}-${i}`} cx={X(k)} cy={28 + TRACK - 12 - i * 15} r={6}
              fill='var(--primary)' opacity={recent ? 1 : 0.35}
              stroke={recent ? 'var(--primary)' : 'none'} strokeWidth={recent ? 2 : 0}>
              <title>{p.openedAt} · {p.winRate.toFixed(3)}</title>
            </circle>
          );
        }))}
        {/* 자주 걸린 값 ×n 라벨 */}
        {[...stacks.entries()].filter(([, pts]) => pts.length >= 2).map(([k, pts]) => (
          <text key={`n-${k}`} x={X(k)} y={28 + TRACK - 12 - pts.length * 15 - 4}
            textAnchor='middle' fontSize={13} fontWeight={700} fill='var(--foreground)'
            fontFamily='var(--font-mono, monospace)'>{k.toFixed(2)} ×{pts.length}</text>
        ))}
        {/* 내 과거 △ */}
        {myPast.map((v, i) => (
          <path key={`my-${i}`} d={`M ${X(v)} ${28 + TRACK - 4} l 7 12 l -14 0 z`}
            fill='none' stroke='var(--muted-foreground)' strokeWidth={2}>
            <title>내 과거 투찰 {v.toFixed(3)}</title>
          </path>
        ))}
        {/* 입력 중 ▼ */}
        {liveValue != null && liveValue >= xMin && liveValue <= xMax && (
          <g>
            <path d={`M ${X(liveValue)} 34 l 8 -13 l -16 0 z`} fill='var(--primary)' />
            <line x1={X(liveValue)} y1={34} x2={X(liveValue)} y2={28 + TRACK}
              stroke='var(--primary)' strokeWidth={1.5} strokeDasharray='4 3' />
            <text x={X(liveValue)} y={16} textAnchor='middle' fontSize={14} fontWeight={700}
              fill='var(--primary)' fontFamily='var(--font-mono, monospace)'>{liveValue.toFixed(3)}</text>
          </g>
        )}
        {/* n 명시 */}
        <text x={W - R} y={H - 4} textAnchor='end' fontSize={13} fill='var(--muted-foreground)'>
          같은 하한 {points.length}회 기준
        </text>
      </svg>
    </div>
  );
}
