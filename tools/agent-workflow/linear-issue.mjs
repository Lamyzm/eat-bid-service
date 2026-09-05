/** @module 책임: team·workflow state·project를 이름으로 조회해 새 Linear issue를 발행하는 GraphQL 경계를 소유한다. */
import { LinearApiError } from "./linear-error.mjs";

// team 조회는 key 하나로 좁히고 project는 team 밖에서도 공유되므로 root connection에서 읽는다.
// Linear GraphQL은 요청 복잡도 상한이 있어 `first`를 열어두면 조회 자체가 거부된다. 발행에 필요한
// 것은 이름 → id 해소뿐이므로 페이지를 작게 고정한다.
const ISSUE_CREATE_CONTEXT = `
  query AgentWorkflowIssueCreateContext($teamKey: String!) {
    teams(filter: { key: { eq: $teamKey } }, first: 1) {
      nodes {
        id
        key
        states { nodes { id name } }
      }
    }
    projects(first: 20) { nodes { id name } }
  }
`;

// 목록은 사람이 백로그를 고를 때 필요한 최소 필드만 읽는다. Linear GraphQL은 요청 복잡도 상한이
// 10000이라 nested 필드나 페이지를 넓히면 조회 자체가 거부된다. 본문·댓글·label은 여기서 읽지 않는다.
const ISSUE_LIST = `
  query AgentWorkflowIssueList($filter: IssueFilter!, $first: Int!) {
    issues(filter: $filter, first: $first, orderBy: updatedAt) {
      nodes {
        identifier
        title
        priority
        updatedAt
        state { name }
      }
    }
  }
`;

const ISSUE_CREATE = `
  mutation AgentWorkflowIssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { id identifier url }
    }
  }
`;

function findByName(nodes, name) {
  const normalized = name.trim().toLowerCase();
  return (nodes ?? []).find((node) => node?.name?.trim().toLowerCase() === normalized) ?? null;
}

function nameList(nodes) {
  return (nodes ?? []).map((node) => node?.name).filter(Boolean).join(", ") || "없음";
}

/**
 * 목록은 기본적으로 끝난 issue를 감춘다. 고를 수 있는 것만 보여야 agent가 백로그에서 다음 작업을
 * 집을 수 있고, `Done` 수백 건이 첫 페이지를 채우면 목록 자체가 쓸모없어지기 때문이다.
 * `stateName`을 주면 그 상태만 보므로 끝난 issue를 볼 방법도 함께 남는다.
 */
export function listIssuesOperation(request) {
  return async function listIssues({ excludedStates = [], limit = 40, stateName = null, teamKey }) {
    if (typeof teamKey !== "string" || teamKey.trim().length === 0) {
      throw new LinearApiError("Linear team key is required");
    }
    const filter = { team: { key: { eq: teamKey } } };
    if (stateName) {
      filter.state = { name: { eq: stateName } };
    } else if (excludedStates.length > 0) {
      filter.state = { name: { nin: excludedStates } };
    }

    const data = await request(ISSUE_LIST, { filter, first: limit });
    const nodes = data?.issues?.nodes;
    if (!Array.isArray(nodes)) throw new LinearApiError(`Linear issue list failed for team ${teamKey}`);
    return nodes.map((issue) => ({
      identifier: issue.identifier,
      priority: issue.priority ?? null,
      state: issue.state?.name ?? "unknown",
      title: issue.title,
      updatedAt: issue.updatedAt ?? null,
    }));
  };
}

/**
 * issue 발행은 이름을 id로 바꾸는 단계에서 조용히 실패하면 안 된다. state나 project 이름이 오타이거나
 * workspace에서 바뀌었을 때 그 자리를 비워 발행하면 triage에도 roadmap에도 걸리지 않는 issue가 생기고,
 * 만든 세션은 성공했다고 보고한다. 그래서 해소하지 못한 이름은 후보 목록과 함께 실패로 끝낸다.
 */
export function createIssueOperation(request) {
  return async function createIssue({
    description = null,
    priority = null,
    projectName = null,
    stateName,
    teamKey,
    title,
  }) {
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new LinearApiError("Linear issue title is required");
    }
    if (typeof teamKey !== "string" || teamKey.trim().length === 0) {
      throw new LinearApiError("Linear team key is required");
    }
    if (typeof stateName !== "string" || stateName.trim().length === 0) {
      throw new LinearApiError("Linear workflow state name is required");
    }

    const context = await request(ISSUE_CREATE_CONTEXT, { teamKey });
    const team = context?.teams?.nodes?.[0];
    if (!team) throw new LinearApiError(`Linear team ${teamKey} was not found`);

    const state = findByName(team.states?.nodes, stateName);
    if (!state) {
      throw new LinearApiError(
        `Linear workflow state "${stateName}" does not exist for ${teamKey} (states: ${nameList(team.states?.nodes)})`,
      );
    }

    let project = null;
    if (projectName) {
      project = findByName(context?.projects?.nodes, projectName);
      if (!project) {
        throw new LinearApiError(
          `Linear project "${projectName}" was not found (projects: ${nameList(context?.projects?.nodes)})`,
        );
      }
    }

    const input = { stateId: state.id, teamId: team.id, title: title.trim() };
    if (typeof description === "string" && description.length > 0) input.description = description;
    if (typeof priority === "number") input.priority = priority;
    if (project) input.projectId = project.id;

    const result = await request(ISSUE_CREATE, { input });
    const issue = result?.issueCreate?.issue;
    if (!result?.issueCreate?.success || !issue?.identifier) {
      throw new LinearApiError(`Linear issue creation failed for team ${teamKey}`);
    }
    return { id: issue.id, identifier: issue.identifier, url: issue.url ?? null };
  };
}
