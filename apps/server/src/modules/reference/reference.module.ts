/** @module 책임: 기준정보 조회 use case와 HTTP controller를 주입 토큰에 연결하는 Nest 조립만 담당한다. */
import { Module } from "@nestjs/common";
import type { CodeReader } from "./application/code-reader";
import { ListCodes } from "./application/list-codes";
import { CodeSchemesController } from "./presentation/http/code-schemes.controller";
import { CODE_READER } from "../../platform/database/database.tokens";

const listCodesProvider = {
  provide: ListCodes,
  inject: [CODE_READER],
  useFactory: (reader: CodeReader) => new ListCodes(reader),
};

@Module({
  controllers: [CodeSchemesController],
  providers: [listCodesProvider],
})
export class ReferenceModule {}
