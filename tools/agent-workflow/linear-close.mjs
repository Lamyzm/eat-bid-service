/** @module 책임: 병합된 pull request의 branch에서 Linear issue를 읽어 그 팀의 완료 상태로 옮기는 절차를 소유한다. */
import { extractIssueIdentifier } from "./workflow.mjs";

const LINEAR_ENDPOINT = "https://api.linear.app/graphql";

/**
 * 무엇을 할지 먼저 정한다. 순수 함수라 원격 없이 검증한다.
 *
 * 왜 건너뛰기가 실패가 아닌가: 이 단계는 병합 뒤에 돈다. 여기서 실패로 끝내면 이미 main에 들어간
 * 변경에 빨간 표시가 붙어 다음 사람이 배포를 멈칫하게 된다. issue를 못 옮긴 것은 코드 문제가 아니므로
 * 이유를 남기고 통과시킨다.
 *
 * 왜 issue 상태를 먼저 보는가: 이미 완료인 issue를 다시 옮기면 Linear의 완료 시각이 병합 시각으로
 * 덮여 언제 끝났는지가 사라진다.
 */
export function planIssueClose({ merged, branch, apiKeyPresent, otherOpenBranches = [] }) {
  if (!merged) {
    return { act: false, reason: "병합되지 않은 pull request입니다." };
  }
  const issue = extractIssueIdentifier(branch);
  if (!issue) {
    return { act: false, reason: `branch ${branch}에 issue 식별자가 없습니다.` };
  }
  // 한 issue가 pull request 하나로 끝나지 않는 경우가 있다. EAT-176은 #96·#101 둘이 걸렸고 첫 번째가
  // 병합될 때 닫혔다면 나머지 작업이 완료된 issue 밑에서 진행됐을 것이다. 같은 issue를 가리키는 열린
  // pull request가 남아 있으면 아직 끝난 것이 아니다.
  const pending = otherOpenBranches.filter((other) => extractIssueIdentifier(other) === issue);
  if (pending.length > 0) {
    return {
      act: false,
      issue,
      reason: `${issue}를 가리키는 열린 pull request가 남아 있습니다: ${pending.join(", ")}`,
    };
  }
  if (!apiKeyPresent) {
    return { act: false, issue, reason: `LINEAR_API_KEY가 없어 ${issue}를 옮기지 않았습니다.` };
  }
  return { act: true, issue, reason: `${issue}를 완료로 옮깁니다.` };
}

/**
 * 하위 issue가 하나라도 열려 있으면 부모를 닫지 않는다.
 *
 * 왜: branch 이름은 "어느 issue의 작업인가"는 말해도 "그 issue가 끝났는가"는 말하지 않는다. epic은
 * 특히 그렇다 — EAT-176은 하위가 13개이고 그중 8개가 열린 채로 자식 하나의 pull request가 병합된다.
 * 잘못 닫힌 issue는 아무도 다시 보지 않지만 안 닫힌 issue는 다음 정리에서 눈에 띈다. 비용이
 * 비대칭이므로 확신이 없으면 닫지 않는 쪽으로 기운다.
 */
export function openChildren(children) {
  return children.filter((child) => child.state?.type !== "completed" && child.state?.type !== "canceled");
}

/**
 * 팀의 상태 목록에서 완료 상태 하나를 고른다.
 *
 * 왜 이름이 아니라 type으로 고르는가: 상태 이름은 사람이 언제든 바꾼다("Done" → "완료"). `completed`는
 * Linear가 소유하는 분류라 이름이 바뀌어도 그대로다. 같은 type이 여럿이면 화면 순서(position)가 가장
 * 앞선 것을 쓴다 — 팀이 완료를 여러 단계로 나눴다면 첫 번째가 "방금 끝난 것"이다.
 */
export function chooseCompletedState(states) {
  const completed = states.filter((state) => state.type === "completed");
  if (completed.length === 0) return null;
  return completed.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
}

async function callLinear(fetchImpl, apiKey, query, variables) {
  const response = await fetchImpl(LINEAR_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Linear API가 ${response.status}를 돌려줬습니다.`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    // 응답 본문 전체를 그대로 찍지 않는다 — 오류 객체에 요청 헤더가 섞여 나오는 경우가 있다.
    throw new Error(`Linear API 오류: ${payload.errors.map((error) => error.message).join("; ")}`);
  }
  return payload.data;
}

const ISSUE_QUERY = `
  query IssueForClose($id: String!) {
    issue(id: $id) {
      id
      identifier
      state { id name type }
      children { nodes { identifier state { type } } }
      team { id states { nodes { id name type position } } }
    }
  }
`;

const UPDATE_MUTATION = `
  mutation CloseIssue($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) { success }
  }
`;

/** 실제로 옮긴다. 이미 완료거나 완료 상태가 없으면 아무것도 하지 않고 이유를 돌려준다. */
export async function closeIssue({ apiKey, identifier, fetchImpl = fetch }) {
  const data = await callLinear(fetchImpl, apiKey, ISSUE_QUERY, { id: identifier });
  const issue = data?.issue;
  if (!issue) return { moved: false, reason: `${identifier}를 Linear에서 찾지 못했습니다.` };
  if (issue.state?.type === "completed") {
    return { moved: false, reason: `${identifier}는 이미 ${issue.state.name}입니다.` };
  }
  const stillOpen = openChildren(issue.children?.nodes ?? []);
  if (stillOpen.length > 0) {
    const names = stillOpen.map((child) => child.identifier).join(", ");
    return { moved: false, reason: `${identifier}는 하위 issue ${stillOpen.length}개가 열려 있어 닫지 않습니다: ${names}` };
  }
  const target = chooseCompletedState(issue.team?.states?.nodes ?? []);
  if (!target) {
    return { moved: false, reason: `${identifier}의 팀에 완료 상태가 없습니다.` };
  }
  await callLinear(fetchImpl, apiKey, UPDATE_MUTATION, { id: issue.id, stateId: target.id });
  return { moved: true, reason: `${identifier}를 ${issue.state?.name ?? "?"}에서 ${target.name}으로 옮겼습니다.` };
}

/** GitHub Actions에서 부르는 진입점이다. 어떤 경우에도 0으로 끝난다. */
export async function main() {
  const branch = process.env.PR_HEAD_REF ?? "";
  const merged = process.env.PR_MERGED === "true";
  const apiKey = process.env.LINEAR_API_KEY ?? "";
  const otherOpenBranches = (process.env.OPEN_PR_BRANCHES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name !== branch);
  const plan = planIssueClose({
    merged,
    branch,
    apiKeyPresent: apiKey.length > 0,
    otherOpenBranches,
  });
  if (!plan.act) {
    console.log(`건너뜀: ${plan.reason}`);
    return;
  }
  try {
    const result = await closeIssue({ apiKey, identifier: plan.issue });
    console.log(result.reason);
  } catch (error) {
    console.log(`옮기지 못했습니다: ${error.message}`);
  }
}
