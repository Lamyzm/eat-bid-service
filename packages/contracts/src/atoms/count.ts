import { z } from "zod";

// 개수는 wire에서 JSON 정수다. 비율·금액과 달리 단위 봉투가 없으므로 이름으로 목적을 드러낸다.
export const nonNegativeCountSchema = z.number().int().nonnegative().max(2_147_483_647).meta({
  id: "NonNegativeCount",
  description: "Count of observed rows; JSON integer within PostgreSQL integer range.",
});
