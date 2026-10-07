import { create } from 'zustand';
import type { Course } from '../types/course';
import type {
  EquipmentKind,
  ScheduleState,
  SubmitResult,
  TrainingSession,
} from '../types/schedule';
import {
  availabilityForSession,
  buildConflictDetail,
  cloneEquipment,
  createSessionId,
  DEFAULT_EQUIPMENT_STOCK,
  equipmentFromCourse,
  findOccupier,
  getSessionAnalysis,
  scheduleSnapshot,
  sessionInputHash,
  todayString,
  zeroEquipment,
} from '../utils/schedule';
import { createInitialCourse } from '../utils/course';

const SCHEDULE_KEY = 'strideplan:schedule';

function readScheduleFromStorage(): ScheduleState {
  try {
    const raw = localStorage.getItem(SCHEDULE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ScheduleState;
      if (parsed && Array.isArray(parsed.sessions) && parsed.equipment) {
        return parsed;
      }
    }
  } catch {
    // fall through to seed
  }
  return seedSchedule();
}

function persistSchedule(state: ScheduleState) {
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(state));
}

function seedSchedule(): ScheduleState {
  const equipment = { ...DEFAULT_EQUIPMENT_STOCK };
  const today = todayString();

  const challengeCourse = createInitialCourse();
  challengeCourse.name = '周日挑战竞技路线';
  // 挑战路线含 2 道双横木、1 道三重横木、1 道连续组合
  challengeCourse.obstacles = challengeCourse.obstacles.map((obstacle, index) => {
    if (index === 1) return { ...obstacle, kind: 'oxer' as const };
    if (index === 2) return { ...obstacle, kind: 'triple' as const };
    if (index === 4) return { ...obstacle, kind: 'combination' as const };
    return obstacle;
  });
  challengeCourse.sequence = challengeCourse.obstacles.map((item) => item.id);

  const beginnerCourse = createInitialCourse();
  beginnerCourse.name = '周六入门热身路线';
  beginnerCourse.obstacles = beginnerCourse.obstacles.map((obstacle) => ({
    ...obstacle,
    kind: 'vertical' as const,
  }));
  beginnerCourse.sequence = beginnerCourse.obstacles.map((item) => item.id);

  const makeSession = (
    partial: Partial<TrainingSession> & Pick<TrainingSession, 'name' | 'coach' | 'startTime' | 'endTime' | 'course'>,
  ): TrainingSession => {
    const status = partial.status ?? 'draft';
    const course = partial.course;
    return {
      id: createSessionId(),
      routeId: null,
      routeName: course.name,
      date: today,
      status,
      reserved: status === 'scheduled' ? cloneEquipment(equipmentFromCourse(course)) : {},
      conflictSessionId: null,
      conflictDetail: null,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      submittedAt: status === 'scheduled' ? Date.now() : null,
      version: status === 'scheduled' ? 1 : 0,
      analysis: null,
      analysisHash: null,
      ...partial,
    };
  };

  const sessions: TrainingSession[] = [
    // 上午两场已排定，各占用 1 件连续组合（库存仅 2 件）
    makeSession({
      name: '上午障碍专项 A',
      coach: '王教练',
      startTime: '10:00',
      endTime: '11:30',
      course: challengeCourse,
      status: 'scheduled',
    }),
    makeSession({
      name: '上午障碍专项 B',
      coach: '李教练',
      startTime: '10:00',
      endTime: '11:30',
      course: challengeCourse,
      status: 'scheduled',
    }),
    // 第三场同时段，器材不足，停在待备料
    makeSession({
      name: '上午障碍加练 C',
      coach: '赵教练',
      startTime: '10:30',
      endTime: '11:30',
      course: challengeCourse,
      status: 'pending',
      conflictSessionId: null,
      conflictDetail: null,
    }),
    // 下午一场已排定（不同时段，无冲突）
    makeSession({
      name: '下午入门热身',
      coach: '王教练',
      startTime: '14:00',
      endTime: '15:30',
      course: beginnerCourse,
      status: 'scheduled',
    }),
    // 草稿：尚未提交
    makeSession({
      name: '晚间自由练习',
      coach: '李教练',
      startTime: '18:00',
      endTime: '19:00',
      course: beginnerCourse,
      status: 'draft',
    }),
  ];

  // 补全待备料场次的占用提示
  const pending = sessions.find((item) => item.status === 'pending');
  if (pending) {
    const availability = availabilityForSession(pending, sessions, equipment);
    const shortages = availability.filter((item) => item.shortage > 0);
    const occupier = findOccupier(pending, sessions, shortages.map((item) => item.kind));
    pending.conflictSessionId = occupier?.id ?? null;
    pending.conflictDetail = buildConflictDetail(shortages, occupier);
  }

  return { sessions, equipment, revision: 1 };
}

