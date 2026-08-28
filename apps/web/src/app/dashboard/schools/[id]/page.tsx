import { redirect } from 'next/navigation';

export default async function SchoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // params 는 이미 디코드된 값이다. 다시 인코딩하지 않으면 학교 id 의 `|` 와 한글이
  // 날것으로 나가, 제대로 인코딩해 들어온 링크를 이 홉이 도로 푼다.
  redirect(`/dashboard/analysis/${encodeURIComponent(id)}`);
}
