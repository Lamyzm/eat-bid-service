/** @module 책임: 저장된 조건 조합 port를 조회·저장·삭제 질의 묶음에 연결하는 adapter 경계만 소유한다. */
import type {
  DeleteFilterCombinationResult,
  FilterCombinationRecord,
  FilterCombinationRepository,
  SaveFilterCombinationInput,
  SaveFilterCombinationResult,
} from "../../application/filter-combination-repository";
import type { AccountDatabase } from "./account-sql";
import { deleteCombination, listCombinations, saveCombination } from "./filter-combination-queries";

export class DrizzleFilterCombinationRepository implements FilterCombinationRepository {
  constructor(private readonly database: AccountDatabase) {}

  listCombinations(workspaceId: bigint): Promise<readonly FilterCombinationRecord[]> {
    return listCombinations(this.database, workspaceId);
  }

  saveCombination(input: SaveFilterCombinationInput): Promise<SaveFilterCombinationResult> {
    return saveCombination(this.database, input);
  }

  deleteCombination(input: {
    readonly workspaceId: bigint;
    readonly filterCombinationId: bigint;
  }): Promise<DeleteFilterCombinationResult> {
    return deleteCombination(this.database, input);
  }
}
