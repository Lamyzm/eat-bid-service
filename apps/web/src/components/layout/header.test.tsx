import { describe, expect, test } from 'bun:test';
import { Children, isValidElement, type ReactNode } from 'react';

import Header from './header';
import { ThemeSelector } from '../themes/theme-selector';

function 요소타입을포함하는가(node: ReactNode, type: unknown): boolean {
  if (!isValidElement<{ children?: ReactNode }>(node)) return false;
  if (node.type === type) return true;

  return Children.toArray(node.props.children).some((child) => 요소타입을포함하는가(child, type));
}

describe('상단 헤더 테마 선택기', () => {
  test('색상 테마 선택기를 항상 제공한다', () => {
    expect(요소타입을포함하는가(Header(), ThemeSelector)).toBe(true);
  });
});
