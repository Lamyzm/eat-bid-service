/** @module 책임: 로컬 k3d에 운영과 같은 Argo와 진짜 WorkflowTemplate을 올려 DAG가 실제로 시작되는지 판정하는 smoke를 소유한다. */
import { spawnSync } from "node:child_process";

import { locateRepository } from "./runtime.mjs";

// 2026-09-14~15의 세 버그(템플릿 env 누락 → exit 64, str(True) → when 조건 항상 거짓, promote 경합)는 전부
// 단위·계약 테스트를 통과하고 운영에서만 죽었다. 그것을 잡는 유일한 층이 "진짜 Argo에 진짜 템플릿을
// 제출해 보는 것"이고, 이 모듈이 그 층이다(EAT-226, docs/superpowers/plans/2026-09-16-observability-heartbeat-and-shape.md 2단계).

export const CLUSTER = "eatbid-smoke";
export const CONTEXT = `k3d-${CLUSTER}`;
export const NAMESPACE = "eatbid";
// 운영 Application(infra/platform/argo-workflows.application.yaml)과 같은 chart·버전이어야 여기서 검증한
// 것이 거기서 검증한 것이다. 값도 같이 맞추되 archiveLogs만 끈다 — 더미 R2 자격으로 켜면 파드 종료가
// 로그 업로드 실패로 Error가 되어 판정이 흐려진다.
export const CHART_VERSION = "1.0.23";
export const CHART_REPO = "https://argoproj.github.io/argo-helm";
export const OVERLAY = "infra/envs/smoke";
export const K3D_CONFIG = "infra/k3d-smoke.yaml";
export const CONFIGURATION_EXIT = "64";
export const TRANSIENT_NETWORK_EXIT = "69";

const HELM_VALUES = [
  "singleNamespace=true",
  "createAggregateRoles=false",
  "controller.clusterWorkflowTemplates.enabled=false",
  "workflow.serviceAccount.create=false",
  "workflow.serviceAccount.name=eatbid-dataplane",
  "workflow.rbac.create=true",
  "server.enabled=false",
  "crds.install=true",
  "artifactRepository.archiveLogs=false",
];

// 값은 저장소에 없고 smoke 클러스터 밖에서는 아무 뜻도 없다. 실제 값과 겹칠 수 없는 모양으로 둔다.
const DUMMY_SECRETS = {
  "eatbid-postgres-bootstrap": { POSTGRES_USER: "eatbid", POSTGRES_PASSWORD: "eatbid", POSTGRES_DB: "eatbid" },
  "eatbid-database-migrator": { DATABASE_URL: "postgresql://eatbid_migrator:smoke@postgres:5432/eatbid" },
  "eatbid-database-api": { DATABASE_URL: "postgresql://eatbid_api:smoke@postgres:5432/eatbid" },
  "eatbid-database-dataplane": {
    DATABASE_URL: "postgresql://eatbid_dataplane:smoke@postgres:5432/eatbid",
    EATBID_CACHE_REVALIDATE_TOKEN: "smoke",
  },
  "eatbid-cache-revalidate": { EATBID_CACHE_REVALIDATE_TOKEN: "smoke" },
  "eatbid-r2": {
    // R2Settings가 `<label>.r2.cloudflarestorage.com` 계정 루트만 받는다(storage/r2_store.py). 2026-09-16
    // 4차 실행에서 `https://r2.invalid`가 exit 64로 거부됐다. 모양은 맞추되 계정이 아닌 이름이라 어디에도
    // 닿지 않고, discover는 그 전에 eaT 연결에서 끝난다.
    R2_ENDPOINT_URL: "https://smoke.r2.cloudflarestorage.com",
    R2_BUCKET: "smoke",
    R2_ACCESS_KEY_ID: "smoke",
    R2_SECRET_ACCESS_KEY: "smoke",
  },
  "eatbid-auth": { BETTER_AUTH_SECRET: "smoke", GOOGLE_CLIENT_ID: "smoke", GOOGLE_CLIENT_SECRET: "smoke" },
  "eatbid-alerting": { TELEGRAM_BOT_TOKEN: "smoke", TELEGRAM_CHAT_ID: "0", HEARTBEAT_URL: "https://uptime.invalid/x" },
};

