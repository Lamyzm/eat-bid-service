/** @module 책임: 전역 provider·글꼴·toast·navigation progress를 static root HTML에 조립하고 sidebar·명암 상태는 첫 paint 전 inline script로만 적용한다. */
import { Toaster } from '@/shared/ui/sonner';
import { AppProviders } from '@/shell/providers/app-providers';
import { SIDEBAR_COOKIE_NAME, SIDEBAR_STATE_ATTRIBUTE } from '@/shell/layout/sidebar-state';
import { META_THEME_COLORS } from '@/shell/theme/meta-theme-color';
import { ThemeProvider } from '@/shell/theme/theme-provider';
import type { Metadata, Viewport } from 'next';
import NextTopLoader from 'nextjs-toploader';
import '../styles/globals.css';

// `</script>`나 HTML comment 열기로 script를 조기 종료시키지 못하게 직렬화 결과를 escape한다.
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003C');
}

// root layout이 cookies()를 읽으면 감쌀 자식이 없어 모든 route의 shell이 request-bound가 된다(ADR 0028).
// 대신 server는 펼친 sidebar로 static 렌더하고, 이 script가 HTML parsing 중 cookie를 읽어 첫 paint 전에 적용한다.
// 색 테마는 하나뿐이라 고르는 cookie가 없다(#240). 옛 `active_theme` cookie가 남아 있어도 읽는 곳이 없어 같은 색이다.

const SIDEBAR_COOKIE_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${SIDEBAR_COOKIE_NAME}=([^;]*)/);if(m&&m[1]!=="true")document.documentElement.setAttribute(${inlineJson(SIDEBAR_STATE_ATTRIBUTE)},"collapsed")}catch(e){}})()`;

const META_THEME_COLOR_SCRIPT = `try{if(localStorage.theme==='dark'||((!('theme' in localStorage)||localStorage.theme==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.querySelector('meta[name="theme-color"]')?.setAttribute('content','${META_THEME_COLORS.dark}')}}catch(_){}`;

export const metadata: Metadata = {
  ...(process.env.NEXT_PUBLIC_APP_URL
    ? { metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL) }
    : {}),
  title: {
    default: 'eatbid — 학교급식 입찰 기록',
    template: '%s | eatbid'
  },
  description: '학교급식 공고와 개찰 결과를 정리해 보여줍니다. 낙찰을 예측하지 않습니다.',
  openGraph: {
    title: 'eatbid — 학교급식 입찰 기록',
    description: '학교급식 공고와 개찰 결과를 정리해 보여줍니다. 낙찰을 예측하지 않습니다.',
    siteName: 'eatbid',
    locale: 'ko_KR',
    type: 'website'
  },
  twitter: {
    card: 'summary',
    title: 'eatbid — 학교급식 입찰 기록',
    description: '학교급식 공고와 개찰 결과를 정리해 보여줍니다. 낙찰을 예측하지 않습니다.'
  }
};

export const viewport: Viewport = {
  themeColor: META_THEME_COLORS.light
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='ko' suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_COOKIE_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: META_THEME_COLOR_SCRIPT }} />
        <link
          rel='stylesheet'
          as='style'
          crossOrigin='anonymous'
          href='https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css'
        />
      </head>
      <body className='bg-background text-foreground overflow-x-hidden overscroll-none font-sans antialiased'>
        <NextTopLoader color='var(--primary)' showSpinner={false} />
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
          enableColorScheme
        >
          <AppProviders>
            <Toaster />
            {children}
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
