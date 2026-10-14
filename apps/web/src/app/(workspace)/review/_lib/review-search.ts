/** @module 책임: 복기 URL의 달(`month`)을 nuqs parser로 읽는다. 고른 달이 곧 즐겨찾기할 주소다. */
import { parseAsString } from 'nuqs/server';

export const reviewSearchParsers = {
  month: parseAsString
};