// migrator에 database CREATE를 주는 이유: Drizzle이 첫 migration에서 `create schema drizzle`을 하는데
// provisioning SQL은 스키마 *안* 권한만 선언한다. database 수준 CREATE는 bootstrap 사람 단계의 몫인데
// secret-contract.md의 절차에 그 줄이 없다(2026-09-16 smoke 2차 실행에서 실측 — 운영은 누군가 손으로 준
// 상태다). smoke는 운영이 실제로 갖는 상태를 재현한다.
const ROLES_SQL = [
  ...["eatbid_migrator", "eatbid_api", "eatbid_dataplane"].map(
    (role) => `create role ${role} login password 'smoke' nosuperuser nocreatedb nocreaterole noinherit;`,
  ),
  "grant create on database eatbid to eatbid_migrator;",
].join(" ");

const SMOKE_WORKFLOW = `apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: eatbid-smoke-
  namespace: ${NAMESPACE}
spec:
  workflowTemplateRef:
    name: eatbid-dataplane
  entrypoint: advancing-backfill-pipeline
  arguments:
    parameters:
      - name: mode
        value: backfill
`;

function kubectlArgs(args) {
  return ["--context", CONTEXT, "-n", NAMESPACE, ...args];
}

/**
 * 무엇을 할지 먼저 계산한다. 클러스터를 만들고 지우는 행위라 판정과 실행을 한 덩어리로 두면 어떤 순서로
 * 무엇이 일어나는지 테스트가 못 본다.
 *
 * 현재 kubeconfig의 context를 바꾸지 않는다(--kubeconfig-switch-context=false). 이 기계에는 운영 context가
 * 있고, smoke가 그것을 밀어내면 다른 세션의 kubectl이 조용히 다른 클러스터를 보게 된다. 모든 호출은
 * --context를 명시한다.
 */
export function planArgoSmoke({ skipBuild = false, gitSha = "0".repeat(40) } = {}) {
  const steps = [
    { label: "cleanup-before", command: "k3d", args: ["cluster", "delete", CLUSTER], allowFailure: true },
    {
      label: "cluster",
      command: "k3d",
      args: ["cluster", "create", "--config", K3D_CONFIG, "--kubeconfig-switch-context=false"],
    },
    { label: "namespace", command: "kubectl", args: ["--context", CONTEXT, "create", "namespace", NAMESPACE] },
    // monitoring-rbac.yaml이 argocd namespace의 Role을 함께 내므로 그 namespace가 있어야 apply가 선다.
    { label: "namespace-argocd", command: "kubectl", args: ["--context", CONTEXT, "create", "namespace", "argocd"] },
    {
      label: "argo",
      command: "helm",
      args: [
        "upgrade", "--install", "argo-workflows", "argo-workflows",
        "--repo", CHART_REPO, "--version", CHART_VERSION,
        "--kube-context", CONTEXT, "-n", NAMESPACE, "--wait", "--timeout", "180s",
        ...HELM_VALUES.flatMap((value) => ["--set", value]),
      ],
    },
  ];
  if (!skipBuild) {
    // Dockerfile의 GIT_SHA 기본값은 "unknown"이고 CLI는 --build-sha를 40/64자 소문자 hex로 검증한다(5차 실측:
    // discover exit 2). CI(build.yml·dev-image.yml)와 같은 자리에 같은 이름으로 HEAD를 넘긴다.
    steps.push(
      { label: "build-dataplane", command: "docker", args: ["build", "--build-arg", `GIT_SHA=${gitSha}`, "-t", "eatbid-dataplane:smoke", "-f", "apps/dataplane/Dockerfile", "apps/dataplane"] },
      { label: "build-migration", command: "docker", args: ["build", "-t", "eatbid-migration:smoke", "-f", "packages/db/Dockerfile", "."] },
    );
  }
  steps.push({ label: "import", command: "k3d", args: ["image", "import", "eatbid-dataplane:smoke", "eatbid-migration:smoke", "-c", CLUSTER] });
  for (const [name, data] of Object.entries(DUMMY_SECRETS)) {
    steps.push({
      label: `secret:${name}`,
      command: "kubectl",
      args: kubectlArgs(["create", "secret", "generic", name, ...Object.entries(data).map(([key, value]) => `--from-literal=${key}=${value}`)]),
    });
  }
  return steps;
}

