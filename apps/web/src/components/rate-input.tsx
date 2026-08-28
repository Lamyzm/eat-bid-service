'use client';
/**
 * 투찰률 입력 — 소수점 안전 (U25)
 * 값을 즉시 parseFloat 해서 되돌리면 "90." 의 점이 사라져 90.06 이 9006 이 된다.
 * 타이핑 중에는 문자열 그대로 두고, 유효한 수치일 때만 부모에 알린다.
 */
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

export function RateInput({
  value, onChange, placeholder, className,
}: {
  value: number | null | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  className?: string;
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
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => {
        focusedRef.current = false;
        // 끝에 남은 점·빈 값 정리
        const n = parseFloat(text);
        if (!Number.isFinite(n)) { setText(''); onChange(undefined); return; }
        const fixed = Math.round(n * 100) / 100; // 소수점 2자리
        setText(String(fixed));
        onChange(fixed);
      }}
      onChange={e => {
        // 숫자와 점만, 점은 하나, 소수 2자리까지
        let v = e.target.value.replace(/[^0-9.]/g, '');
        const first = v.indexOf('.');
        if (first !== -1) v = v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, '');
        const [i, d] = v.split('.');
        if (d != null && d.length > 2) v = `${i}.${d.slice(0, 2)}`;
        setText(v);
        const n = parseFloat(v);
        // "90." 처럼 아직 입력 중인 값은 부모에 반영하지 않는다
        if (v === '' ) onChange(undefined);
        else if (Number.isFinite(n) && !v.endsWith('.')) onChange(n);
      }}
    />
  );
}
