import { afterEach } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cleanup } from '@testing-library/react';

// Web 컴포넌트 테스트는 실제 DOM 이벤트와 focus 이동을 검증하므로 동일한 환경을 먼저 설치한다.
// about:blank에서는 document.cookie 쓰기가 조용히 버려지므로 cookie를 쓰는 shell 상태도 검증할 수 있게
// http origin을 준다.
GlobalRegistrator.register({ url: 'http://localhost/' });

afterEach(() => {
  cleanup();
  // 한 프로세스가 모든 테스트 파일을 실행하므로 cookie는 파일 경계를 넘어 살아남는다. 개별 파일이
  // 정리를 기억하지 않아도 앞 테스트가 뒤 테스트를 오염시키지 않게 여기서 비운다.
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
});
