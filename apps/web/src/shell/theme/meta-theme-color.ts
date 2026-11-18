/**
 * @module 책임: 브라우저 주소창 색(meta theme-color)에 쓸 지면 색 두 벌을 둔다. meta 태그는 CSS 변수를 읽지 못해 글자값이
 * 필요하므로 토큰 파일의 지면 색을 여기 옮겨 적고, 둘이 같은지는 시험이 단언한다. 색 글자값 검사가 허락하는 자리는 이 파일과
 * 토큰 파일 둘뿐이다.
 */
export const META_THEME_COLORS = {
  light: '#f9fafb',
  dark: '#131519'
} as const;
