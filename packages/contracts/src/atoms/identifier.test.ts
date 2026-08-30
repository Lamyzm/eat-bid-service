import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { auctionIdPathSchema, positiveBigintTextSchema } from "./identifier";

const signedBigintMaximum = "9223372036854775807";
const firstRejectedBigint = "9223372036854775808";
const acceptedIdentifiers = ["1", "9", "10", "9223372036854775806", signedBigintMaximum];
const rejectedIdentifiers = [
  "0",
  "01",
  firstRejectedBigint,
  "9999999999999999999",
  "10000000000000000000",
];

type MachineReadableStringSchema = Readonly<{
  type?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}>;

function machineReadableSchemaAccepts(schema: MachineReadableStringSchema, value: string): boolean {
  return schema.type === "string"
    && (schema.minLength === undefined || value.length >= schema.minLength)
    && (schema.maxLength === undefined || value.length <= schema.maxLength)
    && (schema.pattern === undefined || new RegExp(schema.pattern, "u").test(value));
}

describe("PostgreSQL bigint 식별자 계약", () => {
  test("Zod 계약은 1부터 signed bigint 상한까지만 허용한다", () => {
    for (const schema of [positiveBigintTextSchema, auctionIdPathSchema]) {
      for (const value of acceptedIdentifiers) expect(schema.safeParse(value).success).toBe(true);
      for (const value of rejectedIdentifiers) expect(schema.safeParse(value).success).toBe(false);
    }
  });

  test("생성 가능한 JSON Schema가 runtime refine 없이 같은 식별자 경계를 표현한다", () => {
    for (const [schemaId, zodSchema] of [
      ["PositiveBigintText", positiveBigintTextSchema],
      ["AuctionId", auctionIdPathSchema],
    ] as const) {
      const document = z.toJSONSchema(zodSchema, {
        target: "draft-2020-12",
        unrepresentable: "throw",
      }) as { $defs?: Record<string, MachineReadableStringSchema> };
      const schema = document.$defs?.[schemaId];
      expect(schema).toBeDefined();
      for (const value of acceptedIdentifiers) {
        expect(machineReadableSchemaAccepts(schema!, value)).toBe(true);
      }
      for (const value of rejectedIdentifiers) {
        expect(machineReadableSchemaAccepts(schema!, value)).toBe(false);
      }
    }
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
