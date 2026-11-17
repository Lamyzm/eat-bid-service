/** @module 책임: `pnpm workflow:*` 명령 이름을 pull request 열기·릴리스 태그·Argo smoke 절차에 연결한다. */
import { runArgoSmoke } from "./argo-smoke.mjs";
import { runPullRequest } from "./pull-request.mjs";
import { runTag } from "./tag.mjs";

async function main() {
  const command = process.argv[2];
  if (command === "pr") return runPullRequest();
  if (command === "argo-smoke") return runArgoSmoke();
  if (command === "tag") return runTag();
  throw new Error(`Unknown workflow command: ${command ?? "missing"} (pr | tag | argo-smoke)`);
}

main().catch((error) => {
  process.stderr.write(`eatbid workflow command failed: ${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