/**
 * Workflow JSON 하나로 판정한다. 순수 함수라 실제 클러스터 없이 테스트한다.
 *
 * 두 사실을 본다. `run`이 Skipped·Omitted가 아니다 — when 조건이 실제로 통과했다는 뜻이고 2026-09-14의
 * `True == true`가 여기서 잡힌다. `discover`가 exit 69(TRANSIENT_NETWORK)로 끝났다 — 파드가 설정 검증을
 * 지나 소스 연결까지 갔다는 뜻이고, 64(CONFIGURATION)면 env 누락이다. 0이면 hostAliases가 소스를 막지
 * 못한 것이라 그것도 실패다(ADR 0051 결정 4).
 */
export function judgeSmoke(workflow) {
  const nodes = Object.values(workflow?.status?.nodes ?? {});
  const byName = (displayName) => nodes.find((node) => node.displayName === displayName);
  const decide = byName("decide");
  const run = byName("run");
  const discover = byName("discover");
  const discoverExit = discover?.outputs?.exitCode ?? null;
  const reasons = [];
  if (!decide || decide.phase !== "Succeeded") reasons.push(`decide가 Succeeded가 아니다: ${decide?.phase ?? "없음"}`);
  if (!run) reasons.push("run 노드가 없다");
  else if (run.phase === "Skipped" || run.phase === "Omitted") {
    reasons.push(`run이 건너뛰어졌다: ${run.message ?? run.phase} — when 조건이 거짓이다`);
  }
  if (!discover) reasons.push("discover 파드가 뜨지 않았다");
  else if (discoverExit === CONFIGURATION_EXIT) reasons.push("discover가 exit 64로 죽었다 — 설정(env) 누락");
  else if (discoverExit === "0") reasons.push("discover가 소스에 닿았다 — hostAliases가 eaT를 막지 못했다");
  else if (discoverExit !== TRANSIENT_NETWORK_EXIT) reasons.push(`discover exit가 ${discoverExit ?? "없음"}이다(69를 기대)`);
  return {
    ok: reasons.length === 0,
    reasons,
    nodes: { decide: decide?.phase ?? null, run: run?.phase ?? null, discoverExit },
  };
}

function run(cwd, command, args, { capture = false, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    input,
    stdio: capture ? [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] : [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    windowsHide: true,
  });
  if (result.error?.code === "ENOENT") throw new Error(`${command}을(를) 찾을 수 없습니다. k3d·kubectl·helm·docker가 PATH에 있어야 합니다.`);
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: String(result.stdout ?? "").trim(), stderr: String(result.stderr ?? "").trim() };
}

function kubectl(cwd, args, options) {
  return run(cwd, "kubectl", kubectlArgs(args), options);
}

