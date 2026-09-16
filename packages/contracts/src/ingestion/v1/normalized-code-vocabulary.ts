/** @module 책임: 소스가 스스로 공개하는 코드목록 한 벌을 코드·이름·유효기간 관측으로 옮기는 ingestion wire 계약을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../atoms/count";
import { instantTextSchema } from "../../atoms/instant";
import { codeSchemeSchema, sourceCodeSchema, sourceSystemSchema } from "../../atoms/source-code";
import { codeLabelSchema } from "./normalized-code-release";

// 왜 `code-release` 계약과 나누나. release는 "정부 파일 한 벌이 코드 계층을 새로 선언했다"는 사실이고
// 그 봉투에는 승격 grain과 계층 상위가 들어 있다. 코드목록은 그것이 아니라 **이미 우리가 관측한 코드에
// 소스가 붙여 부르는 이름과 유효기간**이다. 둘을 한 계약으로 묶으면 grain이 없는 어휘가 grain을
// 지어내야 하고, 그 순간 우리가 정하지 않기로 한 계층을 계약이 요구하게 된다(AGENTS 3·6).
export const normalizedCodeVocabularyEntryV1Schema = z.strictObject({
  scheme: codeSchemeSchema,
  code: sourceCodeSchema,
  label: codeLabelSchema,
  // 소스가 더 쓰지 않는다고 말한 코드다. 과거 관측이 그 코드를 참조하므로 지우지 않고 내려만 둔다.
  active: z.boolean(),
  // 유효기간은 소스가 준 값이다. 주지 않으면 null이며 우리가 관측 시각으로 대신 채우지 않는다.
  validFrom: instantTextSchema.nullable(),
  validTo: instantTextSchema.nullable(),
  // 소스가 이 코드의 상위라고 말한 코드다(`SC067` 시군구의 `ITM_VL2`가 `SC066` 시도 코드). 계층을 우리가
  // 정하는 것이 아니라 소스가 그룹마다 다른 뜻으로 싣는 값이라, 어느 그룹에서 상위로 읽을지는 검토된 그룹
  // 표가 정하고 여기에는 읽은 결과만 실린다. 상위를 말하지 않은 코드는 null이다(EAT-260).
  parent: z.strictObject({ scheme: codeSchemeSchema, code: sourceCodeSchema }).nullable(),
}).meta({
  id: "NormalizedCodeVocabularyEntry",
  description: "One observed source code with the name and validity the source itself publishes for it.",
});
export type NormalizedCodeVocabularyEntryV1 = z.infer<typeof normalizedCodeVocabularyEntryV1Schema>;

export const normalizedCodeVocabularyV1Schema = z.strictObject({
  sourceSystem: sourceSystemSchema,
  dataset: z.string().min(1).max(128),
  // 원본 행 수와 어휘로 옮기지 못한 행 수를 같은 봉투에 싣는다. 무엇을 뺐는지가 봉투 밖에 있으면
  // 빠뜨림이 침묵한다(AGENTS 3). 둘의 차가 곧 `entries`의 길이다.
  sourceRowCount: nonNegativeCountSchema,
  excludedRowCount: nonNegativeCountSchema,
  entries: z.array(normalizedCodeVocabularyEntryV1Schema).max(100_000),
}).meta({
  id: "EatbidCodeVocabularyV1",
  description: "One sealed observation of a source-published code list, carried as code, name and validity.",
});
export type NormalizedCodeVocabularyV1 = z.infer<typeof normalizedCodeVocabularyV1Schema>;
