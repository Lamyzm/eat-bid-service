import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { EmailSignInOutcome } from '@/shell/auth/auth-client';

/** provider 왕복은 여기서 증명하지 않는다. 화면이 결과 값 하나를 어떤 문장으로 옮기는지만 본다. */
let emailOutcome: EmailSignInOutcome | Error = 'signed-in';
let emailAttempts: Array<{ email: string; password: string; returnPath: unknown }> = [];
mock.module('@/shell/auth/auth-client', () => ({
  signInWithGoogle: async () => undefined,
  signInWithEmail: async (input: { email: string; password: string; returnPath: unknown }) => {
    emailAttempts.push(input);
    if (emailOutcome instanceof Error) throw emailOutcome;
    return emailOutcome;
  },
  signOutFromProvider: async () => undefined,
  useProviderSubject: () => undefined,
  isProviderAuthError: () => false
}));

const { LoginScreen } = await import('./login-screen');

beforeEach(() => {
  emailOutcome = 'signed-in';
  emailAttempts = [];
});

function show(devLoginEnabled: boolean, authUnavailable = false) {
  return render(
    <LoginScreen
      returnPath='/today'
      authUnavailable={authUnavailable}
      hasReturnScreen={false}
      devLoginEnabled={devLoginEnabled}
    />
  );
}

// happy-dom에서 fireEvent.change는 React onChange를 트리거하지 않으므로(bid-rail.test.tsx의 주석) 실제 타이핑을 쓴다.
async function fillAndSubmit(screen: ReturnType<typeof show>, email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('이메일'), email);
  await user.type(screen.getByLabelText('비밀번호'), password);
  await user.click(screen.getByRole('button', { name: '이메일로 로그인' }));
}

describe('로그인 화면의 개발 모드 폼', () => {
  test('개발 모드가 아니면 Google 버튼만 있고 이메일 폼도 입력도 없다', () => {
    const screen = show(false);

    expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: '이메일 로그인' })).toBeNull();
    expect(screen.container.querySelector('input')).toBeNull();
  });

  test('개발 모드면 Google 버튼은 그대로 두고 그 아래에 이메일·비밀번호 폼을 보여 준다', () => {
    const screen = show(true);
    const google = screen.getByRole('button', { name: 'Google로 로그인' });
    const form = screen.getByRole('form', { name: '이메일 로그인' });

    expect(screen.getByLabelText('이메일').getAttribute('type')).toBe('email');
    expect(screen.getByLabelText('비밀번호').getAttribute('type')).toBe('password');
    expect(screen.getByRole('button', { name: '이메일로 로그인' })).toBeTruthy();
    // Google이 먼저다. 개발 폼은 운영 가입 방법을 대신하지 않는다.
    expect(google.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('입력한 자격과 복귀 경로를 그대로 넘기고, 자격 오류는 입력을 확인하라고만 말한다', async () => {
    emailOutcome = 'invalid-credentials';
    const screen = show(true);

    await fillAndSubmit(screen, 'dev@eatbid.local', 'wrong-password');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('이메일 또는 비밀번호를 확인해 주세요.');
    expect(emailAttempts).toEqual([{ email: 'dev@eatbid.local', password: 'wrong-password', returnPath: '/today' }]);
    // 내부 사정을 화면에 설명하지 않는다.
    for (const banned of ['개발', '시드', 'provider', 'EATBID_DEV_LOGIN']) {
      expect(screen.container.textContent).not.toContain(banned);
    }
  });

  test('provider 호출 실패는 자격 오류와 다른 문장으로 말하고 다시 제출할 수 있게 둔다', async () => {
    emailOutcome = new Error('network');
    const screen = show(true);

    await fillAndSubmit(screen, 'dev@eatbid.local', 'eatbid-dev-login');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('로그인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    expect(screen.getByRole('button', { name: '이메일로 로그인' }).hasAttribute('disabled')).toBe(false);
  });

  test('인증 의존성이 없는 배포에서는 이메일 폼도 Google 버튼과 함께 제출할 수 없다', () => {
    const screen = show(true, true);

    expect(screen.getByLabelText('이메일').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '이메일로 로그인' }).hasAttribute('disabled')).toBe(true);
  });
});
