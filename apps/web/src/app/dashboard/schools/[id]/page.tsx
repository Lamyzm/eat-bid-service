import { redirect } from 'next/navigation';
import { schoolIdFromParam, schoolIdToPath } from '@/lib/school-id';

export default async function SchoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Next 는 세그먼트를 디코드하지 않고 준다. 여기서 다시 인코딩하면 이중 인코딩이 되어
  // 다음 홉이 학교를 못 찾는다(낙찰 속보·발주 예정 링크가 그래서 죽어 있었다).
  redirect(`/dashboard/analysis/${schoolIdToPath(schoolIdFromParam(id))}`);
}
