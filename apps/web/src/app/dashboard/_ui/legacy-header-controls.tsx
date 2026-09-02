/** @module 책임: legacy dashboard에만 필요한 지역 칩·session 부팅·전역 설정 control을 header slot에 조립한다. */
import { GlobalSettingsButton, GlobalSettingsDialog } from '@/components/global-settings';
import { RegionSwitcher } from '@/components/region-switcher';
import { SessionBoot } from '@/components/session-boot';

/**
 * 이 control들은 legacy endpoint(/api/open, /api/me 등)를 직접 읽는다. ADR 0023의 "shell은 endpoint를
 * 읽지 않는다"를 지키기 위해 shell이 아니라 legacy dashboard layout이 slot으로 주입한다.
 */
export function LegacyHeaderControls() {
  return (
    <>
      <SessionBoot />
      <RegionSwitcher />
      <GlobalSettingsButton />
      <GlobalSettingsDialog />
    </>
  );
}
