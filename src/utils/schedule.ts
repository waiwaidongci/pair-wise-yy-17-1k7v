import type { Course, ObstacleKind, RouteAnalysis } from '../types/course';
import type { EquipmentKind, ScheduleState, TrainingSession } from '../types/schedule';
import { analyzeCourse } from './course';

export const EQUIPMENT_KINDS: EquipmentKind[] = [
  'vertical',
  'oxer',
  'triple',
  'wall',
  'water',
  'combination',
];

// 排场表时间轴：每小时像素高度
export const HOUR_HEIGHT = 64;

export const EQUIPMENT_LABELS: Record<EquipmentKind, string> = {
  vertical: '单横木',
  oxer: '双横木',
  triple: '三重横木',
  wall: '砖墙',
  water: '水障',
  combination: '连续组合',
};

// 俱乐部一套障碍器材的默认清单（每类可同时布设的障碍数量）
export const DEFAULT_EQUIPMENT_STOCK: Record<EquipmentKind, number> = {
  vertical: 12,
  oxer: 8,
  triple: 4,
  wall: 4,
  water: 2,
  combination: 2,
};

export function zeroEquipment(): Record<EquipmentKind, number> {
  return {
    vertical: 0,
    oxer: 0,
    triple: 0,
    wall: 0,
    water: 0,
    combination: 0,
  };
}

export function cloneEquipment(value: Partial<Record<EquipmentKind, number>>): Record<EquipmentKind, number> {
  const base = zeroEquipment();
  EQUIPMENT_KINDS.forEach((kind) => {
    base[kind] = value[kind] ?? 0;
  });
  return base;
}

// 一场路线按障碍类型与数量预占器材：统计顺序中每类障碍的数量
export function equipmentFromCourse(course: Course): Record<EquipmentKind, number> {
  const counts = zeroEquipment();
  const byId = new Map(course.obstacles.map((item) => [item.id, item]));
  course.sequence.forEach((id) => {
    const obstacle = byId.get(id);
    if (obstacle) counts[obstacle.kind as EquipmentKind] += 1;
  });
  return counts;
}

export function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

export function slotsOverlap(a: { date: string; startTime: string; endTime: string }, b: { date: string; startTime: string; endTime: string }): boolean {
  if (a.date !== b.date) return false;
  const aStart = timeToMinutes(a.startTime);
  const aEnd = timeToMinutes(a.endTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd = timeToMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

// 统计与目标场次同时段、且已排定场次的器材占用（可排除某场，避免重复扣减）
export function reservedForSlot(
  sessions: TrainingSession[],
  slot: { date: string; startTime: string; endTime: string },
  excludeId?: string,
): Record<EquipmentKind, number> {
  const totals = zeroEquipment();
  sessions.forEach((session) => {
    if (session.id === excludeId) return;
    if (session.status !== 'scheduled') return;
    if (!slotsOverlap(session, slot)) return;
    EQUIPMENT_KINDS.forEach((kind) => {
      totals[kind] += session.reserved[kind] ?? 0;
    });
  });
  return totals;
}

export interface KindAvailability {
  kind: EquipmentKind;
  label: string;
  required: number;
  reserved: number;
  total: number;
  available: number;
  shortage: number;
}

// 某场次在同时段的器材余量：总量 - 同时段已排定占用
export function availabilityForSession(
  session: TrainingSession,
  sessions: TrainingSession[],
  equipment: Record<EquipmentKind, number>,
): KindAvailability[] {
  const required = equipmentFromCourse(session.course);
  const reserved = reservedForSlot(sessions, session, session.id);
  return EQUIPMENT_KINDS.map((kind) => {
    const total = equipment[kind] ?? 0;
    const used = reserved[kind];
    const available = Math.max(0, total - used);
    const need = required[kind];
    return {
      kind,
      label: EQUIPMENT_LABELS[kind],
      required: need,
      reserved: used,
      total,
      available,
      shortage: Math.max(0, need - available),
    };
  });
}

// 找出占用器材的场次（取同时段占用该短缺类最多的已排定场次）
export function findOccupier(
  session: TrainingSession,
  sessions: TrainingSession[],
  shortages: EquipmentKind[],
): TrainingSession | null {
  const overlapping = sessions.filter(
    (item) => item.id !== session.id && item.status === 'scheduled' && slotsOverlap(item, session),
  );
  let best: TrainingSession | null = null;
  let bestScore = 0;
  overlapping.forEach((item) => {
    let score = 0;
    shortages.forEach((kind) => {
      score += item.reserved[kind] ?? 0;
    });
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  });
  return best;
}

export function buildConflictDetail(
  shortages: KindAvailability[],
  occupier: TrainingSession | null,
): string {
  const names = shortages.map((item) => `${item.label}缺 ${item.shortage} 件`).join('、');
  if (occupier) {
    return `${names}。器材被「${occupier.name}」（${occupier.coach} 教练）在同一时段占用，请调整时间或待备料。`;
  }
  return `${names}。请调整时间或待备料。`;
}

// 派生分析缓存键：场次时间、场地尺寸、马匹步幅、障碍布局任一变化都会改变哈希
export function sessionInputHash(session: TrainingSession): string {
  const course = session.course;
  const obstacleSignature = course.obstacles
    .map((item) => `${item.id}:${item.kind}:${item.x.toFixed(1)},${item.y.toFixed(1)}`)
    .join('|');
  return [
    session.date,
    session.startTime,
    session.endTime,
    course.arena.width,
    course.arena.length,
    course.horse.stepLength,
    course.horse.approach,
    course.horse.landing,
    obstacleSignature,
    course.sequence.join(','),
  ].join('#');
}

// 读取场次的安全分析：缓存有效则沿用，否则失效重算
export function getSessionAnalysis(session: TrainingSession): RouteAnalysis {
  const hash = sessionInputHash(session);
  if (session.analysis && session.analysisHash === hash) {
    return session.analysis;
  }
  return analyzeCourse(session.course);
}

export function createSessionId(): string {
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function todayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function scheduleSnapshot(state: ScheduleState): ScheduleState {
  return structuredClone(state);
}
