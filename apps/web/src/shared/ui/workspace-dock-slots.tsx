/** @module 책임: 화면의 React context를 유지하면서 공통 레이아웃의 안정된 DOM 자리로 보조 UI를 옮긴다. */
'use client';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';

type DockSlotName = 'panel' | 'rail' | 'header';
type Hosts = Record<DockSlotName, HTMLElement | null>;
type Slots = {
  hosts: Hosts;
  register: (slot: DockSlotName, host: HTMLElement | null) => void;
};
const Context = createContext<Slots | null>(null);

export function DockSlotsProvider({ children }: { readonly children: ReactNode }) {
  const [hosts, setHosts] = useState<Hosts>({ panel: null, rail: null, header: null });
  const register = useCallback((slot: DockSlotName, host: HTMLElement | null) => {
    setHosts((current) => (current[slot] === host ? current : { ...current, [slot]: host }));
  }, []);
  const value = useMemo(() => ({ hosts, register }), [hosts, register]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function DockSlotHost({
  slot,
  className
}: {
  readonly slot: DockSlotName;
  readonly className?: string;
}) {
  const register = useContext(Context)?.register;
  const attach = useCallback(
    (host: HTMLDivElement | null) => {
      register?.(slot, host);
    },
    [register, slot]
  );
  return <div ref={attach} data-dock-host={slot} className={className} />;
}

export function DockSlot({
  slot,
  children
}: {
  readonly slot: DockSlotName;
  readonly children: ReactNode;
}) {
  const host = useContext(Context)?.hosts[slot];
  const [mount] = useState(() =>
    typeof document === 'undefined' ? null : document.createElement('div')
  );
  // Next의 Activity는 화면을 보관하며 Effect를 정리한다. portal의 자리를 함께 떼어야 숨겨진
  // 과거 화면이 전역 폭을 점유하지 않는다. 다시 보이면 같은 노드를 붙여 입력·선택을 보존한다.
  useLayoutEffect(() => {
    if (!host || !mount) return;
    host.appendChild(mount);
    return () => mount.remove();
  }, [host, mount]);
  return host && mount ? createPortal(children, mount) : null;
}
