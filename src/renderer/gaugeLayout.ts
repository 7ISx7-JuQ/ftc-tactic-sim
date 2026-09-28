// FLOWER 게이지 / NECTAR 재고 게이지 배치와 칸 내용 (명세서 3.7, 08-5). DOM 비의존 순수 함수
// 게이지는 필드 벽 바깥 직사각형이며 칸 0 = bottom. 좌표는 필드 inch

import { FIELD_SIZE, FLOWER_CIRCLES, LOADING_ZONE_AABB } from '../core/collision';
import type { AABB } from '../core/collision';
import { canFlowerAccept } from '../core/simulationEngine';
import type { GamePiece } from '../core/types';
import type { Point2 } from './viewTransform';

export const GAUGE_WALL_GAP = 0.6;        // 벽과 게이지 사이 (inch)
export const GAUGE_THICKNESS = 3.2;       // 게이지 두께 (inch)
export const GAUGE_SLOT_PITCH = 24 / 9;   // 칸 길이 (inch): FLOWER 게이지 24 in / 9칸
export const GAUGE_PIECE_RADIUS = 1.1;    // 칸 안 원 반지름 (지름 2.2 in, 기물 실제 크기 무시)
export const FLOWER_GAUGE_SLOTS = 9;      // 용량 테이블 최대 총 개수
export const STOCK_GAUGE_SLOTS = 5;       // 휴먼 플레이어 NECTAR 재고 (INITIAL_HUMAN_NECTAR_STOCK)

export interface GaugeLayout {
  rect: AABB;       // 게이지 외곽 (축 정렬)
  slots: Point2[];  // 칸 중심 (0 = bottom)
  along: Point2;    // bottom → top 단위 벡터
  outward: Point2;  // 필드 바깥 방향 단위 벡터 (벽 법선)
}

// 필드 중심 기준 90° 회전 R(x, y) = (144 − y, x): 관중석 벽 FLOWER (96, 142) → (2, 96) → (48, 2) → (142, 48)
const rotatePoint = (p: Point2): Point2 => ({ x: FIELD_SIZE - p.y, y: p.x });
const rotateVector = (v: Point2): Point2 => ({ x: -v.y, y: v.x });

function rotateGauge(g: GaugeLayout): GaugeLayout {
  const a = rotatePoint({ x: g.rect.minX, y: g.rect.minY });
  const b = rotatePoint({ x: g.rect.maxX, y: g.rect.maxY });
  return {
    rect: { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) },
    slots: g.slots.map(rotatePoint),
    along: rotateVector(g.along),
    outward: rotateVector(g.outward),
  };
}

// 기준 게이지: 관중석 벽 FLOWER (96, 142) — x ∈ [96, 120], 벽 바깥 y ∈ [144.6, 147.8], FLOWER 쪽(x = 96)이 bottom
const BASE_FLOWER = { x: 96, y: 142 };
function baseFlowerGauge(): GaugeLayout {
  const minY = FIELD_SIZE + GAUGE_WALL_GAP;
  const maxY = minY + GAUGE_THICKNESS;
  const minX = BASE_FLOWER.x;
  return {
    rect: { minX, maxX: minX + FLOWER_GAUGE_SLOTS * GAUGE_SLOT_PITCH, minY, maxY },
    slots: Array.from({ length: FLOWER_GAUGE_SLOTS }, (_, i) => ({ x: minX + GAUGE_SLOT_PITCH * (i + 0.5), y: (minY + maxY) / 2 })),
    along: { x: 1, y: 0 },
    outward: { x: 0, y: 1 },
  };
}

/** FLOWER index(FLOWER_CIRCLES 순서)의 게이지: 기준 게이지를 그 FLOWER 위치까지 90°씩 회전 복제 */
export function flowerGaugeLayout(index: number): GaugeLayout {
  const target = FLOWER_CIRCLES[index].center;
  let gauge = baseFlowerGauge();
  let at = BASE_FLOWER;
  for (let k = 0; k < 4; k++) {
    if (Math.abs(at.x - target.x) < 1e-9 && Math.abs(at.y - target.y) < 1e-9) return gauge;
    gauge = rotateGauge(gauge);
    at = rotatePoint(at);
  }
  throw new Error(`FLOWER ${index} is not a rotation of the base FLOWER`);
}

/**
 * 휴먼 플레이어 NECTAR 재고 게이지 (룰북 Figure 10-2 ALLIANCE AREA): 진영 벽 바깥 y = 72 중심 5칸.
 * bottom(칸 0) = 아군 로딩 존에 가까운 끝 (RED는 y가 작은 쪽, BLUE는 큰 쪽 — 필드 중심 점대칭)
 */
