/** @module 책임: 활성 워크스페이스의 등록 사업자 목록 조회 상태와 등록·위치 편집 진입을 한 화면으로 조립한다. */
'use client';

import { useQuery } from '@tanstack/react-query';

import { accountQueries, type PrivateWorkspaceScope } from '@/api/account';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

import {
  businessNumberDisplay,
  supplierStatusText
} from '../_model/registered-business-view';
import { BusinessLocationForm } from './business-location-form';
import { BusinessRegisterForm } from './business-register-form';

interface MyBusinessesPanelProps {
  readonly scope: PrivateWorkspaceScope;
  readonly canWrite: boolean;
}

export function MyBusinessesPanel({ scope, canWrite }: MyBusinessesPanelProps) {
  const businesses = useQuery(accountQueries.businesses(scope));

  return (
    <div className='grid gap-4'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>사업자 등록</CardTitle>
          <CardDescription>
            {canWrite
              ? '등록한 사업자가 내 화면의 기준이 됩니다. 여러 개를 등록할 수 있습니다.'
              : '등록과 주소 변경은 관리자만 할 수 있습니다.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessRegisterForm scope={scope} canWrite={canWrite} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>등록된 사업자</CardTitle>
        </CardHeader>
        <CardContent className='grid gap-4'>
          {businesses.isPending ? <Skeleton className='h-20 w-full' /> : null}
          {businesses.isError ? (
            <div className='grid gap-2'>
              <Alert variant='destructive'>
                <AlertTitle>저장된 정보를 불러오지 못했습니다</AlertTitle>
                <AlertDescription>다시 시도해 주세요.</AlertDescription>
              </Alert>
              <div>
                {/* 실패를 빈 목록으로 바꾸지 않는다. 사용자가 복구를 시작할 control을 같은 자리에 둔다. */}
                <Button variant='outline' onClick={() => void businesses.refetch()}>다시 시도</Button>
              </div>
            </div>
          ) : null}
          {businesses.data?.businesses.length === 0 ? (
            <p className='text-sm text-muted-foreground'>아직 등록한 사업자가 없습니다.</p>
          ) : null}
          {businesses.data?.businesses.map((business) => (
            <section
              key={business.businessId}
              aria-label={`등록 사업자 ${businessNumberDisplay(business.businessNumber)}`}
              className='grid gap-2 rounded-md border p-3'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-mono text-sm'>
                  {businessNumberDisplay(business.businessNumber)}
                </span>
                <Badge variant={business.supplier.kind === 'linked' ? 'secondary' : 'outline'}>
                  {supplierStatusText(business)}
                </Badge>
              </div>
              <BusinessLocationForm business={business} scope={scope} canWrite={canWrite} />
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
