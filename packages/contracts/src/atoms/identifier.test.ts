import { describe, expect, test } from "bun:test";
import { auctionIdPathSchema, positiveBigintTextSchema } from "./identifier";

const signedBigintMaximum = "9223372036854775807";
const firstRejectedBigint = "9223372036854775808";

describe("PostgreSQL bigint 식별자 계약", () => {
  test("정확한 signed bigint 상한을 허용하고 바로 다음 값을 거부한다", () => {
    expect(positiveBigintTextSchema.parse(signedBigintMaximum)).toBe(signedBigintMaximum);
    expect(positiveBigintTextSchema.safeParse(firstRejectedBigint).success).toBe(false);
  });

  test("OpenAPI metadata가 길이만으로 표현할 수 없는 정확한 상한을 명시한다", () => {
    for (const schema of [positiveBigintTextSchema, auctionIdPathSchema]) {
      const metadata = schema.meta();
      expect(metadata?.description).toContain(signedBigintMaximum);
      expect(metadata?.description).toContain(`${firstRejectedBigint} is rejected`);
      expect(metadata?.example).toBe(signedBigintMaximum);
    }
  });
});
