/**
 * @module 책임: 개발 DB(2층)가 만든 기기 환경으로 server와 web을 함께 띄우고, 두 앱이 같은 이름으로
 * 서로 다른 값을 원하는 `PORT`를 각자에게 따로 붙인다.
 *
 * `turbo dev`를 바로 쓰지 않는 이유가 그 `PORT` 하나다. 부모 환경에 값을 하나만 둘 수 있어 둘 중
 * 하나는 반드시 엉뚱한 자리에 선다. server는 환경변수 파일을 읽지 않으므로(ConfigModule이
 * `ignoreEnvFile`) 주입은 이 프로세스가 한다.
 */
import { spawn, spawnSync } from "node:child_process";

import { containerState } from "./container.mjs";
import {
  fillMissingSecrets,
  mergeEnvironment,
  readDevEnvFile,
  runtimeEnvironment,
} from "./dev-env.mjs";

/**
 * Windows에서 pnpm은 `.cmd` shim이라 shell 없이 spawn하면 EINVAL로 거절당한다. 인자를 배열로 넘기지
 * 않고 한 문자열로 합치는 이유는 shell에 넘긴 인자 배열이 이스케이프되지 않기 때문이며(DEP0190),
 * 이 자리의 인자는 전부 이 파일이 적은 고정 문자열이다.
 */
function launch(label, args, environment) {
  const child = spawn(`pnpm ${args.join(" ")}`, {
    env: { ...process.env, ...environment },
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => {
    process.stderr.write(`${label}이(가) 종료했습니다(code ${code}).\n`);
    process.exitCode = code ?? 1;
  });
  return child;
}

export function main() {
  const config = mergeEnvironment(fillMissingSecrets(readDevEnvFile()));
  if (containerState(config.EATBID_DEV_DB_CONTAINER) !== "running") {
    process.stderr.write(
      `개발 DB ${config.EATBID_DEV_DB_CONTAINER}이(가) 떠 있지 않습니다. 먼저 pnpm dev:db up 을 실행하세요.\n`,
    );
    process.exitCode = 1;
    return;
  }

  // server의 `dev`는 자기 소스만 컴파일하므로 workspace package의 `dist`가 없으면 `@eatbid/contracts`를
  // 찾지 못하고 기동 전에 죽는다. 갓 받은 저장소에서 두 명령 안에 화면을 보려면 이 build가 먼저다.
  const built = spawnSync("pnpm --filter @eatbid/contracts build", {
    stdio: "inherit",
    shell: true,
  });
  if (built.status !== 0) {
    process.stderr.write("workspace package build에 실패했습니다.\n");
    process.exitCode = 1;
    return;
  }

  const shared = runtimeEnvironment(config);
  process.stdout.write(
    `server http://localhost:${config.EATBID_DEV_API_PORT}`
      + `  web http://localhost:${config.EATBID_DEV_WEB_PORT}`
      + "  로그인 dev@eatbid.local / eatbid-dev-login\n"
      + "e2e는 같은 Next 작업 디렉터리를 쓰므로 이 명령을 먼저 끄고 돌린다.\n",
  );

  const children = [
    launch("server", ["--filter", "@eatbid/server", "dev"],
      { ...shared, PORT: config.EATBID_DEV_API_PORT }),
    launch("web", ["--filter", "@eatbid/web", "dev"],
      { ...shared, PORT: config.EATBID_DEV_WEB_PORT }),
  ];

  const stop = () => {
    for (const child of children) child.kill();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main();