interface ScheduleStore extends ScheduleState {
  hydrate: () => void;
  createSession: (partial?: Partial<TrainingSession>) => string;
  updateSession: (id: string, patch: Partial<TrainingSession>) => void;
  deleteSession: (id: string) => void;
  duplicateSession: (id: string) => string;
  submitSession: (id: string, simulateFailure?: boolean) => SubmitResult;
  releaseSession: (id: string, simulateFailure?: boolean) => SubmitResult;
  setEquipmentStock: (kind: EquipmentKind, total: number) => void;
  ensureAnalysis: (id: string) => void;
}

export const useScheduleStore = create<ScheduleStore>((set, get) => {
  const commit = (next: ScheduleState) => {
    persistSchedule(next);
    set({ ...next });
  };

  // 跨标签页同步：另一标签页提交后，本标签页以持久层为准
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== SCHEDULE_KEY) return;
      try {
        const next = event.newValue ? (JSON.parse(event.newValue) as ScheduleState) : null;
        if (next && Array.isArray(next.sessions)) {
          set({ sessions: next.sessions, equipment: next.equipment, revision: next.revision });
        }
      } catch {
        // ignore malformed payload
      }
    });
  }

  return {
    sessions: [],
    equipment: { ...DEFAULT_EQUIPMENT_STOCK },
    revision: 0,

    hydrate: () => {
      const current = get();
      if (current.sessions.length > 0) return;
      commit(readScheduleFromStorage());
    },

    createSession: (partial) => {
      const id = createSessionId();
      const now = Date.now();
      const course = partial?.course ?? createInitialCourse();
      const session: TrainingSession = {
        id,
        name: partial?.name ?? '新训练场次',
        coach: partial?.coach ?? '',
        date: partial?.date ?? todayString(),
        startTime: partial?.startTime ?? '16:00',
        endTime: partial?.endTime ?? '17:00',
        routeId: partial?.routeId ?? null,
        routeName: partial?.routeName ?? course.name,
        course,
        status: 'draft',
        reserved: {},
        conflictSessionId: null,
        conflictDetail: null,
        note: partial?.note ?? '',
        createdAt: now,
        updatedAt: now,
        submittedAt: null,
        version: 0,
        analysis: null,
        analysisHash: null,
      };
      const next: ScheduleState = {
        sessions: [...get().sessions, session],
        equipment: get().equipment,
        revision: get().revision + 1,
      };
      commit(next);
      return id;
    },

    updateSession: (id, patch) => {
      const now = Date.now();
      const sessions = get().sessions.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch, updatedAt: now };
        // 路线 / 时间 / 场地 / 马匹改动后，旧分析失效，待下次读取重算
        if (patch.course || patch.date || patch.startTime || patch.endTime) {
          next.analysisHash = null;
        }
        return next;
      });
      commit({ sessions, equipment: get().equipment, revision: get().revision + 1 });
    },

    deleteSession: (id) => {
      const sessions = get().sessions.filter((item) => item.id !== id);
      commit({ sessions, equipment: get().equipment, revision: get().revision + 1 });
    },

    duplicateSession: (id) => {
      const source = get().sessions.find((item) => item.id === id);
      if (!source) return '';
      const copy: TrainingSession = scheduleSnapshot({ sessions: [source], equipment: get().equipment, revision: 0 }).sessions[0];
      const newId = createSessionId();
      copy.id = newId;
      copy.name = `${source.name} 副本`;
      copy.status = 'draft';
      copy.reserved = {};
      copy.conflictSessionId = null;
      copy.conflictDetail = null;
      copy.submittedAt = null;
      copy.version = 0;
      copy.analysis = null;
      copy.analysisHash = null;
      copy.createdAt = Date.now();
      copy.updatedAt = Date.now();
      commit({ sessions: [...get().sessions, copy], equipment: get().equipment, revision: get().revision + 1 });
      return newId;
    },

    submitSession: (id, simulateFailure = false) => {
      const snapshot = scheduleSnapshot({ sessions: get().sessions, equipment: get().equipment, revision: get().revision });
      try {
        // 以持久层最新状态为准（并发：先交的占用，后交的看到占用）
        const live = readScheduleFromStorage();
        const target = live.sessions.find((item) => item.id === id);
        if (!target) throw new Error('场次不存在或已被删除');

        const required = equipmentFromCourse(target.course);
        const availability = availabilityForSession(target, live.sessions, live.equipment);
        const shortages = availability.filter((item) => item.shortage > 0);

        if (shortages.length > 0) {
          // 器材不足：停在待备料，保留草稿并指出占用方
          const occupier = findOccupier(target, live.sessions, shortages.map((item) => item.kind));
          const updated: TrainingSession = {
            ...target,
            status: 'pending',
            conflictSessionId: occupier?.id ?? null,
            conflictDetail: buildConflictDetail(shortages, occupier),
            version: target.version + 1,
            updatedAt: Date.now(),
          };
          const sessions = live.sessions.map((item) => (item.id === id ? updated : item));
          const next: ScheduleState = { sessions, equipment: live.equipment, revision: live.revision + 1 };
          commit(next);
          return { ok: false, reason: 'conflict', session: updated };
        }

        // 预占器材：写入绝对值（幂等），重试不会重复扣减
        const updated: TrainingSession = {
          ...target,
          status: 'scheduled',
          reserved: cloneEquipment(required),
          conflictSessionId: null,
          conflictDetail: null,
          submittedAt: Date.now(),
          version: target.version + 1,
          updatedAt: Date.now(),
        };
        const sessions = live.sessions.map((item) => (item.id === id ? updated : item));
        const next: ScheduleState = { sessions, equipment: live.equipment, revision: live.revision + 1 };

        if (simulateFailure) {
          throw new Error('模拟保存失败：器材归还 / 场次保存中断');
        }

        commit(next);
        return { ok: true, session: updated };
      } catch (error) {
        // 回滚到提交前：整场占用回到提交前状态
        commit(snapshot);
        return {
          ok: false,
          reason: 'error',
          error: error instanceof Error ? error.message : '提交失败，已回滚',
        };
      }
    },

    releaseSession: (id, simulateFailure = false) => {
      const snapshot = scheduleSnapshot({ sessions: get().sessions, equipment: get().equipment, revision: get().revision });
      try {
        const live = readScheduleFromStorage();
        const target = live.sessions.find((item) => item.id === id);
        if (!target) throw new Error('场次不存在或已被删除');

        // 归还器材：清空预占，回到草稿
        const updated: TrainingSession = {
          ...target,
          status: 'draft',
          reserved: {},
          conflictSessionId: null,
          conflictDetail: null,
          submittedAt: null,
          version: target.version + 1,
          updatedAt: Date.now(),
        };
        const sessions = live.sessions.map((item) => (item.id === id ? updated : item));
        const next: ScheduleState = { sessions, equipment: live.equipment, revision: live.revision + 1 };

        if (simulateFailure) {
          throw new Error('模拟归还失败：器材归还中断');
        }

        commit(next);
        return { ok: true, session: updated };
      } catch (error) {
        // 回滚到归还前
        commit(snapshot);
        return {
          ok: false,
          reason: 'error',
          error: error instanceof Error ? error.message : '归还失败，已回滚',
        };
      }
    },

    setEquipmentStock: (kind, total) => {
      const equipment = { ...get().equipment, [kind]: Math.max(0, Math.round(total) || 0) };
      commit({ sessions: get().sessions, equipment, revision: get().revision + 1 });
    },

    ensureAnalysis: (id) => {
      const session = get().sessions.find((item) => item.id === id);
      if (!session) return;
      const hash = sessionInputHash(session);
      if (session.analysis && session.analysisHash === hash) return; // 缓存有效
      const analysis = getSessionAnalysis(session);
      const sessions = get().sessions.map((item) =>
        item.id === id ? { ...item, analysis, analysisHash: hash, updatedAt: Date.now() } : item,
      );
      commit({ sessions, equipment: get().equipment, revision: get().revision + 1 });
    },
  };
});

export { zeroEquipment };
