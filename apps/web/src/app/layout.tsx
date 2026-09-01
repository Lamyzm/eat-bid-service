/** @module 책임: 전역 provider·theme cookie·font·toast·navigation progress를 root HTML에 조립한다. */
import { Toaster } from '@/components/ui/sonner';
import { AppProviders } from '@/shell/providers/app-providers';
import { fontVariables } from '@/shell/theme/font.config';
import { ACTIVE_THEME_COOKIE_NAME, DEFAULT_THEME, isThemeValue } from '@/shell/theme/theme.config';
import { ThemeProvider } from '@/shell/theme/theme-provider';
import { cn } from '@/shared/lib/cn';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import NextTopLoader from 'nextjs-toploader';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import '../styles/globals.css';

const META_THEME_COLORS = {
  light: '#ffffff',
  dark: '#09090b'
};

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const activeThemeValue = cookieStore.get(ACTIVE_THEME_COOKIE_NAME)?.value;
  const themeToApply = isThemeValue(activeThemeValue) ? activeThemeValue : DEFAULT_THEME;

  return (
    <html lang='ko' suppressHydrationWarning data-theme={themeToApply}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                // Set meta theme color
                if (localStorage.theme === 'dark' || ((!('theme' in localStorage) || localStorage.theme === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '${META_THEME_COLORS.dark}')
                }
              } catch (_) {}
            `
          }}
        />
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
        <NuqsAdapter>
          <ThemeProvider
            attribute='class'
            defaultTheme='system'
            enableSystem
            disableTransitionOnChange
            enableColorScheme
          >
            <AppProviders activeThemeValue={themeToApply}>
              <Toaster />
              {children}
            </AppProviders>
          </ThemeProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
