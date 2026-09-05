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
