'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

type BreadcrumbItem = {
  title: string;
  link: string;
};

// This allows to add custom title as well
const routeMapping: Record<string, BreadcrumbItem[]> = {};

/** 경로 조각 → 한글 (COPY-GUIDE: 화면 이름은 명사형) */
const segmentKo: Record<string, string> = {
  dashboard: '홈', today: '오늘', auction: '공고', analysis: '분석판', wins: '낙찰',
  schools: '학교 찾기', firms: '업체', record: '내 성적', market: '시장 지도', my: '내 사업자',
};

export function useBreadcrumbs() {
  const pathname = usePathname();

  const breadcrumbs = useMemo(() => {
    // Check if we have a custom mapping for this exact path
    if (routeMapping[pathname]) {
      return routeMapping[pathname];
    }

    // If no exact match, fall back to generating breadcrumbs from the path
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join('/')}`;
      return {
        title: segmentKo[segment] ?? decodeURIComponent(segment),
        link: path
      };
    });
  }, [pathname]);

  return breadcrumbs;
}
