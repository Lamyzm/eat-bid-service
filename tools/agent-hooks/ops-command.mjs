/**
 * @module 책임: 에이전트 셸 명령이 운영 클러스터(eatbid-prod)나 운영 DB를 바꾸는지 판정해, 바꾸는 명령만 사람에게 묻게 한다.
 *
 * 이 PC의 kubectl 기본 문맥이 운영이라 `--context`를 빼도 운영에 닿는다. 읽기(get·describe·logs, 읽기 전용 psql)는 조사에
 * 늘 쓰므로 묻지 않고, 쓰기·실행·동기화만 묻는다. 막지 않는다 — 사용자가 시킨 운영 작업은 허락 한 번으로 지나간다.
 */

const PROD_CONTEXT = 'eatbid-prod';
const KUBECTL_READ = new Set(['get', 'describe', 'logs', 'top', 'explain', 'api-resources', 'api-versions', 'version', 'config', 'auth', 'port-forward', 'cluster-info', 'events', 'wait', 'diff']);
const ARGO_READ = new Set(['get', 'list', 'logs', 'watch', 'lint', 'version', 'template', 'cron']);
const SQL_WRITE = /\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|vacuum|reindex|cluster|comment\s+on|copy\s+\S+\s+from|refresh\s+materialized|call)\b/i;

function segments(command) {
  return command.split(/&&|\|\||;|\n/).map((part) => part.trim()).filter(Boolean);
}

function contextOf(segment, currentContext) {
  const match = /--context(?:=|\s+)(\S+)/.exec(segment);
  return match ? match[1].replace(/^["']|["']$/g, '') : currentContext;
}

function verbAfter(segment, tool) {
  const rest = segment.slice(segment.indexOf(tool) + tool.length).trim();
  const list = rest.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  for (let index = 0; index < list.length; index += 1) {
    const word = list[index];
    if (word === '--context' || word === '-n' || word === '--namespace' || word === '-c') {
      index += 1;
      continue;
    }
    if (word.startsWith('-')) continue;
    return { verb: word, rest: list.slice(index + 1) };
  }
  return { verb: '', rest: [] };
}

/** psql이 읽기 전용으로 묶였거나 SQL 글에 쓰기 낱말이 없으면 읽기로 본다. */
function psqlWrites(segment) {
  if (/default_transaction_read_only\s*=\s*on/i.test(segment)) return false;
  return SQL_WRITE.test(segment) || !/-c\s|--command/.test(segment);
}

/**
 * 사람에게 물을 까닭을 돌려준다. 묻지 않으면 null이다.
 * @param {string} command 셸 명령 글
 * @param {string | null} currentContext kubectl 기본 문맥(모르면 null — 운영으로 보지 않는다)
 */
export function opsConfirmReason(command, currentContext) {
  for (const segment of segments(command)) {
    if (/\bkubectl(\.exe)?\b/.test(segment)) {
      if (contextOf(segment, currentContext) !== PROD_CONTEXT) continue;
      const { verb, rest } = verbAfter(segment, segment.match(/\bkubectl(\.exe)?\b/)[0]);
      if (verb === 'exec') {
        if (/\bpsql\b/.test(segment) && !psqlWrites(segment)) continue;
        return '운영 클러스터 파드 안에서 명령을 실행하려 해요';
      }
      if (verb === 'rollout' && ['status', 'history'].includes(rest[0])) continue;
      if (KUBECTL_READ.has(verb)) continue;
      return `운영 클러스터에 kubectl ${verb}을(를) 하려 해요`;
    }
    if (/\bargo(\.exe)?\b/.test(segment) && !/\bargocd\b/.test(segment)) {
      if (contextOf(segment, currentContext) !== PROD_CONTEXT) continue;
      const { verb, rest } = verbAfter(segment, segment.match(/\bargo(\.exe)?\b/)[0]);
      if (verb === 'cron' && ['list', 'get', 'lint'].includes(rest[0])) continue;
      if (ARGO_READ.has(verb) && verb !== 'cron') continue;
      return `운영 Argo Workflows에 argo ${verb}을(를) 하려 해요`;
    }
    if (/\bargocd\b/.test(segment) && /\bapp\s+(sync|set|delete|rollback|patch|terminate-op)\b/.test(segment)) {
      return '운영 Argo CD 앱을 동기화하거나 바꾸려 해요';
    }
  }
  return null;
}
