import { positiveBigintTextSchema } from "@eatbid/contracts";
import postgres from "postgres";

const DATABASE_CONNECT_TIMEOUT_SECONDS = 5;
const DATABASE_IDLE_TIMEOUT_SECONDS = 1;

type VerificationAuctionRow = {
  readonly auction_id: string | bigint;
  readonly revision_id: string | bigint;
};

export type VerificationAuction = {
  readonly auctionId: string;
  readonly revisionId: string;
};

/** DB 드라이버 값을 Number로 바꾸지 않고 공개 ID 경계와 같은 문자열로 검증한다. */
export function selectVerificationAuction(
  rows: readonly VerificationAuctionRow[],
): VerificationAuction {
  const row = rows[0];
  if (!row) throw new Error("검증할 canonical 공고가 없습니다.");

  return {
    auctionId: positiveBigintTextSchema.parse(String(row.auction_id)),
    revisionId: positiveBigintTextSchema.parse(String(row.revision_id)),
  };
}

async function findVerificationAuction(databaseUrl: string): Promise<VerificationAuction> {
  const database = postgres(databaseUrl, {
    max: 1,
    connect_timeout: DATABASE_CONNECT_TIMEOUT_SECONDS,
    idle_timeout: DATABASE_IDLE_TIMEOUT_SECONDS,
    prepare: false,
    onnotice: () => undefined,
  });

  try {
    // 최신 revision 하나만 읽으며 seed·update·connection 정보 출력은 수행하지 않는다.
    const rows = await database<VerificationAuctionRow[]>`
      select
        attempt.auction_attempt_id::text as auction_id,
        revision.auction_revision_id::text as revision_id
      from core.auction_revision revision
      join core.auction_attempt attempt
        on attempt.auction_attempt_id = revision.auction_attempt_id
      order by revision.auction_revision_id desc
      limit 1
    `;
    return selectVerificationAuction(rows);
  } finally {
    await database.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Infisical에서 DATABASE_URL을 주입해야 합니다.");

  const result = await findVerificationAuction(databaseUrl);
  process.stdout.write(`${result.auctionId}\t${result.revisionId}\n`);
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "검증 공고 조회에 실패했습니다.";
    console.error(message);
    process.exitCode = 1;
  });
}
