/** @module 책임: 전역 provider·font·toast·navigation progress를 static root HTML에 조립하고 theme cookie는 첫 paint 전 inline script로만 적용한다. */
import { Toaster } from '@/components/ui/sonner';
import { AppProviders } from '@/shell/providers/app-providers';
import { fontVariables } from '@/shell/theme/font.config';
import { ACTIVE_THEME_COOKIE_NAME, DEFAULT_THEME, THEMES } from '@/shell/theme/theme.config';
import { ThemeProvider } from '@/shell/theme/theme-provider';
import { cn } from '@/shared/lib/cn';
import type { Metadata, Viewport } from 'next';
import NextTopLoader from 'nextjs-toploader';
import '../styles/globals.css';

const META_THEME_COLORS = {
  light: '#ffffff',
  dark: '#09090b'
};

// root layout이 cookies()를 읽으면 감쌀 자식이 없어 모든 route의 shell이 request-bound가 된다(ADR 0028).
// 대신 server는 기본 theme으로 static 렌더하고, 이 script가 HTML parsing 중 cookie 값을 검증해 첫 paint 전에
// data-theme을 바꾼다. 허용 목록은 theme.config의 THEMES와 같은 원천에서 직렬화한다.
const THEME_COOKIE_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${ACTIVE_THEME_COOKIE_NAME}=([^;]*)/);if(!m)return;var t=decodeURIComponent(m[1]);if(${JSON.stringify(THEMES.map((theme) => theme.value))}.indexOf(t)>=0)document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

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
    <html lang='ko' suppressHydrationWarning data-theme={DEFAULT_THEME}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_COOKIE_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: META_THEME_COLOR_SCRIPT }} />
        <link
          rel='stylesheet'
          as='style'
          crossOrigin='anonymous'
          href='https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css'
        />
      </head>
      <body
        className={cn(
          'bg-background overflow-x-hidden overscroll-none font-sans antialiased',
          fontVariables
        )}
      >
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
