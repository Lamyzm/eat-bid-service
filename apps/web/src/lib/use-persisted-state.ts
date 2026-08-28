'use client';
/**
 * 브라우저에 남기는 UI 상태 — 읽기·쓰기 useEffect 쌍을 한 곳으로 (선언적 감사 5번)
 *
 * 지켜야 할 규칙을 훅이 강제한다:
 * 1. 초기 state 는 넘겨받은 값만 쓴다. 저장소는 마운트 뒤 effect 에서만 읽는다.
 *    (localStorage 가 첫 렌더에 끼면 SSR/CSR 이 갈린다 — React #418 이력)
 * 2. 저장소를 읽기 전에는 쓰지 않는다. 초기값이 남아 있던 값을 덮지 않도록.
 * 3. 읽을 수 없는 값은 조용히 버리지 않는다. 사본을 `<key>.unreadable` 로 남긴다.
 *
 * 저장 형식은 기존 값 그대로 둔다(플래그 '1'/'0', 선택지 원문, JSON) — 마이그레이션 없음.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type Codec<T> = {
  /** 읽을 수 없으면 undefined, 손상이면 throw */
  read: (raw: string) => T | undefined;
  write: (v: T) => string;
};

/** '1' / '0' — 기존 플래그 저장 형식 */
export const flagCodec: Codec<boolean> = {
  read: raw => (raw === '1' ? true : raw === '0' ? false : undefined),
  write: v => (v ? '1' : '0'),
};

/** 원문 문자열 — 허용 목록 밖이면 무시(렌즈 이름이 바뀌었을 수 있다) */
export function choiceCodec<T extends string>(allowed: readonly T[]): Codec<T> {
  return {
    read: raw => (allowed.includes(raw as T) ? (raw as T) : undefined),
    write: v => v,
  };
}

/** JSON — 사용자 데이터가 들어가는 유일한 형식이라 손상 시 사본을 남긴다 */
export function jsonCodec<T>(isValid?: (v: unknown) => boolean): Codec<T> {
  return {
    read: raw => {
      const parsed = JSON.parse(raw); // 실패 시 throw → 사본 보존 경로
      if (isValid && !isValid(parsed)) throw new Error('unexpected shape');
      return parsed as T;
    },
    write: v => JSON.stringify(v),
  };
}

/** 저장소 최소 인터페이스 — 테스트에서 가짜 저장소를 넣을 수 있게 */
export type KV = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * 저장된 값 읽기 — 읽지 못하면 원본을 덮지 않고 사본만 남긴다.
 * 경쟁사 목록이 조용히 빈 배열로 덮이던 사고가 여기서 났다.
 */
export function readStored<T>(key: string, codec: Codec<T>, kv: KV): {
  value: T | undefined; unreadable: boolean;
} {
  let raw: string | null = null;
  try { raw = kv.getItem(key); } catch { return { value: undefined, unreadable: false }; }
  if (raw == null) return { value: undefined, unreadable: false };
  try {
    return { value: codec.read(raw), unreadable: false };
  } catch {
    try {
      const bk = `${key}.unreadable`;
      if (!kv.getItem(bk)) kv.setItem(bk, raw);
    } catch {}
    return { value: undefined, unreadable: true };
  }
}

export function usePersistedState<T>(
  key: string,
  initial: T,
  codec: Codec<T>,
  opts?: {
    /** 저장된 값이 없을 때 마운트 후 적용할 값 (초기 렌더 깜빡임을 피해야 하는 경우) */
    whenMissing?: T;
  },
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const hydrated = useRef(false);
  const dirty = useRef(false); // 사용자가 실제로 바꾸기 전에는 저장소를 건드리지 않는다

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null && opts?.whenMissing !== undefined) setValue(opts.whenMissing);
      else if (raw != null) {
        const { value: stored } = readStored(key, codec, localStorage);
        if (stored !== undefined) setValue(stored);
      }
    } catch {}
    hydrated.current = true;
    // key 는 호출부에서 상수다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated.current || !dirty.current) return; // 읽기 전·변경 전에는 쓰지 않는다
    try { localStorage.setItem(key, codec.write(value)); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  const set = useCallback((v: T | ((prev: T) => T)) => { dirty.current = true; setValue(v); }, []);
  return [value, set];
}

/** 접힘·펼침 같은 on/off */
export function usePersistedFlag(key: string, initial = false, opts?: { whenMissing?: boolean }) {
  return usePersistedState<boolean>(key, initial, flagCodec, opts);
}

/** 탭·렌즈처럼 정해진 선택지 */
export function usePersistedChoice<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  return usePersistedState<T>(key, initial, choiceCodec(allowed));
}
