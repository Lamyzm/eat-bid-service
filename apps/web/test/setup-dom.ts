import { afterEach } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cleanup } from '@testing-library/react';

// Web 컴포넌트 테스트는 실제 DOM 이벤트와 focus 이동을 검증하므로 동일한 환경을 먼저 설치한다.
GlobalRegistrator.register();

afterEach(() => {
  cleanup();
});
