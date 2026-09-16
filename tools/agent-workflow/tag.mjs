/** @module 책임: 릴리스 태그를 만들기 전에 "빌드 중 병합"이 일어날 조건을 거부하고, 통과하면 origin/main HEAD에 annotated tag를 API로 만드는 절차를 소유한다. */
import { spawnSync } from "node:child_process";

const VERSION = /^v\d+\.\d+\.\d+$/u;
const BUILD_WORKFLOW = "build.yml";
const ACTIVE_RUN_STATUSES = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

/**
 * 태그를 만들어도 되는지 판정한다. 순수 함수라 원격 없이 검증한다.
 *
 * 왜 거부하는가: build.yml의 promote는 태그 커밋이 그 시점 origin/main과 같아야 승격한다. 빌드 12분 사이에
 * PR이 병합되면 main이 움직여 "Refuse to promote onto a different commit"으로 버려진다(v0.1.30, 2026-09-15).
 * auto-merge가 켜진 PR은 CI가 초록이 되는 순간 사람 없이 병합되므로, 열려 있는 것만으로 이미 위험이다.
 */
export function judgeTagPreconditions({ version, buildRuns = [], pullRequests = [], existingTag = false }) {
  const reasons = [];
  if (!VERSION.test(version)) reasons.push(`버전은 vX.Y.Z 꼴이어야 합니다: ${version}`);
  if (existingTag) reasons.push(`release/${version} 태그가 이미 있습니다. 새 patch 버전으로 다시 발행하세요.`);
  const active = buildRuns.filter((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (active.length > 0) {
    reasons.push(`release 빌드가 아직 돌고 있습니다: ${active.map((run) => `#${run.databaseId}(${run.status})`).join(", ")}. 끝난 뒤 발행하세요.`);
  }
  const armed = pullRequests.filter((pr) => pr.autoMergeRequest);
  if (armed.length > 0) {
    reasons.push(
      `auto-merge가 켜진 PR이 열려 있습니다: ${armed.map((pr) => `#${pr.number}(${pr.headRefName})`).join(", ")}. ` +
        "빌드 중에 병합되면 promote가 거부되므로 먼저 병합을 끝내거나 auto-merge를 끄세요.",
    );
  }
  return { ok: reasons.length === 0, reasons };
}

/** annotated tag 객체와 ref 생성 요청 둘을 데이터로 만든다. 실행은 runTag가 한다. */
export function planTag({ version, sha, message, tagger }) {
  return {
    tag: `release/${version}`,
    object: { tag: `release/${version}`, message, object: sha, type: "commit", tagger },
    ref: (tagSha) => ({ ref: `refs/tags/release/${version}`, sha: tagSha }),
  };
}

function gh(args, { input } = {}) {
  const result = spawnSync("gh", args, { encoding: "utf8", input, shell: false, windowsHide: true });
  if (result.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} 실패: ${(result.stderr || "").trim()}`);
  return result.stdout.trim();
}

function json(args) {
  const text = gh(args);
  return text ? JSON.parse(text) : [];
}

export async function runTag({ argv = process.argv.slice(3) } = {}) {
  const version = argv.find((argument) => !argument.startsWith("--"));
  if (!version) throw new Error("Usage: pnpm workflow:tag -- vX.Y.Z [--message <text>]");
  const messageIndex = argv.indexOf("--message");
  const message = messageIndex >= 0 ? argv[messageIndex + 1] : undefined;

  const repository = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const buildRuns = [
    ...json(["run", "list", "--workflow", BUILD_WORKFLOW, "--status", "in_progress", "--json", "databaseId,status"]),
    ...json(["run", "list", "--workflow", BUILD_WORKFLOW, "--status", "queued", "--json", "databaseId,status"]),
  ];
  const pullRequests = json(["pr", "list", "--state", "open", "--json", "number,headRefName,autoMergeRequest"]);
  const existing = spawnSync("gh", ["api", `repos/${repository}/git/ref/tags/release/${version}`], { encoding: "utf8", windowsHide: true });
  const verdict = judgeTagPreconditions({ version, buildRuns, pullRequests, existingTag: existing.status === 0 });
  if (!verdict.ok) throw new Error(`태그를 만들지 않았습니다.\n- ${verdict.reasons.join("\n- ")}`);

  const sha = gh(["api", `repos/${repository}/commits/main`, "--jq", ".sha"]);
  const subject = gh(["api", `repos/${repository}/commits/main`, "--jq", ".commit.message | split(\"\\n\")[0]"]);
  const tagger = { name: gh(["api", "user", "--jq", ".login"]), email: gh(["api", "user", "--jq", '.email // (.login + "@users.noreply.github.com")']) };
  const plan = planTag({ version, sha, message: message ?? `release ${version}\n\nmain ${sha.slice(0, 8)}: ${subject}`, tagger });

  const tagSha = gh(["api", "-X", "POST", `repos/${repository}/git/tags`, "--input", "-", "--jq", ".sha"], { input: JSON.stringify(plan.object) });
  const ref = gh(["api", "-X", "POST", `repos/${repository}/git/refs`, "--input", "-", "--jq", ".ref"], { input: JSON.stringify(plan.ref(tagSha)) });
  process.stdout.write(`${ref} → ${sha.slice(0, 8)} (${subject})\n`);
  process.stdout.write(`빌드가 도는 약 12분 동안 main에 아무것도 병합하지 마세요. 진행: gh run list --workflow ${BUILD_WORKFLOW} --limit 1\n`);
}
