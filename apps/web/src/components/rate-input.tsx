'use client';
/**
 * 투찰률 입력 — 소수점 안전 (U25) · 조용한 절삭 금지 (U34)
 * 값을 즉시 parseFloat 해서 되돌리면 "90." 의 점이 사라져 90.06 이 9006 이 된다.
 * eaT 투찰률은 소수 3자리(90.099)를 쓰므로 4자리까지 받는다.
 * 한도를 넘는 입력은 "무시"한다 — 사용자가 친 값이 소리 없이 다른 값으로 바뀌지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

const MAX_DECIMALS = 4;

export function RateInput({
  value, onChange, placeholder, className, onFocusChange, onEnter, slotId, ariaLabel, title, inputRef,
}: {
  value: number | null | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  className?: string;
  onFocusChange?: (focused: boolean) => void;
  /** Enter — 다음 카드 첫 칸으로 (Tab 은 브라우저 기본 순서대로 오른쪽 칸) */
  onEnter?: () => void;
  /** 포커스 이동용 식별자 — data-rate-slot */
  slotId?: string;
  /** 포커스 이동을 DOM 조회 없이 하기 위한 등록 콜백 */
  inputRef?: (el: HTMLInputElement | null) => void;
  ariaLabel?: string;
  title?: string;
}) {
  const [text, setText] = useState(value != null ? String(value) : '');
  const focusedRef = useRef(false);

  // 외부 값 변경(저장값 복원·다른 화면에서 수정)은 포커스 중이 아닐 때만 반영
  useEffect(() => {
    if (focusedRef.current) return;
    setText(value != null ? String(value) : '');
  }, [value]);

  return (
    <Input
      value={text}
      inputMode='decimal'
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      title={title}
      data-rate-slot={slotId}
      ref={inputRef}
      onKeyDown={e => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}
      onFocus={() => { focusedRef.current = true; onFocusChange?.(true); }}
      onBlur={() => {
        focusedRef.current = false;
        onFocusChange?.(false);
        const n = parseFloat(text);
        if (!Number.isFinite(n)) { setText(''); onChange(undefined); return; }
        // 이미 4자리로 제한된 입력이라 여기서 값이 바뀌지 않는다 (표기만 정리)
        setText(String(n));
        onChange(n);
      }}
      onChange={e => {
        const raw = e.target.value;
        if (raw === '') { setText(''); onChange(undefined); return; }
        // 숫자와 점 하나만 허용 — 그 외 문자는 입력 자체를 무시
        if (!/^[0-9]*\.?[0-9]*$/.test(raw)) return;
        const dot = raw.indexOf('.');
        // 소수 4자리 초과는 무시 (자르지 않는다)
        if (dot !== -1 && raw.length - dot - 1 > MAX_DECIMALS) return;
        setText(raw);
        const n = parseFloat(raw);
        // "90." 처럼 아직 입력 중인 값은 부모에 반영하지 않는다
        if (Number.isFinite(n) && !raw.endsWith('.')) onChange(n);
      }}
    />
  );
}
