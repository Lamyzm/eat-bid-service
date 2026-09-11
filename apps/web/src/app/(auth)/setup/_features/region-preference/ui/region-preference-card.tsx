/**
 * @module 책임: 내 지역 칸의 조회·선택·저장을 한 화면으로 조립하고, 저장 전 미리보기와 계정 하나에 하나라는
 * 범위를 함께 말한다.
 */
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { accountQueries, putMyRegionPreference, type PrivateWorkspaceScope } from '@/api/account';
import { eligibilityAreaQueries, type EligibilityAreaGroup } from '@/api/eligibility-areas';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

import {
  areaText,
  groupAreaCount,
  groupSelectedCount,
  removeArea,
  sameSelection,
  selectedAreas,
  selectionToCodeValueIds,
  toggleArea,
  type RegionSelection
} from '../model/region-selection';
import { RegionPreview } from './region-preview';

const CHIP = 'inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-semibold';
const CHIP_OFF = `${CHIP} border-border bg-background text-muted-foreground hover:bg-muted`;
const CHIP_ON = `${CHIP} border-primary bg-primary text-primary-foreground`;

function AreaGroup({
  group,
  selection,
  expanded,
  canWrite,
  onToggleGroup,
  onToggleArea
}: {
  readonly group: EligibilityAreaGroup;
  readonly selection: RegionSelection;
  readonly expanded: boolean;
  readonly canWrite: boolean;
  readonly onToggleGroup: () => void;
  readonly onToggleArea: (codeValueId: string) => void;
}) {
  const chosen = groupSelectedCount(group, selection);
  return (
    <div className='border-b last:border-b-0'>
      <button
        type='button'
        aria-expanded={expanded}
        onClick={onToggleGroup}
        className='flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50'
      >
        <span aria-hidden className='text-xs text-muted-foreground'>{expanded ? '▾' : '▸'}</span>
        <span className='text-sm font-semibold'>{areaText(group.all)}</span>
        <span className='ml-auto text-[13px] tabular-nums text-muted-foreground'>
          {chosen} / {groupAreaCount(group)}
        </span>
      </button>
      {expanded ? (
        <div className='flex flex-wrap gap-2 px-3 pb-3 pl-9'>
          {[group.all, ...group.parts].map((area) => {
            const on = selection.has(area.codeValueId);
            return (
              <button
                key={area.codeValueId}
                type='button'
                aria-pressed={on}
                disabled={!canWrite}
                onClick={() => onToggleArea(area.codeValueId)}
                className={on ? CHIP_ON : CHIP_OFF}
              >
                {areaText(area)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 지역은 계정 하나에 하나다. 사업자는 여럿이어도 배달 다니는 범위는 하나이므로 화면이 그 범위 차이를
 * 제목 옆에서 말한다(ADR 0048 결정 6).
 *
 * 미리보기는 저장 전에만 둔다. 저장한 뒤에도 계속 남기면 설정 화면이 상시 대시보드가 되고, 그 숫자가
 * 오늘 화면과 어긋나는 순간 어느 쪽이 사실인지 말할 수 없다(사용자 결정 2026-09-11).
 */
export function RegionPreferenceCard({
  scope,
  canWrite
}: {
  readonly scope: PrivateWorkspaceScope;
  readonly canWrite: boolean;
}) {
  const client = useQueryClient();
  const catalog = useQuery(eligibilityAreaQueries.list());
  const preference = useQuery(accountQueries.regionPreference(scope));
  const [draft, setDraft] = useState<RegionSelection | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const groups = catalog.data?.groups ?? [];
  const saved = preference.data?.preference.areas.map((area) => area.codeValueId) ?? [];
  // 아직 만지지 않았으면 저장된 목록이 곧 지금 선택이다. 서버 답이 늦게 와도 사용자의 편집을 덮지 않는다.
  const selection: RegionSelection = draft ?? new Set(saved);
  const chosen = selectedAreas(groups, selection);
  const codeValueIds = selectionToCodeValueIds(groups, selection);
  const dirty = !sameSelection(saved, codeValueIds);

  const save = useMutation({
    mutationFn: () => putMyRegionPreference({ codeValueIds }),
    onSuccess: async () => {
      setDraft(null);
      await client.invalidateQueries({ queryKey: accountQueries.regionPreference(scope).queryKey });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
          내 지역
          <Badge variant='outline' className='font-medium'>계정 하나에 하나</Badge>
        </CardTitle>
        <CardDescription>
          공고가 참가를 제한하는 지역입니다. 배달 다니는 범위를 고르세요. 사업자가 둘이어도 범위는 하나입니다.
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-4'>
        {catalog.isPending || preference.isPending ? <Skeleton className='h-40 w-full' /> : null}
        {catalog.isError || preference.isError ? (
          <div className='grid gap-2'>
            <Alert variant='destructive'>
              <AlertTitle>지역 목록을 불러오지 못했습니다</AlertTitle>
              <AlertDescription>다시 시도해 주세요.</AlertDescription>
            </Alert>
            <div>
              <Button variant='outline' onClick={() => { void catalog.refetch(); void preference.refetch(); }}>
                다시 시도
              </Button>
            </div>
          </div>
        ) : null}

        {catalog.data && preference.data ? (
          <>
            <div className='max-h-72 overflow-auto rounded-lg border'>
              {groups.map((group) => (
                <AreaGroup
                  key={group.all.codeValueId}
                  group={group}
                  selection={selection}
                  expanded={expanded === group.all.codeValueId}
                  canWrite={canWrite}
                  onToggleGroup={() =>
                    setExpanded((current) => (current === group.all.codeValueId ? null : group.all.codeValueId))}
                  onToggleArea={(codeValueId) => setDraft(toggleArea(selection, group, codeValueId))}
                />
              ))}
            </div>

            <div className='flex min-h-8 flex-wrap gap-2' aria-label='고른 지역'>
              {chosen.length === 0 ? (
                <span className='text-sm text-muted-foreground'>아직 고른 지역이 없습니다.</span>
              ) : (
                chosen.map((area) => (
                  <span
                    key={area.codeValueId}
                    className='inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[13px] font-semibold text-primary'
                  >
                    {areaText(area)}
                    {canWrite ? (
                      <button
                        type='button'
                        onClick={() => setDraft(removeArea(selection, area.codeValueId))}
                        className='text-primary/60 hover:text-primary'
                      >
                        <span aria-hidden>×</span>
                        <span className='sr-only'>{areaText(area)} 빼기</span>
                      </button>
                    ) : null}
                  </span>
                ))
              )}
            </div>

            <p className='rounded-lg bg-muted/40 p-3 text-[13px] leading-relaxed text-muted-foreground'>
              <b className='text-foreground'>시군구를 고르면 그 도의 전체가 같이 켜집니다.</b> 도 전체로 열린
              공고는 그 시 업체도 낼 수 있기 때문입니다. 켜진 것은 위 목록에 그대로 보이고 원하시면 뺄 수
              있습니다. 여기서 고른 지역은 참가 자격 판정이 아니라 목록을 좁히는 조건입니다 — 업종·실적 같은
              나머지 조건은 공고에서 직접 확인하셔야 합니다.
            </p>

            {/* 저장 전에 결과를 먼저 보여 준다. 설정만 하고 뭐가 달라지는지 모르는 화면이 되지 않게. */}
            <RegionPreview codeValueIds={codeValueIds} />

            {save.isError ? (
              <Alert variant='destructive'>
                <AlertTitle>저장하지 못했습니다</AlertTitle>
                <AlertDescription>다시 시도해 주세요.</AlertDescription>
              </Alert>
            ) : null}

            <div className='flex flex-wrap gap-2'>
              <Button disabled={!canWrite || !dirty || save.isPending} onClick={() => save.mutate()}>
                이 설정으로 저장
              </Button>
              <Button variant='outline' disabled={!dirty || save.isPending} onClick={() => setDraft(null)}>
                되돌리기
              </Button>
              {preference.data.preference.confirmedAt === null ? (
                <span className='self-center text-[13px] font-semibold text-pushed'>아직 저장하지 않았습니다</span>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
