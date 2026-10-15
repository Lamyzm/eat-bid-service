/** @module 책임: 화면 숫자의 출처(추첨 규칙, 분포 판과 근거 공고 수, 자료 판, 전국 검정, 그리는 방식의 근거)를 접힌 칸에 적는다. */
import { countText } from '@/entities/floor-line/floor-units';
import type { FloorData } from '../_features/floor-board/model/present-floor';

export function FloorEvidence({ data, periodLabel }: { readonly data: FloorData; readonly periodLabel: string }) {
  const provenance = data.provenance;
  return (
    <details className='rounded-2xl border border-border px-4 py-3'>
      <summary className='cursor-pointer font-semibold'>숫자 출처</summary>
      <div className='mt-3 grid max-w-[78ch] gap-2.5 text-[14px] text-muted-foreground'>
        <p>
          <b className='text-foreground'>규칙.</b> eaT 공고문: &quot;±3%범위 내에서 복수예비가격 15개 … 가장 많이 선택된 4개 … 산술평균&quot;.
          행정안전부 「지방자치단체 입찰 및 계약 집행기준」: 0~+3%에 7개, 0~−3%에 8개.
        </p>
        <p>
          <b className='text-foreground'>추첨 분포.</b> 점 20개와 하한 미달 확률은 전국 하한율 90% 공고 {countText(provenance.ruleSourceRounds)}건으로
          만든 분포 판({provenance.ruleVersion})에서 읽어요. 맞춤 금액·복기와 같은 판이에요.
        </p>
        <p>
          <b className='text-foreground'>이 화면의 공고.</b> {data.region.place} {periodLabel} 하한율 90% 공고 {countText(data.points.length)}건
          {provenance.buildId === null ? '' : ` · 자료 판 ${provenance.buildId}`}
          {provenance.computedAt === null ? '' : ` · ${provenance.computedAt} 계산`}. 하한선은 예정가격 × 90% ÷ 기초금액이에요.
        </p>
        <p>
          <b className='text-foreground'>몰림을 따라가면(2026년 10월 전국 조사).</b> 한 달 안에서 앞서 몰린 0.2% 폭에 다음 공고가 떨어진 비율은 공고
          많은 시군구 25곳 10.1%(섞으면 10.0%)였어요. 달 중간에 몰림이 보인 45번도 남은 공고는 10.6%(추첨대로면 10.6%)였어요.
        </p>
        <p>
          <b className='text-foreground'>보이는 방식.</b> 점 20개 그림: Kay 외(CHI 2016), Fernandes 외(CHI 2018). 추첨만 돌린 한 달 다시
          굴리기: Hullman 외(2015). 결정 기록: PDR-0009.
        </p>
      </div>
    </details>
  );
}
