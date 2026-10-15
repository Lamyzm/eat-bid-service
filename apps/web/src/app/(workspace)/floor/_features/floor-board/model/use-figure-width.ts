/**
 * @module 책임: SVG 그림이 담기는 칸의 실제 폭을 재어 돌려준다.
 *
 * 그림은 그 폭으로 다시 그린다. 900px 고정 viewBox를 폰 폭으로 줄이면 글자가 5px로 작아진다(시안 v6 리뷰). 서버가 그린 첫 화면은
 * 폭을 모르니 넓은 화면 기준(900)으로 그리고, 붙은 뒤 실제 폭으로 바꾼다.
 */
import { useEffect, useRef, useState } from 'react';

const DEFAULT_WIDTH = 900;
const MIN_WIDTH = 340;

export function useFigureWidth<Element extends HTMLElement>() {
  const ref = useRef<Element>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width);
      // 숨은 탭에서는 폭이 0이다. 그때는 앞 값을 두고, 탭이 열려 크기가 잡히면 다시 잰다.
      if (measured > 0) setWidth(Math.max(MIN_WIDTH, measured));
    };
    measure();
    const size = new ResizeObserver(measure);
    size.observe(element);
    return () => size.disconnect();
  }, []);
  return [ref, width] as const;
}