export function stockGaugeLayout(alliance: 'RED' | 'BLUE'): GaugeLayout {
  const half = (STOCK_GAUGE_SLOTS * GAUGE_SLOT_PITCH) / 2;
  const mid = FIELD_SIZE / 2;
  const red: GaugeLayout = {
    rect: { minX: -GAUGE_WALL_GAP - GAUGE_THICKNESS, maxX: -GAUGE_WALL_GAP, minY: mid - half, maxY: mid + half },
    slots: Array.from({ length: STOCK_GAUGE_SLOTS }, (_, i) => ({ x: -GAUGE_WALL_GAP - GAUGE_THICKNESS / 2, y: mid - half + GAUGE_SLOT_PITCH * (i + 0.5) })),
    along: { x: 0, y: 1 },
    outward: { x: -1, y: 0 },
  };
  if (alliance === 'RED') return red;
  const flip = (p: Point2): Point2 => ({ x: FIELD_SIZE - p.x, y: FIELD_SIZE - p.y });
  return {
    rect: { minX: FIELD_SIZE - red.rect.maxX, maxX: FIELD_SIZE - red.rect.minX, minY: FIELD_SIZE - red.rect.maxY, maxY: FIELD_SIZE - red.rect.minY },
    slots: red.slots.map(flip),
    along: { x: 0, y: -1 },
    outward: { x: 1, y: 0 },
  };
}

/** 재고 게이지의 아군 로딩 존 쪽 끝이 bottom인지 (배치 검증용) */
export function stockBottomFacesLoadingZone(alliance: 'RED' | 'BLUE'): boolean {
  const g = stockGaugeLayout(alliance);
  const zone = LOADING_ZONE_AABB[alliance];
  const zoneY = (zone.minY + zone.maxY) / 2;
  return Math.abs(g.slots[0].y - zoneY) < Math.abs(g.slots[g.slots.length - 1].y - zoneY);
}

// 칸 내용
export type StockSlot = 'PENDING' | 'STOCK' | 'EMPTY';

/** 재고 게이지 칸: bottom부터 투입 대기 → 재고 → 빈 칸 (이미 필드로 투입된 수) */
export function stockSlotStates(pendingHumanNectar: number, nectarStock: number): StockSlot[] {
  const pending = Math.max(0, Math.min(STOCK_GAUGE_SLOTS, Math.floor(pendingHumanNectar)));
  const stock = Math.max(0, Math.min(STOCK_GAUGE_SLOTS - pending, Math.floor(nectarStock)));
  return Array.from({ length: STOCK_GAUGE_SLOTS }, (_, i) => (i < pending ? 'PENDING' : i < pending + stock ? 'STOCK' : 'EMPTY'));
}

type SlotPiece = Pick<GamePiece, 'type' | 'alliance'>;
export type FlowerSlot =
  | { kind: 'PIECE'; piece: SlotPiece }
  | { kind: 'JAM' }    // slot[0] = null (NECTAR 잼): 검정으로 막음
  | { kind: 'EMPTY' }
  | { kind: 'FULL' };  // 최대 조합 도달 후 남은 칸: X 표시

/** FLOWER가 가득 참 = POLLEN / NECTAR 모두 더 넣을 수 없음 (엔진 용량 판정 재사용, 테이블이 엄격 감소라 최대 조합과 동치) */
export function isFlowerFull(pieces: readonly (SlotPiece | null)[]): boolean {
  return !canFlowerAccept({ pieces }, 'POLLEN') && !canFlowerAccept({ pieces }, 'NECTAR');
}

/** FLOWER 게이지 9칸 내용: 칸 k = pieces[k], 가득 차면 나머지 칸 X */
export function flowerGaugeSlots(pieces: readonly (SlotPiece | null)[]): FlowerSlot[] {
  const full = isFlowerFull(pieces);
  return Array.from({ length: FLOWER_GAUGE_SLOTS }, (_, k): FlowerSlot => {
    if (k < pieces.length) {
      const piece = pieces[k];
      return piece ? { kind: 'PIECE', piece } : { kind: k === 0 ? 'JAM' : 'EMPTY' };
    }
    return { kind: full ? 'FULL' : 'EMPTY' };
  });
}

// HIVE 시차 낙하 연출 (명세서 3.7): 립 기준점 → 착지점 선형 보간, 불투명도 0.25 → 1, 윤곽 호 0 → 360°
export interface TipDropView {
  x: number;
  y: number;
  alpha: number;
  progress: number; // u = tipProgressTimer / settleTime ∈ [0, 1] (윤곽 호 = u × 360°)
}

export function tipDropView(lip: Point2, target: Point2, settleTime: number, tipProgressTimer: number): TipDropView {
  const u = settleTime > 0 ? Math.min(1, Math.max(0, tipProgressTimer / settleTime)) : 1;
  return { x: lip.x + (target.x - lip.x) * u, y: lip.y + (target.y - lip.y) * u, alpha: 0.25 + 0.75 * u, progress: u };
}
