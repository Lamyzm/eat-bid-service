/** @module 책임: 오늘 투찰의 금액 한 자리(이름과 사정률·기초대비 %·확인용 금액)를 행 칸과 더 보기가 같은 모양으로 만들게 한다. */
import { bidFigure, type BidFigure } from '@/entities/bid-figure/bid-figure';

export interface AmountLine {
  readonly label: string;
  /** eaT에 넣는 사정률·기초금액 대비 %와 확인용 금액이다(entities/bid-figure). */
  readonly figure: BidFigure;
}

type Position = Parameters<typeof bidFigure>[0];

export const amountLine = (label: string, position: Position, floorRate: string | null): AmountLine =>
  ({ label, figure: bidFigure(position, floorRate) });
