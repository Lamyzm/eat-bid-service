import assert from "node:assert/strict";
import test from "node:test";

import { judgeSmoke, planArgoSmoke } from "./argo-smoke.mjs";

function workflow({ decide = "Succeeded", run = "Succeeded", discoverExit = "69", withDiscover = true } = {}) {
  const nodes = {
    a: { displayName: "decide", phase: decide },
    b: { displayName: "run", phase: run, message: run === "Skipped" ? "when 'True == true' evaluated false" : "" },
  };
  if (withDiscover) nodes.c = { displayName: "discover", phase: "Failed", outputs: { exitCode: discoverExit } };
  return { status: { phase: "Failed", nodes } };
}

test("decide 성공·run 실행·discover exit 69면 통과한다", () => {
  const verdict = judgeSmoke(workflow());

  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.nodes, { decide: "Succeeded", run: "Succeeded", discoverExit: "69" });
});

test("run이 Skipped면 when 조건이 거짓인 것이라 실패한다", () => {
  // 2026-09-14 str(True) → "True == true"가 정확히 이 모양이었다. 28시간 동안 매시 Succeeded였다.
  const verdict = judgeSmoke(workflow({ run: "Skipped" }));

  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join("\n"), /when 조건이 거짓/);
});

test("discover가 exit 64면 설정 누락이라 실패한다", () => {
  // 2026-09-14 첫 전진 회차가 R2 env 넷 없이 exit 64로 죽었다.
  const verdict = judgeSmoke(workflow({ discoverExit: "64" }));

  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join("\n"), /exit 64/);
});

test("discover가 exit 0이면 소스를 막지 못한 것이라 실패한다", () => {
  const verdict = judgeSmoke(workflow({ discoverExit: "0" }));

  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join("\n"), /hostAliases/);
});

test("discover 파드가 없으면 실패한다", () => {
  const verdict = judgeSmoke(workflow({ withDiscover: false }));

  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join("\n"), /discover 파드/);
});

test("계획은 현재 kubeconfig context를 바꾸지 않고 모든 호출에 context를 명시한다", () => {
  // 이 기계에는 운영 context가 있다. smoke가 그것을 밀어내면 다른 세션의 kubectl이 조용히 다른
  // 클러스터를 본다.
  const steps = planArgoSmoke();

  const cluster = steps.find((step) => step.label === "cluster");
  assert.equal(cluster.args.includes("--kubeconfig-switch-context=false"), true);
  for (const step of steps.filter((step) => step.command === "kubectl")) {
    assert.equal(step.args.includes("--context"), true, step.label);
  }
  assert.equal(steps.find((step) => step.label === "argo").args.includes("--kube-context"), true);
});

test("순서는 정리 → 클러스터 → namespace → Argo → 이미지 → Secret이다", () => {
  const labels = planArgoSmoke().map((step) => step.label);

  assert.deepEqual(labels.slice(0, 8), [
    "cleanup-before",
    "cluster",
    "namespace",
    "namespace-argocd",
    "argo",
    "build-dataplane",
    "build-migration",
    "import",
  ]);
  assert.equal(labels.filter((label) => label.startsWith("secret:")).length, 8);
});

test("dataplane 이미지는 HEAD sha를 GIT_SHA로 받아 빌드한다", () => {
  const sha = "a".repeat(40);
  const build = planArgoSmoke({ gitSha: sha }).find((step) => step.label === "build-dataplane");

  assert.equal(build.args.includes(`GIT_SHA=${sha}`), true);
  assert.equal(build.args[build.args.indexOf(`GIT_SHA=${sha}`) - 1], "--build-arg");
});

test("--skip-build면 빌드 단계만 빠진다", () => {
  const labels = planArgoSmoke({ skipBuild: true }).map((step) => step.label);

  assert.equal(labels.includes("build-dataplane"), false);
  assert.equal(labels.includes("import"), true);
});

test("Argo는 운영과 같은 chart 버전이고 archiveLogs만 끈다", () => {
  const argo = planArgoSmoke().find((step) => step.label === "argo");

  assert.equal(argo.args[argo.args.indexOf("--version") + 1], "1.0.23");
  assert.equal(argo.args.includes("artifactRepository.archiveLogs=false"), true);
  assert.equal(argo.args.includes("workflow.serviceAccount.name=eatbid-dataplane"), true);
});
