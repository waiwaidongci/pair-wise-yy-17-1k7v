import { create } from 'zustand';
import { ScheduleEngine } from '../scheduling/engine';
import { createSeedState } from '../scheduling/seed';
import type {
  AvailabilityReport,
  AvailabilityRequest,
  CoachDraft,
  FaultHooks,
  JudgeArtifact,
  ResourceKey,
  RouteDef,
  SafetyArtifact,
  ScheduleState,
  SubmitResult,
} from '../scheduling/types';
import type { Course, RouteAnalysis } from '../types/course';

const STORAGE_KEY = 'strideplan:schedule';
const REV_KEY = 'strideplan:route-rev';

function loadState(): ScheduleState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ScheduleState;
      if (parsed && Array.isArray(parsed.sessions)) {
        return { ...createSeedState(), ...parsed };
      }
    }
  } catch {
    /* 损坏时落到种子数据 */
  }
  return createSeedState();
}

function persistState(state: ScheduleState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

type RevMap = Record<string, number>;
function loadRevs(): RevMap {
  try {
    return JSON.parse(localStorage.getItem(REV_KEY) ?? '{}') as RevMap;
  } catch {
    return {};
  }
}

/** 路线几何指纹：场地、步幅、顺序、每个障碍的类型/坐标/转角 */
function geometryFingerprint(course: Course): string {
  return JSON.stringify([
    course.arena.width,
    course.arena.length,
    course.horse.stepLength,
    course.sequence,
    course.obstacles.map((o) => [
      o.id,
      o.kind,
      Math.round(o.x * 10) / 10,
      Math.round(o.y * 10) / 10,
      o.rotation,
    ]),
  ]);
}

const engine = new ScheduleEngine(loadState());
engine.setPersist(persistState);

/**
 * 订阅引擎状态版本：引擎状态不在 React 树里，组件用
 *   const version = useScheduleVersion();
 *   const state = useScheduleStore.getState().snapshot();
 * 的方式读取，任何事务提交后 version 递增触发重渲染。
 */
export function useScheduleVersion(): number {
  return useScheduleStore((state) => state.version);
}

export type BatchSaveResult = {
  ok: boolean;
  results: SubmitResult[];
  shortage?: import('../scheduling/types').ShortageReport;
  error?: string;
};

interface ScheduleStore {
  version: number;
  lastResult: SubmitResult | null;
  notice: string | null;
  bump: () => void;
  setNotice: (notice: string | null) => void;
  setFaults: (faults: FaultHooks) => void;
  resetDemo: () => void;

  engine: () => ScheduleEngine;
  snapshot: () => ScheduleState;
  availability: (request: AvailabilityRequest) => AvailabilityReport;

  saveDraft: (input: Omit<CoachDraft, 'id' | 'updatedAt'> & { id?: string }) => Promise<CoachDraft>;
  removeDraft: (id: string) => Promise<void>;
  submitDraft: (draftId: string, submissionId?: string) => Promise<SubmitResult>;
  reviseSession: (
    sessionId: string,
    patch: Parameters<ScheduleEngine['reviseSession']>[1],
  ) => Promise<SubmitResult>;
  copySession: (
    sourceId: string,
    target: { title: string; coach: string; start: number; end: number },
  ) => Promise<SubmitResult>;
  saveMany: (
    specs: Array<{ title: string; coach: string; start: number; end: number; routeId: string }>,
  ) => Promise<BatchSaveResult>;
  cancelSession: (sessionId: string) => Promise<void>;
  setEquipmentCount: (kind: ResourceKey, count: number) => Promise<void>;
  upsertRoute: (input: {
    id?: string;
    name: string;
    obstacleKinds: RouteDef['obstacleKinds'];
    course?: unknown;
  }) => Promise<RouteDef>;
  removeRoute: (id: string) => Promise<void>;
  syncDesignerRoute: (course: Course) => Promise<RouteDef>;
  getSafety: (sessionId: string) => { artifact: SafetyArtifact; analysis: RouteAnalysis } | undefined;
  getJudge: (sessionId: string) => JudgeArtifact | undefined;
  isSafetyStale: (sessionId: string) => boolean;
  isJudgeStale: (sessionId: string) => boolean;
}

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  version: 0,
  lastResult: null,
  notice: null,

  bump: () => set((state) => ({ version: state.version + 1 })),
  setNotice: (notice) => set({ notice }),
  setFaults: (faults) => engine.setFaults(faults),

  resetDemo: () => {
    const seed = createSeedState();
    engine.replaceState(seed);
    localStorage.removeItem(REV_KEY);
    set({ version: get().version + 1, lastResult: null, notice: '演示数据已重置' });
  },

  engine: () => engine,
  snapshot: () => engine.getState(),
  availability: (request) => engine.checkAvailability(request),

  saveDraft: async (input) => {
    const draft = await engine.saveDraft(input);
    get().bump();
    return draft;
  },
  removeDraft: async (id) => {
    await engine.removeDraft(id);
    get().bump();
  },
  submitDraft: async (draftId, submissionId) => {
    const result = await engine.submitDraft(draftId, submissionId);
    set({ lastResult: result });
    get().bump();
    return result;
  },
  reviseSession: async (sessionId, patch) => {
    const result = await engine.reviseSession(sessionId, patch);
    set({ lastResult: result });
    get().bump();
    return result;
  },
  copySession: async (sourceId, target) => {
    const result = await engine.copySession(sourceId, target);
    set({ lastResult: result });
    get().bump();
    return result;
  },
  saveMany: async (specs) => {
    const result = await engine.saveMany(specs);
    get().bump();
    return result;
  },
  cancelSession: async (sessionId) => {
    await engine.cancelSession(sessionId);
    get().bump();
  },
  setEquipmentCount: async (kind, count) => {
    await engine.setEquipmentCount(kind, count);
    get().bump();
  },
  upsertRoute: async (input) => {
    const route = await engine.upsertRoute(input);
    get().bump();
    return route;
  },
  removeRoute: async (id) => {
    await engine.removeRoute(id);
    get().bump();
  },

  /**
   * 把设计器路线同步进排场路线库。
   * 几何指纹未变就不递增 rev（名字/元数据更新不影响安全分析），
   * 只有场地、步幅、障碍几何变化才让关联场次的分析与裁判表失效。
   */
  syncDesignerRoute: async (course) => {
    const id = `route:${course.id}`;
    const fpKey = `${REV_KEY}:fp:${course.id}`;
    const fingerprint = geometryFingerprint(course);
    const previousFingerprint = localStorage.getItem(fpKey);
    const existing = engine.getState().routeCatalog.find((route) => route.id === id);
    const geometryChanged = previousFingerprint !== null && previousFingerprint !== fingerprint;

    const route = await engine.upsertRoute({
      id,
      name: course.name,
      obstacleKinds: course.sequence.map(
        (seqId) => course.obstacles.find((o) => o.id === seqId)!.kind,
      ),
      course,
      // 首次入库：rev 固定为 1（upsertRoute 新建时不递增）；之后仅几何变化才递增
      bumpRev: existing ? geometryChanged : false,
    });
    localStorage.setItem(fpKey, fingerprint);
    get().bump();
    return route;
  },

  getSafety: (sessionId) => engine.getSafetyAnalysis(sessionId),
  getJudge: (sessionId) => engine.getJudgeSheet(sessionId),
  isSafetyStale: (sessionId) => engine.isSafetyStale(sessionId),
  isJudgeStale: (sessionId) => engine.isJudgeStale(sessionId),
}));

/**
 * 跨标签页同步：开两个标签页即可模拟“两名教练各一台设备”。
 * storage 事件只在其他标签页触发；A 页提交后 B 页引擎替换为最新整块状态，
 * B 页里排队的提交仍走自己的串行队列，先交先得由提交到达顺序决定。
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const next = JSON.parse(event.newValue) as ScheduleState;
      if (next && Array.isArray(next.sessions)) {
        engine.replaceState(next);
        useScheduleStore.setState((state) => ({ version: state.version + 1 }));
      }
    } catch {
      /* 忽略不完整/损坏的写入 */
    }
  });
}
