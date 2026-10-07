import { createInitialCourse } from '../utils/course';
import type { Course } from '../types/course';
import { ARENA, createEmptyState, needFromKinds, OBSTACLE_KINDS, RESOURCE_LABELS } from './engine';
import type {
  EquipmentItem,
  LedgerEntry,
  ResourceKey,
  RouteDef,
  ScheduleState,
  TrainingSession,
} from './types';

/** 从设计器的完整 Course 抽取排场用路线定义 */
export function routeFromCourse(course: Course, rev = 1): RouteDef {
  const byId = new Map(course.obstacles.map((o) => [o.id, o]));
  const kinds = course.sequence
    .map((id) => byId.get(id)?.kind)
    .filter(Boolean) as RouteDef['obstacleKinds'];
  return {
    id: `route:${course.id}`,
    name: course.name,
    obstacleKinds: kinds,
    need: needFromKinds(kinds),
    course,
    rev,
    updatedAt: course.updatedAt,
  };
}

export function defaultEquipment(): EquipmentItem[] {
  const counts: Partial<Record<ResourceKey, number>> = {
    [ARENA]: 1,
    vertical: 4,
    oxer: 3,
    triple: 2,
    wall: 2,
    water: 1,
    combination: 1,
  };
  return [ARENA, ...OBSTACLE_KINDS].map((kind) => ({
    kind,
    label: RESOURCE_LABELS[kind],
    count: counts[kind] ?? 0,
  }));
}

/** 固定演示日期：2026-10-08（本地时间）的整点 */
export function seedTime(hour: number, minute = 0): number {
  return new Date(2026, 9, 8, hour, minute).getTime();
}

export function createSeedState(): ScheduleState {
  const state = createEmptyState();
  state.equipment = defaultEquipment();

  const courseA = createInitialCourse();
  courseA.name = '周五进阶训练路线';
  const routeA = routeFromCourse(courseA, 1);
  routeA.id = 'route:seed-a';
  state.routeCatalog.push(routeA);

  const courseB = structuredClone(courseA);
  courseB.id = 'course-seed-b';
  courseB.name = '新人直线热身路线';
  courseB.sequence = courseB.sequence.slice(0, 3);
  const routeB = routeFromCourse(courseB, 1);
  routeB.id = 'route:seed-b';
  state.routeCatalog.push(routeB);

  const now = Date.now();
  const sessions: TrainingSession[] = [
    {
      id: 'sess:seed-1',
      title: '进阶班场地课',
      coach: '王教练',
      start: seedTime(9),
      end: seedTime(10, 30),
      routeId: routeA.id,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sess:seed-2',
      title: '新人热身',
      coach: '李教练',
      start: seedTime(10, 30),
      end: seedTime(12),
      routeId: routeB.id,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    },
  ];
  state.sessions = sessions;

  // 直接构造已确认场次的预占账本
  const holds: LedgerEntry[] = [];
  for (const session of sessions) {
    const route = state.routeCatalog.find((r) => r.id === session.routeId)!;
    const need = needFromKinds(route.obstacleKinds);
    for (const [resource, qty] of Object.entries(need) as Array<[ResourceKey, number]>) {
      for (let index = 0; index < qty; index += 1) {
        holds.push({
          id: `led:seed-${session.id}-${resource}-${index}`,
          submissionId: `sub:seed-${session.id}`,
          sessionId: session.id,
          resource,
          qty: 1,
          action: 'hold',
          at: now,
        });
      }
    }
  }
  state.ledger = holds;

  return state;
}