function waitFor(cwd, label, probe, { timeoutMs, intervalMs = 5000 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const verdict = probe();
    if (verdict) return verdict;
    if (Date.now() > deadline) throw new Error(`${label}을(를) ${timeoutMs / 1000}초 안에 기다리지 못했습니다.`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
  }
}

function applyOverlay(cwd) {
  const rendered = run(cwd, "kubectl", ["kustomize", OVERLAY], { capture: true });
  if (rendered.status !== 0) throw new Error(`kustomize 렌더 실패:\n${rendered.stderr}`);
  // -n을 붙이지 않는다. 렌더의 모든 객체가 namespace를 이미 갖고 있고, monitoring-rbac.yaml의 Role 둘은
  // argocd namespace라 -n eatbid와 어긋나면 kubectl이 그 둘을 거부한다(2026-09-16 첫 실행에서 실측).
  const applied = run(cwd, "kubectl", ["--context", CONTEXT, "apply", "-f", "-"], { input: rendered.stdout });
  if (applied.status !== 0) throw new Error("overlay apply 실패");
}

/** 계획을 실행하고 판정한다. 실패한 단계에서 멈추고, 어느 경우든 클러스터를 지운다(--keep 제외). */
export async function runArgoSmoke({ cwd = process.cwd(), argv = process.argv.slice(3) } = {}) {
  const keep = argv.includes("--keep");
  const skipBuild = argv.includes("--skip-build");
  const root = locateRepository(cwd).worktreeRoot;
  if (!root) throw new Error("저장소 안에서 실행하세요.");

  const gitSha = run(root, "git", ["rev-parse", "HEAD"], { capture: true }).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(gitSha)) throw new Error("HEAD sha를 읽지 못했습니다.");

  try {
    for (const step of planArgoSmoke({ skipBuild, gitSha })) {
      process.stdout.write(`▶ ${step.label}\n`);
      const { status } = run(root, step.command, step.args);
      if (status !== 0 && !step.allowFailure) throw new Error(`${step.label} 단계가 실패했습니다(exit ${status}).`);
    }

    // 첫 apply는 Job 둘이 역할 부재로 죽는다(provisioning SQL이 역할 존재를 전제한다). postgres가 뜬 뒤
    // 역할을 만들고 Job만 지워 다시 apply한다 — manifest는 한 글자도 손대지 않는다.
    process.stdout.write("▶ apply(1차)\n");
    applyOverlay(root);
    waitFor(root, "postgres", () => kubectl(root, ["rollout", "status", "deployment/postgres", "--timeout=10s"], { capture: true }).status === 0, { timeoutMs: 180_000 });
    process.stdout.write("▶ roles\n");
    const roles = kubectl(root, ["exec", "deployment/postgres", "--", "psql", "-U", "eatbid", "-d", "eatbid", "-v", "ON_ERROR_STOP=1", "-c", ROLES_SQL], { capture: true });
    if (roles.status !== 0) throw new Error(`역할 생성 실패:\n${roles.stderr}`);
    kubectl(root, ["delete", "job", "eatbid-migration", "eatbid-db-provisioning", "--ignore-not-found"], { capture: true });
    process.stdout.write("▶ apply(2차)\n");
    applyOverlay(root);
    // Job의 최종 상태는 pod 실패 횟수가 아니라 conditions로 읽는다. backoffLimit 안의 재시도 중에는 failed가
    // 1이어도 아직 지지 않은 것이다 — 2026-09-16 3차 실행에서 그 순간을 최종 실패로 읽어 멈췄다.
    const waitJob = (job) => {
      process.stdout.write(`▶ wait ${job}\n`);
      waitFor(root, job, () => {
        const conditions = kubectl(root, ["get", "job", job, "-o", "jsonpath={.status.conditions[*].type}"], { capture: true }).stdout.split(/\s+/);
        if (conditions.includes("Complete")) return true;
        if (conditions.includes("Failed")) throw new Error(`${job}이(가) 실패했다. kubectl --context ${CONTEXT} -n ${NAMESPACE} logs job/${job}`);
        return false;
      }, { timeoutMs: 300_000 });
    };
    waitJob("eatbid-migration");
    // Argo CD는 sync-wave로 migration(1) 뒤에 provisioning(2)을 세우지만 kubectl apply에는 순서가 없다.
    // 둘이 함께 뜨면 provisioning이 스키마 없음으로 한 번 죽고 재시도에 기댄다. 순서를 여기서 명시한다.
    kubectl(root, ["delete", "job", "eatbid-db-provisioning", "--ignore-not-found"], { capture: true });
    process.stdout.write("▶ apply(3차: provisioning)\n");
    applyOverlay(root);
    waitJob("eatbid-db-provisioning");

    process.stdout.write("▶ submit\n");
    const created = kubectl(root, ["create", "-f", "-", "-o", "name"], { capture: true, input: SMOKE_WORKFLOW });
    if (created.status !== 0) throw new Error(`Workflow 제출 실패:\n${created.stderr}`);
    const name = created.stdout.split("/").pop();
    const finished = waitFor(root, "workflow", () => {
      const json = kubectl(root, ["get", "workflow", name, "-o", "json"], { capture: true }).stdout;
      const workflow = json ? JSON.parse(json) : null;
      const phase = workflow?.status?.phase;
      return ["Succeeded", "Failed", "Error"].includes(phase) ? workflow : null;
    }, { timeoutMs: 600_000, intervalMs: 10_000 });

    const verdict = judgeSmoke(finished);
    process.stdout.write(`${JSON.stringify({ workflow: name, phase: finished.status.phase, ...verdict }, null, 2)}\n`);
    if (!verdict.ok) throw new Error(`smoke 실패: ${verdict.reasons.join("; ")}`);
  } finally {
    if (keep) process.stdout.write(`클러스터를 남깁니다: kubectl --context ${CONTEXT} -n ${NAMESPACE} ...\n`);
    else run(root, "k3d", ["cluster", "delete", CLUSTER]);
  }
}
