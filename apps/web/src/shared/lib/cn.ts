/** @module 책임: Tailwind class 조건 조합과 충돌 해소를 공통 함수 하나로 제공한다. */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
