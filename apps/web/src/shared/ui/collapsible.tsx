/** @module 책임: 펼침과 접힘을 오가는 영역의 root·trigger·panel을 data-slot 규약에 맞춰 감싼다. */
'use client';

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot='collapsible' {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot='collapsible-trigger' {...props} />;
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel data-slot='collapsible-content' {...props} />;
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
