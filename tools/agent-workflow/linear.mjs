/** @module 책임: Linear GraphQL 경계에서 issue 조회·발행·claim 상태 전환·중복 없는 worklog 댓글을 수행한다. */
import { LinearApiError } from "./linear-error.mjs";
import { createIssueOperation } from "./linear-issue.mjs";

export { LinearApiError };

const ISSUE_QUERY = `
  query AgentWorkflowIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      state { id name }
      team { states { nodes { id name } } }
    }
  }
`;

const ISSUE_UPDATE = `
  mutation AgentWorkflowIssueUpdate($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) { success }
  }
`;

const CLAIM_QUERY = `
  query AgentWorkflowClaim($id: String!) {
    viewer { id name }
    issue(id: $id) {
      id
      identifier
      assignee { id name }
      state { id name }
      team { key states { nodes { id name } } }
    }
  }
`;

const CLAIM_UPDATE = `
  mutation AgentWorkflowClaimUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) { success }
  }
`;

const COMMENT_CREATE = `
  mutation AgentWorkflowCommentCreate($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) { success }
  }
`;

const COMMENTS_QUERY = `
  query AgentWorkflowComments($id: String!, $after: String) {
    issue(id: $id) {
      id
      comments(first: 100, after: $after) {
        nodes { body }
        pageInfo { endCursor hasNextPage }
      }
    }
  }
`;

