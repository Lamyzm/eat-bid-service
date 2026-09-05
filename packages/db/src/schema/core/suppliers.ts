/**
 * @module 책임: core schema에서 참여 업체(`SupplierParty`)와 원천 계정 identity의 table 경계를 소유한다.
 *
 * 구매기관(`Organization`)과 참여 업체는 서로 다른 aggregate이므로 조직 module과 같은 파일에 두지 않는다.
 * table은 후속 변경에서 추가하며, 지금은 경계만 선언해 procurement module이 다시 비대해지지 않게 한다.
 */
export {};
