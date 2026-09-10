/**
 * @module 책임: 개발 로그인 모드의 로컬 DB에 고정 시드 계정·초기화된 워크스페이스·등록 사업자 하나를
 * 멱등하게 만들고, 그 명령이 production이나 개발 로그인이 꺼진 배포에서는 돌지 않게 막는다.
 *
 * 사용자 행은 raw SQL이 아니라 pinned Better Auth 서버 API로 만든다. 비밀번호 해시가 provider의 것과 같아야
 * 로그인 화면의 sign-in이 운영과 같은 검증 경로를 지난다. 워크스페이스 초기화와 사업자 등록은 계정 모듈의
 * use case를 호출만 한다. 시드가 자기 SQL을 적으면 명시적 계정 초기화의 불변식(ADR 0032 §2·§8)이 두 벌이 된다.
 */
import { systemClock } from "@eatbid/domain";
import type { AccountRepository } from "../../modules/account/application/account-repository";
import { InitializeCurrentAccount } from "../../modules/account/application/initialize-current-account";
import { ListMyBusinesses, RegisterMyBusiness } from "../../modules/account/application/manage-my-businesses";
import { DrizzleAccountRepository } from "../../modules/account/infrastructure/drizzle/drizzle-account-repository";
import { readEnvironment, type Environment } from "../config/environment";
import { createAuthDatabaseBinding } from "../database/auth-database-adapter";
import { createManagedDatabase } from "../database/managed-database";
import { EffectRunner } from "../effect/effect-runner";
import { LoggingModule } from "../logging/logging.module";
import { createAuthInstance, type AuthInstance } from "./auth-instance";

/**
 * 로컬 개발이 매번 같은 계정으로 들어오게 하는 고정값이다. 비밀번호는 문서(`docs/operations/local-dev-login.md`)에도
 * 적히는 개발용 값이며 운영 자격이 아니다. provider가 `EATBID_DEV_LOGIN` 없이는 이 방법을 열지 않으므로
 * 이 값이 운영 세션이 되는 경로는 없다(ADR 0032 §13).
 */
export const DEV_LOGIN_ACCOUNT = Object.freeze({
  email: "dev@eatbid.local",
  password: "eatbid-dev-login",
  name: "개발 사용자",
  /**
   * 검증번호는 통과하지만 실제 납품업체의 번호가 아닌 합성 사업자등록번호다. 실제 수집 자료 사본 위에서
   * 시드 워크스페이스가 남의 참여 기록에 연결되지 않게 한다. 미관측 등록은 정상 상태다(ADR 0032 §7).
   */
  businessNumber: "9000000016",
});

export interface DevLoginSeedResult {
  readonly email: string;
  /** provider가 만든 사용자 식별자다. app principal의 identity subject가 된다. */
  readonly subject: string;
  readonly user: "created" | "existing";
  readonly principalId: string;
  readonly workspaceId: string;
  readonly business: "registered" | "existing";
}

export interface DevLoginSeedDependencies {
  readonly auth: AuthInstance;
  readonly repository: AccountRepository;
  readonly effectRunner: EffectRunner;
}

/**
 * 세 단계 모두 "없으면 만들고 있으면 그대로 둔다". 사용자는 이메일로, 워크스페이스는 identity subject로,
 * 사업자는 등록 목록으로 존재를 판정하므로 몇 번을 돌려도 같은 관계 하나만 남는다.
 */
export async function seedDevLogin(dependencies: DevLoginSeedDependencies): Promise<DevLoginSeedResult> {
  const { auth, repository, effectRunner } = dependencies;
  const context = await auth.$context;
  const existing = await context.internalAdapter.findUserByEmail(DEV_LOGIN_ACCOUNT.email);
  if (existing === null) {
    // `autoSignIn`이 꺼져 있어 세션 행을 남기지 않고, 이미 있는 이메일이면 provider가 합성 사용자를 돌려주므로
    // 응답의 id를 믿지 않고 아래에서 저장된 행을 다시 읽는다.
    await auth.api.signUpEmail({
      body: {
        name: DEV_LOGIN_ACCOUNT.name,
        email: DEV_LOGIN_ACCOUNT.email,
        password: DEV_LOGIN_ACCOUNT.password,
      },
    });
  }
  const stored = await context.internalAdapter.findUserByEmail(DEV_LOGIN_ACCOUNT.email);
  if (stored === null) throw new Error("Dev login seed could not read the seeded user back");
  const subject = stored.user.id;

  const initialized = await effectRunner.run(new InitializeCurrentAccount(repository).execute(subject));
  const principal = await repository.findPrincipalBySubject(subject);
  if (principal === null) throw new Error("Dev login seed initialized the account but could not resolve its principal");

  // use case는 공개 응답이 아니라 내부 record를 돌려준다(ADR 0045 결정 1). 십진 문자열은 이 명령의 출력 경계에서만 만든다.
  const listed = await effectRunner.run(new ListMyBusinesses(repository).execute(principal));
  const alreadyRegistered = listed
    .some((business) => business.businessNumber === DEV_LOGIN_ACCOUNT.businessNumber);
  if (!alreadyRegistered) {
    await effectRunner.run(new RegisterMyBusiness(repository).execute({
      principal,
      businessNumber: DEV_LOGIN_ACCOUNT.businessNumber,
    }));
  }

  return {
    email: DEV_LOGIN_ACCOUNT.email,
    subject,
    user: existing === null ? "created" : "existing",
    principalId: initialized.principalId.toString(10),
    workspaceId: initialized.workspace.workspaceId.toString(10),
    business: alreadyRegistered ? "existing" : "registered",
  };
}

/**
 * 검증된 환경 하나로 연결·provider·저장소를 조립해 시드를 돌리고 연결을 닫는다. 환경 경계가 production의
 * 개발 로그인을 이미 거부하지만, 이 명령은 DB에 쓰므로 자기 전제도 한 번 더 확인한다.
 */
export async function runDevLoginSeed(
  environment: Environment,
  logWriter?: (line: string) => void,
): Promise<DevLoginSeedResult> {
  if (environment.runtimeMode === "production" || environment.auth === null || !environment.auth.devLoginEnabled) {
    throw new Error("Dev login seed requires EATBID_DEV_LOGIN=true outside production");
  }
  const connection = createManagedDatabase(environment.databaseUrl);
  try {
    const auth = createAuthInstance({
      environment: environment.auth,
      database: createAuthDatabaseBinding(connection),
      trustedOrigins: environment.corsOrigins,
      logger: LoggingModule.create(environment, systemClock, logWriter),
    });
    return await seedDevLogin({
      auth,
      repository: new DrizzleAccountRepository(connection.database),
      effectRunner: new EffectRunner(),
    });
  } finally {
    await connection.client.end();
  }
}

async function runCli(): Promise<void> {
  const result = await runDevLoginSeed(readEnvironment());
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  void runCli().catch((error: unknown) => {
    // 예외 객체 전체를 쏟지 않는다. driver 예외의 cause·stack에는 연결 URL이 그대로 들어 있을 수 있다.
    console.error(`개발 로그인 시드 실패: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exitCode = 1;
  });
}
