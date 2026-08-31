import { expect, test } from 'bun:test';

import { startThemeTransition } from './theme-transition';

test('움직임 축소 환경에서는 View Transition 없이 즉시 테마를 적용한다', () => {
  const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const transitionDescriptor = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
  const events: string[] = [];

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true })
  });
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: () => events.push('transition')
  });

  try {
    startThemeTransition(() => events.push('apply'));
    expect(events).toEqual(['apply']);
  } finally {
    if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor);
    else Reflect.deleteProperty(window, 'matchMedia');
    if (transitionDescriptor)
      Object.defineProperty(document, 'startViewTransition', transitionDescriptor);
    else Reflect.deleteProperty(document, 'startViewTransition');
  }
});
