/** @module 책임: 운영 진단의 첫 질문 다섯(열린 위반·최근 알림·마지막 회차·미완결 달 창·열린 보류)을 고정 SQL로 읽어 사람과 에이전트가 같은 답을 보게 한다. */
import { spawnSync } from "node:child_process";

// 이 명령은 읽기만 한다. 쓰는 SQL을 여기 더하지 않는다 — 운영 DB 수동 쓰기 금지는 절차가 아니라 경계다.
const CONTEXT = "eatbid-prod";
const NAMESPACE = "eatbid";

/** 증상별 질의. docs/operations/diagnosis-map.md §2와 같은 질문이며 여기 SQL이 바뀌면 그 문서도 같이 바뀐다. */
export const QUERIES = [
  {
    title: "열린 위반과 나이",
    sql: `select violation_key, severity, observation,
                 to_char(first_seen_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as first_seen_kst,
                 date_trunc('minute', now() - first_seen_at) as age,
                 to_char(last_notified_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as last_notified_kst
            from monitoring.violation
           where environment = 'prod' and resolved_at is null
           order by first_seen_at`,
  },
  {
    title: "마지막 회차 (15분 주기, 30분 넘게 비었으면 검사가 멈춘 것)",
    sql: `select to_char(observed_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as observed_kst,
                 violations_open, backfill_windows_incomplete, check_duration_ms
            from monitoring.round where environment = 'prod' order by observed_at desc limit 3`,
  },
  {
    title: "최근 알림 24시간",
    sql: `select to_char(n.sent_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as sent_kst, n.kind, n.ok,
                 coalesce(v.violation_key, '(요약)') as violation_key, left(coalesce(n.error, ''), 60) as error
            from monitoring.notification n left join monitoring.violation v using (violation_id)
           where n.environment = 'prod' and n.sent_at > now() - interval '24 hours'
           order by n.sent_at desc limit 20`,
  },
  {
    title: "미완결 달 창 (전진 대상)",
    sql: `select window_start, window_end, discovered_ids, captured_ids, published_ids, failed_publications
            from ingest.backfill_coverage
           where not is_complete
             and window_start = to_char(date_trunc('month', to_date(window_start, 'YYYYMMDD')), 'YYYYMMDD')
             and window_end = to_char(date_trunc('month', to_date(window_start, 'YYYYMMDD')) + interval '1 month' - interval '1 day', 'YYYYMMDD')
           order by window_start desc limit 10`,
  },
  {
    title: "열린 소스 보류",
    sql: `select hold_id, source, reason, detail,
                 to_char(held_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as held_kst,
                 to_char(release_after at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as release_kst
            from ingest.source_hold where released_at is null and release_after > now()`,
  },
];

function psql(sql) {
  const result = spawnSync(
    "kubectl",
    ["--context", CONTEXT, "-n", NAMESPACE, "exec", "deployment/postgres", "--", "psql", "-U", "eatbid", "-d", "eatbid", "-P", "border=0", "-c", sql],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "psql 실패").trim());
  return result.stdout.trimEnd();
}

export function runStatus() {
  process.stdout.write(`eatbid 운영 상태 (${CONTEXT}, ${new Date().toISOString()})\n`);
  let failures = 0;
  for (const { title, sql } of QUERIES) {
    // 한 질의가 막혀도 나머지는 보여 준다. 그리고 막힌 사실을 정상으로 보이게 하지 않는다 — 표가 없거나
    // 연결이 끊긴 것은 그 자체가 진단 결과다.
    try {
      process.stdout.write(`\n## ${title}\n${psql(sql)}\n`);
    } catch (error) {
      failures += 1;
      process.stdout.write(`\n## ${title}\n(읽지 못함) ${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n`);
    }
  }
  process.stdout.write("\n더 파고들기: docs/operations/diagnosis-map.md\n");
  return failures;
}

if (process.argv[1] && process.argv[1].endsWith("status.mjs")) {
  process.exitCode = runStatus() > 0 ? 1 : 0;
}
