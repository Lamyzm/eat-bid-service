import { describe, expect, test } from 'bun:test';
import { organizationAuctionAttemptsV1ResponseSchema } from '@eatbid/contracts/api/v1/organizations';

import { attemptsFixture } from './attempts';

describe('기관 회차 이력 fixture', () => {
  test('공개 응답 계약을 통과한다', () => {
    expect(organizationAuctionAttemptsV1ResponseSchema.parse(attemptsFixture)).toEqual(attemptsFixture);
  });
});
