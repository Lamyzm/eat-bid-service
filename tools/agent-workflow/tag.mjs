/** @module 책임: 릴리스 태그를 만들기 전에 "빌드 중 병합"과 "검증되지 않은 main" 조건을 거부하고, 통과하면 origin/main HEAD에 annotated tag를 API로 만드는 절차를 소유한다. */
import { spawnSync } from "node:child_process";

const VERSION = /^v\d+\.\d+\.\d+$/u;
const BUILD_WORKFLOW = "build.yml";
const VALIDATE_WORKFLOW = "validate.yml";
const ACTIVE_RUN_STATUSES = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

/**
 * 태그를 만들어도 되는지 판정한다. 순수 함수라 원격 없이 검증한다.
 *
 * 왜 거부하는가: build.yml의 promote는 태그 커밋이 그 시점 origin/main과 같아야 승격한다. 빌드 12분 사이에
 * PR이 병합되면 main이 움직여 "Refuse to promote onto a different commit"으로 버려진다(v0.1.30, 2026-09-15).
 * auto-merge가 켜진 PR은 CI가 초록이 되는 순간 사람 없이 병합되므로, 열려 있는 것만으로 이미 위험이다.
 *
 * 왜 main의 validate 회차까지 보는가: PR 검사가 초록이어도 병합 커밋의 main 회차는 따로 돈다. v0.1.36은 그
 * 회차가 실패로 끝난 2분 뒤에 태그됐고, main은 9월 11일부터 빨간 채로 v0.1.33~36이 나갔다(EAT-242). 장애를
 * 고치는 배포까지 막으면 안 되므로 `hotfixReason`이 있으면 통과시키되 그 사유는 태그 메시지에 남는다.
 */
export function judgeTagPreconditions({
  version,
  buildRuns = [],
  pullRequests = [],
  existingTag = false,
  mainValidation = undefined,
  hotfixReason = undefined,
}) {
  const reasons = [];
  if (!VERSION.test(version)) reasons.push(`버전은 vX.Y.Z 꼴이어야 합니다: ${version}`);
  if (existingTag) reasons.push(`release/${version} 태그가 이미 있습니다. 새 patch 버전으로 다시 발행하세요.`);
  const validated = mainValidation?.status === "completed" && mainValidation?.conclusion === "success";
  if (!validated && !hotfixReason) {
    const seen = mainValidation
      ? `#${mainValidation.databaseId}(${mainValidation.status}/${mainValidation.conclusion ?? "-"})`
      : "회차 없음";
    reasons.push(
      `origin/main HEAD의 ${VALIDATE_WORKFLOW} 회차가 초록이 아닙니다: ${seen}. ` +
        '고쳐서 병합한 뒤 발행하거나, 장애 복구라면 --hotfix "<사유>"로 사유를 남기고 발행하세요.',
    );
  }
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

/** 태그 메시지를 조립한다. hotfix 사유는 사람이 준 메시지가 있어도 반드시 붙는다 — 검증을 건너뛴 사실이 태그에 남아야 한다. */
export function composeTagMessage({ version, sha, subject, message, hotfixReason }) {
  const base = message ?? `release ${version}\n\nmain ${sha.slice(0, 8)}: ${subject}`;
  return hotfixReason ? `${base}\n\nhotfix: ${hotfixReason}` : base;
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
  if (!version) throw new Error('Usage: pnpm workflow:tag -- vX.Y.Z [--message <text>] [--hotfix "<사유>"]');
  const messageIndex = argv.indexOf("--message");
  const message = messageIndex >= 0 ? argv[messageIndex + 1] : undefined;
  const hotfixIndex = argv.indexOf("--hotfix");
  const hotfixReason = hotfixIndex >= 0 ? argv[hotfixIndex + 1]?.trim() : undefined;
  if (hotfixIndex >= 0 && !hotfixReason) throw new Error("--hotfix에는 사유가 있어야 합니다. 태그 메시지에 남습니다.");

  const repository = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const sha = gh(["api", `repos/${repository}/commits/main`, "--jq", ".sha"]);
  const buildRuns = [
    ...json(["run", "list", "--workflow", BUILD_WORKFLOW, "--status", "in_progress", "--json", "databaseId,status"]),
    ...json(["run", "list", "--workflow", BUILD_WORKFLOW, "--status", "queued", "--json", "databaseId,status"]),
  ];
  const pullRequests = json(["pr", "list", "--state", "open", "--json", "number,headRefName,autoMergeRequest"]);
  // 병합 커밋 그 자체의 main 회차다. 브랜치 최신이 아니라 이 sha의 회차를 본다 — 그 사이 다른 병합이 있었으면
  // 태그 커밋과 검증된 커밋이 다르기 때문이다.
  const [mainValidation] = json([
    "run", "list", "--workflow", VALIDATE_WORKFLOW, "--branch", "main", "--commit", sha, "--limit", "1",
    "--json", "databaseId,status,conclusion",
  ]);
  const existing = spawnSync("gh", ["api", `repos/${repository}/git/ref/tags/release/${version}`], { encoding: "utf8", windowsHide: true });
  const verdict = judgeTagPreconditions({
    version, buildRuns, pullRequests, existingTag: existing.status === 0, mainValidation, hotfixReason,
  });
  if (!verdict.ok) throw new Error(`태그를 만들지 않았습니다.\n- ${verdict.reasons.join("\n- ")}`);

  const subject = gh(["api", `repos/${repository}/commits/main`, "--jq", ".commit.message | split(\"\\n\")[0]"]);
  const tagger = { name: gh(["api", "user", "--jq", ".login"]), email: gh(["api", "user", "--jq", '.email // (.login + "@users.noreply.github.com")']) };
  const plan = planTag({ version, sha, message: composeTagMessage({ version, sha, subject, message, hotfixReason }), tagger });

  const tagSha = gh(["api", "-X", "POST", `repos/${repository}/git/tags`, "--input", "-", "--jq", ".sha"], { input: JSON.stringify(plan.object) });
  const ref = gh(["api", "-X", "POST", `repos/${repository}/git/refs`, "--input", "-", "--jq", ".ref"], { input: JSON.stringify(plan.ref(tagSha)) });
  process.stdout.write(`${ref} → ${sha.slice(0, 8)} (${subject})\n`);
  process.stdout.write(`빌드가 도는 약 12분 동안 main에 아무것도 병합하지 마세요. 진행: gh run list --workflow ${BUILD_WORKFLOW} --limit 1\n`);
}
