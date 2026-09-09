// 구현은 canonical `shared/ui/card`가 소유한다. 이 경로는 legacy 화면이 아직 쓰는 재수출 barrel이며
// 남은 legacy import를 옮길 때 통째로 삭제한다.
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent
} from '@/shared/ui/card';
