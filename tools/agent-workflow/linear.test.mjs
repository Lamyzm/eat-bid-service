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

function issueCreateStub(calls, { projects, states } = {}) {
  return createLinearClient({
    apiKey: "key",
    fetchImpl: async (_url, request) => {
      const payload = JSON.parse(request.body);
      calls.push(payload);
      if (payload.query.includes("query AgentWorkflowIssueCreateContext")) {
        return response({
          data: {
            teams: {
              nodes: [
                {
                  id: "team-uuid",
                  key: "EAT",
                  states: {
                    nodes: states ?? [
                      { id: "ready", name: "Ready" },
                      { id: "backlog", name: "Backlog" },
                    ],
                  },
                },
              ],
            },
            projects: {
              nodes: projects ?? [{ id: "project-uuid", name: "R1 — 유료 투찰 Decision Loop" }],
            },
          },
        });
      }
      return response({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "issue-uuid",
              identifier: "EAT-99",
              url: "https://linear.app/eatbid/issue/EAT-99",
            },
          },
        },
      });
    },
  });
}

test("createIssue는 team·state·project 이름을 id로 바꿔 issueCreate에 넘긴다", async () => {
  const calls = [];
  const created = await issueCreateStub(calls).createIssue({
    description: "본문",
    priority: 2,
    projectName: "R1 — 유료 투찰 Decision Loop",
    stateName: "Ready",
    teamKey: "EAT",
    title: "  검증용 issue  ",
  });

  assert.deepEqual(calls[0].variables, { teamKey: "EAT" });
  assert.deepEqual(calls[1].variables, {
    input: {
      description: "본문",
      priority: 2,
      projectId: "project-uuid",
      stateId: "ready",
      teamId: "team-uuid",
      title: "검증용 issue",
    },
  });
  assert.deepEqual(created, {
    id: "issue-uuid",
    identifier: "EAT-99",
    url: "https://linear.app/eatbid/issue/EAT-99",
  });
});

test("createIssue는 본문·priority·project가 없으면 그 입력을 아예 보내지 않는다", async () => {
  const calls = [];
  await issueCreateStub(calls).createIssue({ stateName: "Backlog", teamKey: "EAT", title: "제목" });

  assert.deepEqual(calls[1].variables, {
    input: { stateId: "backlog", teamId: "team-uuid", title: "제목" },
  });
});

test("createIssue는 없는 state·project 이름을 후보와 함께 거부하고 발행하지 않는다", async () => {
  const stateCalls = [];
  await assert.rejects(
    () =>
      issueCreateStub(stateCalls).createIssue({ stateName: "Started", teamKey: "EAT", title: "제목" }),
    /workflow state "Started" does not exist[\s\S]*Ready, Backlog/,
  );
  assert.equal(stateCalls.length, 1);

  const projectCalls = [];
  await assert.rejects(
    () =>
      issueCreateStub(projectCalls).createIssue({
        projectName: "없는 project",
        stateName: "Ready",
        teamKey: "EAT",
        title: "제목",
      }),
    /project "없는 project" was not found/,
  );
  assert.equal(projectCalls.length, 1);
});

function listStub(calls) {
  return createLinearClient({
    apiKey: "key",
    fetchImpl: async (_url, request) => {
      const payload = JSON.parse(request.body);
      calls.push(payload);
      return response({
        data: {
          issues: {
            nodes: [
              {
                identifier: "EAT-44",
                title: "결정 화면이 읽는 mart 넷",
                priority: 2,
                updatedAt: "2026-09-04T16:55:11.369Z",
                state: { name: "Ready" },
              },
            ],
          },
        },
      });
    },
  });
}

test("listIssues는 팀으로 좁히고 끝난 상태를 filter에서 빼고 읽는다", async () => {
  const calls = [];
  const issues = await listStub(calls).listIssues({
    excludedStates: ["Done", "Canceled", "Duplicate"],
    limit: 40,
    teamKey: "EAT",
  });

  assert.deepEqual(calls[0].variables, {
    filter: {
      team: { key: { eq: "EAT" } },
      state: { name: { nin: ["Done", "Canceled", "Duplicate"] } },
    },
    first: 40,
  });
  assert.deepEqual(issues, [
    {
      identifier: "EAT-44",
      priority: 2,
      state: "Ready",
      title: "결정 화면이 읽는 mart 넷",
      updatedAt: "2026-09-04T16:55:11.369Z",
    },
  ]);
});

test("listIssues는 상태를 지정하면 제외 목록 대신 그 상태만 filter에 넣는다", async () => {
  const calls = [];
  await listStub(calls).listIssues({
    excludedStates: [],
    limit: 10,
    stateName: "Done",
    teamKey: "EAT",
  });

  assert.deepEqual(calls[0].variables, {
    filter: { team: { key: { eq: "EAT" } }, state: { name: { eq: "Done" } } },
    first: 10,
  });
});

test("createIssue는 제목이 비어 있으면 Linear를 호출하지 않는다", async () => {
  const calls = [];
  await assert.rejects(
    () => issueCreateStub(calls).createIssue({ stateName: "Ready", teamKey: "EAT", title: "   " }),
    /title is required/,
  );
  assert.equal(calls.length, 0);
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
    claimableStates: ["Ready"],
    inProgressState: "In Progress",
    teamKey: "EAT",
    terminalStates: ["Done"],
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
        claimableStates: ["Ready"],
        inProgressState: "In Progress",
        teamKey: "EAT",
        terminalStates: ["Done"],
      }),
    /team/i,
  );
});

function claimStub(stateName, calls) {
  return createLinearClient({
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
              identifier: "EAT-41",
              assignee: null,
              state: { id: stateName.toLowerCase(), name: stateName },
              team: {
                key: "EAT",
                states: {
                  nodes: [
                    { id: "progress", name: "In Progress" },
                    { id: "review", name: "In Review" },
                  ],
                },
              },
            },
          },
        });
      }
      return response({ data: { issueUpdate: { success: true } } });
    },
  });
}

const claimStateConfig = {
  claimableStates: ["Backlog", "Ready", "Todo", "In Review", "In Progress"],
  inProgressState: "In Progress",
  teamKey: "EAT",
  terminalStates: ["Done", "Canceled", "Duplicate"],
};

test("Backlog와 In Review 이슈도 claim이 In Progress로 옮긴다", async () => {
  for (const stateName of ["Backlog", "In Review", "Todo"]) {
    const calls = [];
    const claim = await claimStub(stateName, calls).claimIssue("EAT-41", claimStateConfig);

    assert.equal(claim.issueIdentifier, "EAT-41");
    assert.deepEqual(
      calls[1].variables,
      { id: "issue", input: { assigneeId: "viewer", stateId: "progress" } },
      stateName,
    );
  }
});

test("Done·Canceled 이슈는 claim을 거부한다", async () => {
  for (const stateName of ["Done", "Canceled", "Duplicate"]) {
    const calls = [];
    await assert.rejects(
      () => claimStub(stateName, calls).claimIssue("EAT-41", claimStateConfig),
      /cannot be claimed from (?:terminal )?state/i,
      stateName,
    );
    assert.equal(calls.length, 1, stateName);
  }
});

test("claimableStates에 없는 알 수 없는 상태는 claim을 거부한다", async () => {
  const calls = [];
  await assert.rejects(
    () => claimStub("Blocked", calls).claimIssue("EAT-41", claimStateConfig),
    /cannot be claimed from state Blocked/i,
  );
  assert.equal(calls.length, 1);
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

  const result = await flushOutbox(events, client);

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

  const result = await flushOutbox([event], client);

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
