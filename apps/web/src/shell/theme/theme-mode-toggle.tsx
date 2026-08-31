'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { startThemeTransition } from './theme-transition';

export function ThemeModeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const handleThemeToggle = React.useCallback(
    (event?: React.MouseEvent) => {
      const nextMode = resolvedTheme === 'dark' ? 'light' : 'dark';
      startThemeTransition(() => setTheme(nextMode), event);
    },
    [resolvedTheme, setTheme]
  );

  // pointer가 없는 단축키 전환은 화면 중심 fallback을 사용한다.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'd' ||
        !event.shiftKey ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      handleThemeToggle();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleThemeToggle]);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='secondary'
            size='icon'
            className='group/toggle size-8'
            onClick={handleThemeToggle}
          />
        }
      >
        <Icons.brightness />
        <span className='sr-only'>명암 모드 전환</span>
      </TooltipTrigger>
      <TooltipContent>
        명암 모드 전환 <Kbd>⌘⇧D</Kbd> <Kbd>D D</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
