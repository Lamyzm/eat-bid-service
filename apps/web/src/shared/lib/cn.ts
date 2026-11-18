/** @module 책임: Tailwind class 조건 조합과 충돌 해소를 공통 함수 하나로 제공한다. */
import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// 토큰 파일이 새로 이름 붙인 글자 단·반경·폭을 충돌 해소에 알린다. 알리지 않으면 `text-body`를 글자 색으로 읽어
// `text-primary-foreground`와 한 칸으로 보고 둘 중 하나를 지운다(#240).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['label', 'body', 'title', 'value'],
      radius: ['chip', 'control', 'panel'],
      container: ['page', 'read', 'notice']
    }
  }
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
