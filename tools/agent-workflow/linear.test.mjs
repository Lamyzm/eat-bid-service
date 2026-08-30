import assert from "node:assert/strict";
import test from "node:test";

import { createLinearClient, flushOutbox } from "./linear.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Linear 클라이언트는 인증하고 팀 상태를 찾아 축약 식별자로 갱신한다", async () => {
  const calls = [];
  const fetchImpl = async (url, request) => {
    const payload = JSON.parse(request.body);
    calls.push({ authorization: request.headers.Authorization, payload, url });

    if (payload.query.includes("query AgentWorkflowIssue")) {
      return response({
        data: {
          issue: {
            id: "issue-uuid",
            identifier: "EAT-42",
            state: { id: "ready", name: "Ready" },
            team: { states: { nodes: [{ id: "progress", name: "In Progress" }] } },
          },
        },
      });
    }
    return response({ data: { issueUpdate: { success: true } } });
  };

  const client = createLinearClient({ apiKey: "secret-key", fetchImpl });
  await client.moveIssueToState("EAT-42", "In Progress");

  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, "secret-key");
  assert.deepEqual(calls[1].payload.variables, { id: "issue-uuid", stateId: "progress" });
});

test("Linear 클라이언트는 존재하지 않는 workflow 상태를 추측하지 않는다", async () => {
  const client = createLinearClient({
    apiKey: "key",
    fetchImpl: async () =>
      response({
        data: {
          issue: {
            id: "issue-uuid",
            identifier: "EAT-42",
            state: { id: "ready", name: "Ready" },
            team: { states: { nodes: [{ id: "other", name: "Started" }] } },
          },
        },
      }),
  });

  await assert.rejects(() => client.moveIssueToState("EAT-42", "In Progress"), /workflow state/i);
});

test("claimIssue는 할당과 상태 전환 전에 팀과 소유자와 원래 상태를 검증한다", async () => {
  const calls = [];
  const client = createLinearClient({
    apiKey: "key",
    fetchImpl: async (_url, request) => {
      const payload = JSON.parse(request.body);
      calls.push(payload);
      if (payload.query.includes("query AgentWorkflowClaim")) {
        return response({
          data: {
            viewer: { id: "viewer", name: "Owner" },
            issue: {
              id: "issue",
              identifier: "EAT-42",
              assignee: null,
              state: { id: "ready", name: "Ready" },
              team: {
                key: "EAT",
                states: { nodes: [{ id: "progress", name: "In Progress" }] },
              },
            },
          },
        });
      }
      return response({ data: { issueUpdate: { success: true } } });
    },
  });

  const claim = await client.claimIssue("EAT-42", {
    inProgressState: "In Progress",
    readyStates: ["Ready"],
    teamKey: "EAT",
  });

  assert.equal(claim.assigneeId, "viewer");
  assert.deepEqual(calls[1].variables, {
    id: "issue",
    input: { assigneeId: "viewer", stateId: "progress" },
  });
});

test("claimIssue는 다른 팀과 소유자와 claim 불가 상태를 거부한다", async () => {
  const client = createLinearClient({
    apiKey: "key",
    fetchImpl: async () =>
      response({
        data: {
          viewer: { id: "viewer", name: "Owner" },
          issue: {
            id: "issue",
            identifier: "OPS-1",
            assignee: { id: "someone-else", name: "Other" },
            state: { id: "done", name: "Done" },
            team: { key: "OPS", states: { nodes: [] } },
          },
        },
      }),
  });

  await assert.rejects(
    () =>
      client.claimIssue("OPS-1", {
        inProgressState: "In Progress",
        readyStates: ["Ready"],
        teamKey: "EAT",
      }),
    /team/i,
  );
});

test("flushOutbox는 원격 상태를 되돌리지 않고 과거 started 이벤트를 로컬에서 끝낸다", async () => {
  const events = [
    { id: "1", issueIdentifier: "EAT-1", kind: "started" },
    { id: "2", issueIdentifier: "EAT-1", kind: "worklog", changedFiles: ["a.ts"] },
  ];
  const client = {
    moveIssueToState: async () => {
      throw new Error("legacy state transition must not run");
    },
    addComment: async () => {
      throw new Error("offline");
    },
  };

  const result = await flushOutbox(events, client, { inProgressState: "In Progress" });

  assert.deepEqual(result.remaining.map((event) => event.id), ["2"]);
  assert.equal(result.sent, 1);
  assert.match(result.error.message, /offline/);
});

test("flushOutbox는 prompt나 credential 없이 제한된 작업 기록을 작성한다", async () => {
  let comment;
  const client = {
    moveIssueToState: async () => {},
    addCommentOnce: async (_issue, _eventId, body) => {
      comment = body;
    },
  };
  const event = {
    id: "2",
    issueIdentifier: "EAT-1",
    kind: "worklog",
    changedFiles: ["src/a.ts", "docs/a.md"],
    createdAt: "2026-08-30T00:00:00.000Z",
  };

  const result = await flushOutbox([event], client, { inProgressState: "In Progress" });

  assert.equal(result.sent, 1);
  assert.deepEqual(result.remaining, []);
  assert.match(comment, /eatbid-agent-event:2/);
  assert.match(comment, /src\/a\.ts/);
  assert.doesNotMatch(comment, /secret|prompt/i);
});

test("같은 이벤트 표식이 Linear에 있으면 댓글을 다시 만들지 않는다", async () => {
  const calls = [];
  const client = createLinearClient({
    apiKey: "key",
    fetchImpl: async (_url, request) => {
      const payload = JSON.parse(request.body);
      calls.push(payload);
      if (payload.query.includes("query AgentWorkflowComments")) {
        return response({
          data: {
            issue: {
              id: "issue",
              comments: { nodes: [{ body: "<!-- eatbid-agent-event:event-7 -->" }] },
            },
          },
        });
      }
      throw new Error("중복 댓글 생성 요청이 발생하면 안 됨");
    },
  });

  const created = await client.addCommentOnce("EAT-7", "event-7", "새 댓글");

  assert.equal(created, false);
  assert.equal(calls.length, 1);
});

test("이벤트 표식은 첫 100개 이후의 Linear 댓글 페이지까지 확인한다", async () => {
  const calls = [];
  const client = createLinearClient({
    apiKey: "key",
    fetchImpl: async (_url, request) => {
      const payload = JSON.parse(request.body);
      calls.push(payload);
      if (payload.variables.after === null) {
        return response({
          data: {
            issue: {
              id: "issue",
              comments: {
                nodes: Array.from({ length: 100 }, () => ({ body: "다른 댓글" })),
                pageInfo: { endCursor: "page-2", hasNextPage: true },
              },
            },
          },
        });
      }
      return response({
        data: {
          issue: {
            id: "issue",
            comments: {
              nodes: [{ body: "<!-- eatbid-agent-event:event-101 -->" }],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        },
      });
    },
  });

  const created = await client.addCommentOnce("EAT-7", "event-101", "새 댓글");

  assert.equal(created, false);
  assert.deepEqual(calls.map((call) => call.variables.after), [null, "page-2"]);
});
