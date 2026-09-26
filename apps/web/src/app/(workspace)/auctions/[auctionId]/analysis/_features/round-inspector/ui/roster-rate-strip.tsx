/** @module 책임: 한 회차 명단의 사정률을 하한선과 함께 가로 띠 한 줄에 점으로 그린다. */
import type { RosterStripView } from '../model/present-round-roster';

const WIDTH = 320;
const HEIGHT = 64;
const SIDE = 6;

/** 점이 겹쳐 한 점처럼 보이지 않게 세로로 흩는다. 순서에서 정해지는 값이라 다시 그려도 자리가 같다. */
function jitter(index: number): number {
  const s = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export function RosterRateStrip({ strip }: { readonly strip: RosterStripView }) {
  const x = (value: number) =>
    SIDE + ((value - strip.from) / Math.max(strip.to - strip.from, 1)) * (WIDTH - SIDE * 2);
  const winner = strip.dots.find((dot) => dot.isWinner);
  return (
    <figure className='m-0'>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className='block h-16 w-full'
        role='img'
        aria-label={`명단 ${strip.dots.length}곳의 사정률 분포${strip.floor === null ? '' : ', 빨간 점선이 하한'}`}
      >
        {strip.floor === null ? null : (
          <line
            x1={x(strip.floor)}
            x2={x(strip.floor)}
            y1={4}
            y2={HEIGHT - 16}
            stroke='var(--destructive)'
            strokeDasharray='3 3'
          />
        )}
        {strip.dots.map((dot, index) =>
          dot.isWinner ? null : (
            <circle
              key={dot.key}
              cx={x(dot.x)}
              cy={10 + jitter(index) * (HEIGHT - 32)}
              r={2.4}
              fill={dot.belowFloor === true ? 'var(--destructive)' : 'var(--muted-foreground)'}
              opacity={0.55}
            />
          )
        )}
        {/* 낙찰 점은 마지막에 크게 그린다. 수백 곳 사이에서도 어디서 낙찰됐는지가 먼저 읽혀야 한다. */}
        {winner === undefined ? null : (
          <circle
            cx={x(winner.x)}
            cy={HEIGHT / 2 - 6}
            r={5}
            fill='var(--primary)'
            stroke='var(--background)'
            strokeWidth={1.5}
          />
        )}
        <text
          x={SIDE}
          y={HEIGHT - 2}
          fontSize={10}
          fill='var(--muted-foreground)'
          className='tabular-nums'
        >
          {(strip.from / 1000).toFixed(2)}
        </text>
        <text
          x={WIDTH - SIDE}
          y={HEIGHT - 2}
          fontSize={10}
          textAnchor='end'
          fill='var(--muted-foreground)'
          className='tabular-nums'
        >
          {(strip.to / 1000).toFixed(2)}
        </text>
      </svg>
      {strip.outsideBelow + strip.outsideAbove === 0 ? null : (
        <figcaption className='mt-1 text-[11px] text-muted-foreground'>
          띠 밖{' '}
          {[
            strip.outsideBelow ? `아래 ${strip.outsideBelow}곳` : null,
            strip.outsideAbove ? `위 ${strip.outsideAbove}곳` : null
          ]
            .filter(Boolean)
            .join(' · ')}
          (가장자리에 붙여 그렸어요)
        </figcaption>
      )}
    </figure>
  );
}
