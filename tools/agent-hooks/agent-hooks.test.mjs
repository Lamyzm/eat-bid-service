import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';

import { webFormatTarget } from './format-target.mjs';
import { englishReplyReason, prose } from './korean-reply.mjs';
import { opsConfirmReason } from './ops-command.mjs';
import { productionPushReason } from './production-push.mjs';

describe('배포 경로 push 막기', () => {
  test('main·deploy/prod 가지로 가는 push를 막는다', () => {
    assert.match(productionPushReason('git push origin main', 'feat/1-x'), /main/);
    assert.match(productionPushReason('git push origin HEAD:main', 'feat/1-x'), /main/);
    assert.match(productionPushReason('git push --force origin deploy/prod', 'feat/1-x'), /deploy\/prod/);
    assert.match(productionPushReason('git -C F:/repo push origin +refs/heads/main', null), /main/);
  });

  test('main 가지에서 인자 없이 push하면 막는다', () => {
    assert.match(productionPushReason('git push', 'main'), /main/);
    assert.match(productionPushReason('git push origin HEAD', 'main'), /main/);
  });

  test('release 태그를 손으로 만들거나 태그를 한꺼번에 push하면 막는다', () => {
    assert.match(productionPushReason('git push origin release/v0.1.93', 'feat/1-x'), /release/);
    assert.match(productionPushReason('git push origin refs/tags/release/v0.1.93', 'feat/1-x'), /release/);
    assert.match(productionPushReason('git push --tags', 'feat/1-x'), /태그/);
    assert.match(productionPushReason('gh api -X POST repos/o/r/git/refs -f ref=refs/tags/release/v1 -f sha=abc', null), /gh api/);
  });

  test('작업 가지 push와 정해진 명령은 지나간다', () => {
    assert.equal(productionPushReason('git push --set-upstream origin feat/228-work', 'feat/228-work'), null);
    assert.equal(productionPushReason('git push', 'feat/228-work'), null);
    assert.equal(productionPushReason('pnpm workflow:pr', 'feat/228-work'), null);
    assert.equal(productionPushReason('pnpm workflow:tag -- v0.1.93', 'main'), null);
    assert.equal(productionPushReason('git status && git log -1', 'main'), null);
  });
});

describe('운영 변경 확인', () => {
  test('운영 문맥의 쓰기 kubectl은 묻는다', () => {
    assert.match(opsConfirmReason('kubectl --context eatbid-prod -n eatbid rollout restart deploy/web', null), /rollout/);
    assert.match(opsConfirmReason('kubectl --context=eatbid-prod delete pod x', null), /delete/);
    assert.match(opsConfirmReason('kubectl -n argocd patch application eatbid --type merge -p x', 'eatbid-prod'), /patch/);
  });

  test('운영 읽기는 묻지 않는다', () => {
    assert.equal(opsConfirmReason('kubectl --context eatbid-prod -n argocd get application eatbid -o yaml', null), null);
    assert.equal(opsConfirmReason('kubectl --context eatbid-prod -n eatbid logs deploy/server --tail 50', null), null);
    assert.equal(opsConfirmReason('kubectl --context eatbid-prod -n eatbid rollout status deploy/web', null), null);
  });

  test('파드 안 psql은 읽기 전용으로 묶였을 때만 지나간다', () => {
    const read = "kubectl --context eatbid-prod -n eatbid exec deploy/postgres -- psql \"$URL\" -c \"SET default_transaction_read_only=on;\" -c \"select 1\"";
    assert.equal(opsConfirmReason(read, null), null);
    assert.match(opsConfirmReason('kubectl --context eatbid-prod exec deploy/postgres -- psql -c "update app.x set y=1"', null), /실행/);
    assert.match(opsConfirmReason('kubectl --context eatbid-prod exec deploy/server -- sh', null), /실행/);
  });

  test('운영 Argo 제출·Argo CD 동기화는 묻고 다른 문맥은 묻지 않는다', () => {
    assert.match(opsConfirmReason('argo --context eatbid-prod -n eatbid submit --from workflowtemplate/x', null), /argo submit/);
    assert.match(opsConfirmReason('argocd app sync eatbid', null), /Argo CD/);
    assert.equal(opsConfirmReason('argo --context eatbid-prod -n eatbid list', null), null);
    assert.equal(opsConfirmReason('kubectl --context k3d-local delete pod x', 'eatbid-prod'), null);
    assert.equal(opsConfirmReason('kubectl delete pod x', 'k3d-local'), null);
  });
});

describe('편집 뒤 포맷 대상', () => {
  const root = path.resolve('/repo');
  test('apps/web의 코드·json·css만 oxfmt 대상이다', () => {
    assert.deepEqual(webFormatTarget(path.join(root, 'apps/web/src/a.tsx'), root), { cwd: path.join(root, 'apps', 'web'), file: 'src/a.tsx' });
    assert.notEqual(webFormatTarget(path.join(root, 'apps/web/package.json'), root), null);
  });

  test('web 밖·마크다운·node_modules는 손대지 않는다', () => {
    assert.equal(webFormatTarget(path.join(root, 'apps/server/src/a.ts'), root), null);
    assert.equal(webFormatTarget(path.join(root, 'apps/web/AGENTS.md'), root), null);
    assert.equal(webFormatTarget(path.join(root, 'apps/web/node_modules/x/index.js'), root), null);
    assert.equal(webFormatTarget(path.resolve('/other/apps/web/src/a.tsx'), root), null);
  });
});

describe('한국어 답 확인', () => {
  test('영문이 80자 넘고 한글보다 많으면 다시 쓰게 한다', () => {
    const english = 'This change replaces the work screen with value cards and closing day groups so owners can pass values quickly.';
    assert.match(englishReplyReason(english), /한국어가 아니에요/);
  });

  test('코드·경로·URL이 섞인 한국어 답은 지나간다', () => {
    const korean = '`pnpm workflow:tag -- v0.1.92`로 태그를 찍었어요. https://github.com/Lamyzm/eat-bid-service/pull/231 과 apps/web/src/app/work/page.tsx 를 고쳤어요.';
    assert.equal(englishReplyReason(korean), null);
    assert.equal(prose('```ts\nconst x = 1;\n```').trim(), '');
  });
});
