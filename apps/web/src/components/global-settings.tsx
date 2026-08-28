'use client';
/**
 * 전역 설정 모달 — "내게 보일 것" (사업자 → 지역·품목 파생 관계를 한 화면에)
 * 모달은 조작, 제목 아래 상태 줄(region-status)은 표시 — 역할 분담.
 * 품목은 자리만: user_biz.categories 계약(data 설계 중)이 오면 배선한다.
 * 임의 로컬 저장 금지 — 서버 값과 충돌하기 때문.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconSettings } from '@tabler/icons-react';
import { CATEGORIES } from '@eatbid/shared';
import { useSession } from '@/lib/session';
import { useRegion } from '@/lib/region';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';

const EVT = 'eatbid:globalSettings';

/** 어디서든 전역 설정 모달 열기 (헤더·사이드바 계정 메뉴 공용) */
export function openGlobalSettings() {
  window.dispatchEvent(new Event(EVT));
}

/** 헤더용 진입 버튼 */
export function GlobalSettingsButton() {
  return (
    <Button variant='ghost' size='icon' className='h-8 w-8' aria-label='전역 설정'
      title='전역 설정 (지역·품목)' onClick={() => openGlobalSettings()}>
      <IconSettings className='size-4' />
    </Button>
  );
}

export function GlobalSettingsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);

  const { bizNos, bizNames } = useSession();
  const { homes, toggleHome } = useRegion();

  // 지역 후보 = 현재 자격 지역 ∪ 사업자 참여 이력 지역 (welcome과 같은 유도)
  const [recRegions, setRecRegions] = useState<string[]>([]);
  useEffect(() => {
    if (!open || bizNos.length === 0) return;
    fetch(`/api/firms/record?bizNos=${bizNos.join(',')}`)
      .then(r => r.json())
      .then(d => setRecRegions(Array.isArray(d?.regions) ? d.regions : []))
      .catch(() => {});
  }, [open, bizNos.join(',')]);
  const regionCands = useMemo(
    () => [...new Set([...homes, ...recRegions])], [homes, recRegions]);

  const fmtBiz = (b: string) => `${b.slice(0, 3)}-${b.slice(3, 5)}-${b.slice(5)}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>내게 보일 것</DialogTitle>
          <DialogDescription>사업자를 기준으로 지역·품목이 정해집니다. 화면의 공고·기록이 이 기준으로 좁혀집니다.</DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {/* 사업자 — 파생의 뿌리 */}
          <section className='space-y-1.5'>
            <div className='text-sm font-semibold'>내 사업자</div>
            {bizNos.length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                등록된 사업자가 없습니다.{' '}
                <Link href='/welcome' className='text-primary hover:underline' onClick={() => setOpen(false)}>사업자 등록 →</Link>
              </p>
            ) : (
              <ul className='space-y-1'>
                {bizNos.map(b => (
                  <li key={b} className='flex items-baseline gap-2 text-sm'>
                    <span className='font-medium'>{bizNames[b] ?? '조회 중…'}</span>
                    <span className='text-muted-foreground font-mono text-xs tabular-nums'>{fmtBiz(b)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href='/dashboard/my' className='text-primary text-xs hover:underline'
              onClick={() => setOpen(false)}>사업자 관리 →</Link>
          </section>

          {/* 지역 — 자격 지역 집합 (기존 toggleHome 재사용, 동작 로직 변경 없음) */}
          <section className='space-y-1.5 border-t pt-3'>
            <div className='text-sm font-semibold'>
              지역 <span className='text-muted-foreground font-normal'>(참가 자격은 사무소 소재지 기준)</span>
            </div>
            {regionCands.length === 0 ? (
              <p className='text-muted-foreground text-sm'>사업자를 등록하면 참여 이력에서 지역 후보가 나옵니다.</p>
            ) : (
              <div className='grid grid-cols-2 gap-1.5'>
                {regionCands.map(r => (
                  <Label key={r} className='flex items-center gap-2 text-sm font-normal'>
                    <Checkbox checked={homes.includes(r)} onCheckedChange={() => toggleHome(r)} />
                    {r}
                  </Label>
                ))}
              </div>
            )}
            <p className='text-muted-foreground text-xs'>
              체크 = 내 자격 지역. 다른 지역 구경은 각 화면의 상태 줄에서 고릅니다.
            </p>
          </section>

          {/* 품목 — 자리만. 사업자별 취급 품목 저장(user_biz.categories) 계약이 오면 배선 */}
          <section className='space-y-1.5 border-t pt-3'>
            <div className='text-sm font-semibold'>
              품목 <span className='text-muted-foreground font-normal'>(전체 표시 중)</span>
            </div>
            <div className='pointer-events-none grid grid-cols-3 gap-1.5 opacity-60'>
              {CATEGORIES.map(c => (
                <Label key={c} className='text-muted-foreground flex items-center gap-2 text-sm font-normal'>
                  <Checkbox checked disabled />
                  {c}
                </Label>
              ))}
            </div>
            <p className='text-muted-foreground text-xs'>사업자별 취급 품목 저장은 준비 중입니다. 지금은 전 품목이 표시됩니다.</p>
          </section>
        </div>

        <div className='flex justify-end'>
          <Button size='sm' onClick={() => setOpen(false)}>닫기</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
