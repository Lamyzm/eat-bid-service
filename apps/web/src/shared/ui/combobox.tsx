/** @module 책임: 검색으로 좁혀 고르는 목록의 입력·칩·팝업·항목 primitive를 제공한다. */
'use client';

import * as React from 'react';
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';

import { cn } from '@/shared/lib/cn';
import { IconCheck, IconChevronDown, IconX } from '@tabler/icons-react';

/**
 * 목록이 길고 고를 것이 여럿일 때 쓴다. `select`와 나눈 기준은 개수와 검색이다 — 여덟 개 남짓을 하나
 * 고르는 자리는 `select`가 더 적은 조작으로 끝나고, 수백 개에서 검색해 여럿을 담는 자리는 이쪽이다.
 *
 * 팝업은 이 primitive가 소유한다. Base UI Combobox가 positioner와 popup을 함께 갖고 있어 별도
 * popover primitive를 두지 않는다 — 두 개를 겹치면 초점과 Esc의 주인이 둘이 된다.
 */
const Combobox = ComboboxPrimitive.Root;
const ComboboxValue = ComboboxPrimitive.Value;
const ComboboxCollection = ComboboxPrimitive.Collection;

function ComboboxChips({ className, ...props }: ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot='combobox-chips'
      className={cn(
        'flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-background px-1.5 py-1 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        className
      )}
      {...props}
    />
  );
}

/** 고른 것 하나다. 지우는 버튼에 이름을 주지 않으면 화면 낭독기에 `×`만 읽힌다. */
function ComboboxChip({
  className,
  children,
  removeLabel,
  ...props
}: ComboboxPrimitive.Chip.Props & { readonly removeLabel: string }) {
  return (
    <ComboboxPrimitive.Chip
      data-slot='combobox-chip'
      className={cn(
        'flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-xs text-accent-foreground',
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ChipRemove
        aria-label={removeLabel}
        className='rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      >
        <IconX className='size-3' />
      </ComboboxPrimitive.ChipRemove>
    </ComboboxPrimitive.Chip>
  );
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot='combobox-input'
      className={cn(
        'min-w-16 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}

/**
 * 하나만 고르는 자리의 여닫이다. 칩을 쓰는 다중 선택은 `ComboboxChips` 안에서 입력이 곧 여닫이라
 * 이것을 쓰지 않는다.
 */
function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot='combobox-trigger'
      className={cn(
        'flex h-8 w-fit min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-background px-2 text-sm font-medium whitespace-nowrap text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
      {/*
        내려 펼치는 조작이므로 아래쪽 화살표다. 위아래 화살표(⇕)는 값을 위아래로 고르는 조작의 기호라
        같은 줄에 선 다른 조건 칸들과 다른 말을 한다.
      */}
      <ComboboxPrimitive.Icon
        render={<IconChevronDown className='pointer-events-none size-4 shrink-0 text-muted-foreground' />}
      />
    </ComboboxPrimitive.Trigger>
  );
}

function ComboboxContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className='isolate z-50'
      >
        <ComboboxPrimitive.Popup
          data-slot='combobox-content'
          className={cn(
            'max-h-(--available-height) w-(--anchor-width) min-w-52 origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return <ComboboxPrimitive.List data-slot='combobox-list' className={cn('', className)} {...props} />;
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot='combobox-item'
      className={cn(
        'relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className='pointer-events-none absolute right-2 flex size-4 items-center justify-center' />
        }
      >
        <IconCheck className='size-4' />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

/** 검색어에 걸리는 것이 없을 때다. 빈 목록을 말 없이 두면 고장으로 읽힌다. */
function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot='combobox-empty'
      className={cn('px-2 py-3 text-center text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return <ComboboxPrimitive.Group data-slot='combobox-group' className={cn('', className)} {...props} />;
}

function ComboboxGroupLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot='combobox-group-label'
      className={cn('px-2 py-1 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue
};
