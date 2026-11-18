/** @module 책임: 토스트가 뜨는 틀(위치·명암·떠 있는 판 모양)을 둔다. 토스트를 띄우는 입구는 `notify.ts` 하나다(#240). */
'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className='toaster group'
      toastOptions={{ className: 'rounded-panel! shadow-float! text-body!' }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'transparent'
        } as React.CSSProperties
      }
      position='top-center'
      {...props}
    />
  );
};

export { Toaster };
