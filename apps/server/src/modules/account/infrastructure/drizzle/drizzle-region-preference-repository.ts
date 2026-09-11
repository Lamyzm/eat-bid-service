/** @module 책임: 관심 지역 port를 조회·교체 질의 묶음에 연결하는 adapter 경계만 소유한다. */
import type {
  RegionPreferenceRecord,
  RegionPreferenceRepository,
  ReplaceRegionPreferenceInput,
  ReplaceRegionPreferenceResult,
} from "../../application/region-preference-repository";
import type { AccountDatabase } from "./account-sql";
import { readPreference, replacePreference } from "./region-preference-queries";

export class DrizzleRegionPreferenceRepository implements RegionPreferenceRepository {
  constructor(private readonly database: AccountDatabase) {}

  readPreference(workspaceId: bigint): Promise<RegionPreferenceRecord> {
    return readPreference(this.database, workspaceId);
  }

  replacePreference(input: ReplaceRegionPreferenceInput): Promise<ReplaceRegionPreferenceResult> {
    return replacePreference(this.database, input);
  }
}
