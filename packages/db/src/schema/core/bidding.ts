/**
 * @module 책임: core schema에서 투찰·낙찰 사실과 재공고 attempt 연결의 table 경계를 소유한다.
 *
 * 공고 관측(attempt·revision)과 투찰 결과는 관측 시점과 재실행 단위가 달라 같은 module에서 함께 바뀌지 않는다.
 * table은 후속 변경에서 추가하며, 지금은 경계만 선언해 procurement module이 다시 비대해지지 않게 한다.
 */
export {};
