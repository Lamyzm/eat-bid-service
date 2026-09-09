import { describe, expect, test } from 'bun:test';
import { Activity, createContext, useContext } from 'react';
import { render } from '@testing-library/react';
import { DockSlot, DockSlotHost, DockSlotsProvider } from './workspace-dock-slots';

const Selection = createContext('');
function SelectedRecord() {
  return <p>선택 회차 {useContext(Selection)}</p>;
}
function Workspace({
  selected,
  mounted = true,
  hidden = false
}: {
  selected: string;
  mounted?: boolean;
  hidden?: boolean;
}) {
  return (
    <DockSlotsProvider>
      <div data-testid='central-page'>
        {mounted && (
          <Activity mode={hidden ? 'hidden' : 'visible'}>
            <Selection.Provider value={selected}>
              <DockSlot slot='panel'>
                <SelectedRecord />
              </DockSlot>
            </Selection.Provider>
          </Activity>
        )}
      </div>
      <DockSlotHost slot='panel' />
    </DockSlotsProvider>
  );
}

describe('전역 보조 공간의 표시 슬롯', () => {
  test('화면 context를 유지한 채 본문 밖의 같은 host에서 선택을 갱신한다', () => {
    const screen = render(<Workspace selected='5274' />);
    const host = screen.container.querySelector('[data-dock-host="panel"]');
    expect(host?.textContent).toBe('선택 회차 5274');
    expect(screen.getByTestId('central-page').textContent).toBe('');
    screen.rerender(<Workspace selected='5271' />);
    expect(screen.container.querySelector('[data-dock-host="panel"]')).toBe(host);
    expect(host?.textContent).toBe('선택 회차 5271');
  });

  test('화면을 떠나면 이전 상세를 해제하고 공통 host는 유지한다', () => {
    const screen = render(<Workspace selected='5274' />);
    const host = screen.container.querySelector('[data-dock-host="panel"]');
    screen.rerender(<Workspace selected='5274' mounted={false} />);
    expect(screen.queryByText('선택 회차 5274')).toBeNull();
    expect(screen.container.querySelector('[data-dock-host="panel"]')).toBe(host);
    expect(host?.childElementCount).toBe(0);
  });

  test('Activity로 보관된 화면은 전역 지면을 비우고 돌아오면 같은 내용을 복원한다', () => {
    const screen = render(<Workspace selected='5274' />);
    const host = screen.container.querySelector('[data-dock-host="panel"]')!;
    const content = screen.getByText('선택 회차 5274');
    screen.rerender(<Workspace selected='5274' hidden />);
    expect(host.childElementCount).toBe(0);
    screen.rerender(<Workspace selected='5274' />);
    expect(screen.getByText('선택 회차 5274')).toBe(content);
    expect(host.contains(content)).toBe(true);
  });
});