export function createLinearClient({
  apiKey,
  endpoint = "https://api.linear.app/graphql",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new LinearApiError("LINEAR_API_KEY is required for deterministic hook sync");
  if (typeof fetchImpl !== "function") throw new LinearApiError("A fetch implementation is required");

  async function request(query, variables) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new LinearApiError(`Linear HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new LinearApiError(
        `Linear GraphQL: ${payload.errors.map((error) => error.message ?? "unknown error").join("; ")}`,
      );
    }
    return payload.data;
  }

  async function getIssue(identifier) {
    const issue = (await request(ISSUE_QUERY, { id: identifier }))?.issue;
    if (!issue) throw new LinearApiError(`Linear issue ${identifier} was not found`);
    return issue;
  }

  return {
    async addComment(identifier, body) {
      const issue = await getIssue(identifier);
      const result = await request(COMMENT_CREATE, { issueId: issue.id, body });
      if (!result?.commentCreate?.success) {
        throw new LinearApiError(`Linear comment creation failed for ${identifier}`);
      }
    },

    async addCommentOnce(identifier, eventId, body) {
      const marker = `<!-- eatbid-agent-event:${eventId} -->`;
      // API가 idempotency key를 받지 않으므로 사람이 보지 않는 안정적인 marker를 원격 ledger로 쓴다.
      let after = null;
      let issueId = null;
      while (true) {
        const issue = (await request(COMMENTS_QUERY, { after, id: identifier }))?.issue;
        if (!issue) throw new LinearApiError(`Linear issue ${identifier} was not found`);
        issueId = issue.id;
        if (issue.comments?.nodes?.some((comment) => comment?.body?.includes(marker))) return false;
        if (!issue.comments?.pageInfo?.hasNextPage) break;
        const nextCursor = issue.comments.pageInfo.endCursor;
        if (!nextCursor || nextCursor === after) {
          throw new LinearApiError(`Linear comment pagination stalled for ${identifier}`);
        }
        after = nextCursor;
      }

      const result = await request(COMMENT_CREATE, { issueId, body });
      if (!result?.commentCreate?.success) {
        throw new LinearApiError(`Linear comment creation failed for ${identifier}`);
      }
      return true;
    },

    createIssue: createIssueOperation(request),

    getIssue,

    async claimIssue(identifier, { claimableStates, inProgressState, teamKey, terminalStates }) {
      const data = await request(CLAIM_QUERY, { id: identifier });
      const issue = data?.issue;
      const viewer = data?.viewer;
      if (!issue || !viewer) throw new LinearApiError(`Linear claim context was not found for ${identifier}`);
      if (issue.team?.key?.toUpperCase() !== teamKey.toUpperCase()) {
        throw new LinearApiError(
          `Linear issue ${identifier} belongs to team ${issue.team?.key ?? "unknown"}, expected ${teamKey}`,
        );
      }
      if (issue.assignee && issue.assignee.id !== viewer.id) {
        throw new LinearApiError(
          `Linear issue ${identifier} is assigned to ${issue.assignee.name ?? "another owner"}`,
        );
      }

      // 작업 중인 issue는 Backlog·Todo·In Review 어디에도 있을 수 있고 그 전환은 사람이 아니라 이
      // 명령이 맞추는 일이다. 끝난 issue(Done·Canceled·Duplicate)만 거부해 완료를 되돌리지 않는다.
      const normalizedState = issue.state?.name?.toLowerCase();
      const stateName = issue.state?.name ?? "unknown";
      const normalizedIn = (states) => states.map((state) => state.toLowerCase());
      if (normalizedIn(terminalStates).includes(normalizedState)) {
        throw new LinearApiError(
          `Linear issue ${identifier} cannot be claimed from terminal state ${stateName}`,
        );
      }
      if (!normalizedIn(claimableStates).includes(normalizedState)) {
        throw new LinearApiError(`Linear issue ${identifier} cannot be claimed from state ${stateName}`);
      }
      const alreadyInProgress = normalizedState === inProgressState.toLowerCase();

      const targetState = issue.team?.states?.nodes?.find(
        (state) => state.name?.toLowerCase() === inProgressState.toLowerCase(),
      );
      if (!targetState) {
        throw new LinearApiError(`Linear workflow state "${inProgressState}" does not exist for ${identifier}`);
      }

      const input = {};
      if (!issue.assignee) input.assigneeId = viewer.id;
      if (!alreadyInProgress) input.stateId = targetState.id;
      if (Object.keys(input).length > 0) {
        const result = await request(CLAIM_UPDATE, { id: issue.id, input });
        if (!result?.issueUpdate?.success) {
          throw new LinearApiError(`Linear claim update failed for ${identifier}`);
        }
      }

      return {
        assigneeId: viewer.id,
        assigneeName: viewer.name,
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        teamKey: issue.team.key,
      };
    },

    async moveIssueToState(identifier, stateName) {
      const issue = await getIssue(identifier);
      if (issue.state?.name?.toLowerCase() === stateName.toLowerCase()) return;

      const targetState = issue.team?.states?.nodes?.find(
        (state) => state.name?.toLowerCase() === stateName.toLowerCase(),
      );
      if (!targetState) {
        throw new LinearApiError(
          `Linear workflow state "${stateName}" does not exist for ${identifier}`,
        );
      }

      const result = await request(ISSUE_UPDATE, { id: issue.id, stateId: targetState.id });
      if (!result?.issueUpdate?.success) {
        throw new LinearApiError(`Linear issue update failed for ${identifier}`);
      }
    },
  };
}

function worklogBody(event) {
  const files = [...new Set(event.changedFiles ?? [])].sort().slice(0, 50);
  const inlineCode = (value) => {
    const text = String(value);
    return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
  };
  const fileLines = files.length > 0 ? files.map((file) => `- ${inlineCode(file)}`).join("\n") : "- 기록된 파일 없음";
  const overflow = (event.changedFiles?.length ?? 0) > 50 ? "\n- 그 외 파일은 PR diff에서 확인" : "";
  return [
    `<!-- eatbid-agent-event:${event.id} -->`,
    "### Agent worklog",
    "",
    `- 기록 시각: ${event.createdAt ?? "unknown"}`,
    `- 실행 도구: ${event.provider ?? "unknown"}`,
    "- 이번 세션에서 변경한 경로:",
    fileLines + overflow,
    "",
    "Acceptance 판정과 검증 evidence는 PR에서 확인합니다.",
  ].join("\n");
}

export async function flushOutbox(events, client) {
  let sent = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    try {
      if (event.kind === "started") {
        // Legacy pre-lease events are acknowledged locally only. Replaying one must never
        // move a remotely reviewed, blocked or completed issue back to In Progress.
      } else if (event.kind === "worklog") {
        if (typeof client.addCommentOnce === "function") {
          await client.addCommentOnce(event.issueIdentifier, event.id, worklogBody(event));
        } else {
          await client.addComment(event.issueIdentifier, worklogBody(event));
        }
      } else {
        throw new LinearApiError(`Unsupported outbox event kind: ${event.kind}`);
      }
      sent += 1;
    } catch (error) {
      return { error, remaining: events.slice(index), sent };
    }
  }
  return { error: null, remaining: [], sent };
}
