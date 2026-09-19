/** @module 책임: 값을 고르는 것이 아니라 여러 칸을 한 패널에 담아 여는 여닫이의 trigger·패널 primitive를 제공한다. */
'use client';

import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';

import { cn } from '@/shared/lib/cn';
import { controlPillClass, controlPillIconClass } from './control-pill';
import { IconChevronDown } from '@tabler/icons-react';

/**
 * `Combobox`·`Select`와 나눈 기준은 **패널 안에 무엇이 있느냐**다. 고를 항목 목록이면 그 둘이고,
 * 서로 다른 입력 여럿(기간의 시작·종료, 명단의 최소·최대)이면 이것이다. 목록이 아닌 것을 목록
 * primitive에 넣으면 방향키가 항목을 옮기려 들고 Enter가 값을 고르려 든다.
 *
 * 초점 가둠·복귀·Esc는 Base UI가 소유한다. 직접 만들지 않는다.
 */
const Popover = PopoverPrimitive.Root;

/**
 * 같은 줄에 선 다른 조건 칸과 **같은 모양**이어야 한다. 조건 막대는 여닫이가 여섯 개 나란히 서는
 * 자리라 테두리·높이·화살표가 칸마다 다르면 사용자는 서로 다른 종류의 조작으로 읽는다.
 */
function PopoverTrigger({ className, children, ...props }: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger
      data-slot='popover-trigger'
      className={cn(
        controlPillClass,
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        className
      )}
      {...props}
    >
      {children}
      <IconChevronDown aria-hidden className={controlPillIconClass} />
    </PopoverPrimitive.Trigger>
  );
}

function PopoverContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 6,
  align = 'start',
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className='isolate z-50'
      >
        <PopoverPrimitive.Popup
          data-slot='popover-content'
          className={cn(
            'max-h-(--available-height) min-w-52 origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-2 break-keep [overflow-wrap:anywhere] text-popover-foreground shadow-md ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

const PopoverClose = PopoverPrimitive.Close;
const PopoverTitle = PopoverPrimitive.Title;
const PopoverDescription = PopoverPrimitive.Description;

export { Popover, PopoverClose, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger };
