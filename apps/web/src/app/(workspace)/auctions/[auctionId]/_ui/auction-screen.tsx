/** @module 책임: 검증된 공고 presentation을 식별·금액·일정·provenance section으로 표현한다. */
import type { AuctionPresentation } from '../_model/present-auction';
import { AuctionScreenFrame } from './auction-screen-frame';

type AuctionScreenProps = {
  readonly auction: AuctionPresentation;
};

type DescriptionItemProps = {
  readonly label: string;
  readonly value: string;
};

function DescriptionItem({ label, value }: DescriptionItemProps) {
  return (
    <div className='grid gap-1'>
      <dt className='text-xs font-medium text-muted-foreground'>{label}</dt>
      <dd className='min-w-0 break-all text-sm text-foreground'>{value}</dd>
    </div>
  );
}

/** 공개 계약의 관측 사실만 표시하며 추천이나 클라이언트 계산을 만들지 않는다. */
export function AuctionScreen({ auction }: AuctionScreenProps) {
  const { identity, schedule, baseAmount, plannedAmount, provenance } = auction;

  return (
    <AuctionScreenFrame
      header={
        <div className='grid gap-2'>
          <p className='text-sm font-medium text-primary'>공고 상세</p>
          <h1 id='auction-title' className='text-2xl font-semibold tracking-tight sm:text-3xl'>
            {identity.title}
          </h1>
          <p className='text-sm text-muted-foreground'>공고 상태: {identity.status}</p>
        </div>
      }
      summary={
        <div className='rounded-xl border bg-card p-5 text-card-foreground'>
          <h2 className='mb-5 text-base font-semibold'>공고 요약</h2>
          <dl className='grid gap-5 sm:grid-cols-2 lg:grid-cols-3'>
            <DescriptionItem label='공고 ID' value={identity.auctionId} />
            <DescriptionItem label='리비전 ID' value={identity.revisionId} />
            <DescriptionItem label='외부 공고 ID' value={identity.externalBidId} />
            <DescriptionItem label='표시 공고 번호' value={identity.displayBidNumber ?? '미확인'} />
            <DescriptionItem label='공고일시 (UTC)' value={schedule.announcedAt} />
            <DescriptionItem label='마감일시 (UTC)' value={schedule.deadlineAt} />
            <DescriptionItem label='개찰일시 (UTC)' value={schedule.openedAt} />
            <DescriptionItem label='기초금액' value={baseAmount.text} />
            <DescriptionItem label='예정금액' value={plannedAmount.text} />
          </dl>
        </div>
      }
      details={
        <div className='rounded-xl border bg-card p-5 text-card-foreground'>
          <h2 className='mb-5 text-base font-semibold'>원천과 추적 정보</h2>
          <dl className='grid gap-5 sm:grid-cols-2'>
            <DescriptionItem label='원천 시스템' value={provenance.sourceSystem} />
            <DescriptionItem label='관측 ID' value={provenance.observationId} />
            <DescriptionItem label='정규화 레코드 ID' value={provenance.normalizedRecordId} />
            <DescriptionItem label='내용 SHA-256' value={provenance.contentSha256} />
          </dl>
        </div>
      }
    />
  );
}
