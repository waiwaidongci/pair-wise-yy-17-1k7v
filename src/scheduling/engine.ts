import type {
  AvailabilityReport,
  AvailabilityRequest,
  CoachDraft,
  EquipmentItem,
  FaultHooks,
  JudgeArtifact,
  LedgerEntry,
  ObstacleKind,
  ResourceKey,
  ResourceNeed,
  ResourceShortage,
  RouteDef,
  SafetyArtifact,
  ScheduleState,
  SessionStatus,
  ShortageReport,
  SubmitResult,
  TrainingSession,
} from './types';
import { analyzeCourse } from '../utils/course';
import type { Course, RouteAnalysis } from '../types/course';

export const ARENA: ResourceKey = 'arena';

export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  arena: '场地',
  vertical: '单横木',
  oxer: '双横木',
  triple: '三重横木',
  wall: '砖墙',
  water: '水障',
  combination: '连续组合',
};

export const OBSTACLE_KINDS: ObstacleKind[] = [
  'vertical',
  'oxer',
  'triple',
  'wall',
  'water',
  'combination',
];

let idCounter = 0;
export function engineId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 两段时间是否重叠（半开区间：相接不冲突，如 10:00-11:00 与 11:00-12:00） */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** 按障碍类型与数量汇总需求，场地恒为 1 */
export function needFromKinds(kinds: ObstacleKind[]): ResourceNeed {
  const need: ResourceNeed = { [ARENA]: 1 };
  for (const kind of kinds) {
    need[kind] = (need[kind] ?? 0) + 1;
  }
  return need;
}

export function routeNeed(route: RouteDef): ResourceNeed {
  if (route.need) return { [ARENA]: 1, ...route.need };
  return needFromKinds(route.obstacleKinds);
}

export function createEmptyState(): ScheduleState {
  return {
    version: 1,
    equipment: [],
    routeCatalog: [],
    sessions: [],
    drafts: [],
    ledger: [],
    outcomes: [],
    safety: [],
    judges: [],
    revision: 0,
  };
}

export interface ReserveSpec {
  sessionId: string;
  start: number;
  end: number;
  routeId: string;
  excludeSessionId?: string;
}

interface ActiveHold {
  entryId: string;
  sessionId: string;
  resource: ResourceKey;
  qty: number;
}

/**
 * 排场事务引擎。
 *
 * - 所有写操作经 enqueue 串行化：两名教练同时提交时，先进入队列的事务先占。
 * - 资源占用是 append-only 账本（hold / release），“持有量”由未配对的 hold 推导，
 *   因此重试不会重复扣减。
 * - 每次变更在状态克隆上进行，persist 抛错或归还失败时丢弃克隆，状态回到提交前。
 */
export class ScheduleEngine {
  private state: ScheduleState;
  private queue: Promise<unknown> = Promise.resolve();
  private persistImpl: (state: ScheduleState) => void = () => {};
  faultHooks: Required<FaultHooks> = { failEquipmentReturn: false, failPersist: false };

  constructor(initial?: ScheduleState) {
    this.state = initial ?? createEmptyState();
  }

  setPersist(fn: (state: ScheduleState) => void) {
    this.persistImpl = fn;
  }

  setFaults(faults: FaultHooks) {
    this.faultHooks = {
      failEquipmentReturn: faults.failEquipmentReturn ?? false,
      failPersist: faults.failPersist ?? false,
    };
  }

  getState(): ScheduleState {
    return this.state;
  }

  /** 用整块状态替换当前状态（演示重置 / 测试用） */
  replaceState(next: ScheduleState) {
    this.state = next;
    this.persistImpl(next);
  }

  /** 串行执行，保证先交先得 */
  protected enqueue<T>(task: () => T): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  // ---------- 读取 ----------

  getRoute(routeId: string): RouteDef | undefined {
    return this.state.routeCatalog.find((route) => route.id === routeId);
  }

  getSession(sessionId: string): TrainingSession | undefined {
    return this.state.sessions.find((session) => session.id === sessionId);
  }

  getOutcome(submissionId: string): SubmitResult | undefined {
    const found = this.state.outcomes.find((item) => item.submissionId === submissionId);
    if (!found) return undefined;
    return {
      ok: found.status === 'confirmed',
      status: found.status,
      sessionId: found.sessionId,
      shortage: found.shortage,
      draftId: found.blockedDraftId,
      error: found.error,
    };
  }

  private activeHolds(s: ScheduleState): ActiveHold[] {
    const released = new Set<string>();
    for (const entry of s.ledger) {
      if (entry.action === 'release' && entry.pairedEntryId) released.add(entry.pairedEntryId);
    }
    return s.ledger
      .filter((entry) => entry.action === 'hold' && !released.has(entry.id))
      .map((entry) => ({
        entryId: entry.id,
        sessionId: entry.sessionId,
        resource: entry.resource,
        qty: entry.qty,
      }));
  }

  /** 查某时段各资源余量，被哪些场次占用 */
  checkAvailability(request: AvailabilityRequest): AvailabilityReport {
    return this.computeAvailability(this.state, request);
  }

  private computeAvailability(s: ScheduleState, request: AvailabilityRequest): AvailabilityReport {
    const route = s.routeCatalog.find((item) => item.id === request.routeId);
    const need: ResourceNeed = route ? routeNeed(route) : { [ARENA]: 1 };

    const holders = this.activeHolds(s).filter((hold) => {
      if (hold.sessionId === request.excludeSessionId) return false;
      const session = s.sessions.find((item) => item.id === hold.sessionId);
      return session && overlaps(request.start, request.end, session.start, session.end);
    });

    const capacityOf = (resource: ResourceKey): number => {
      if (resource === ARENA) return 1;
      return s.equipment.find((item) => item.kind === resource)?.count ?? 0;
    };

    const resources = Object.keys(need) as ResourceKey[];
    const perResource: AvailabilityReport['perResource'] = [];
    const shortages: ResourceShortage[] = [];

    for (const resource of resources) {
      const required = need[resource] ?? 0;
      const used = holders
        .filter((hold) => hold.resource === resource)
        .reduce((sum, hold) => sum + hold.qty, 0);
      const capacity = capacityOf(resource);
      perResource.push({
        resource,
        label: RESOURCE_LABELS[resource],
        required,
        capacity,
        used,
        remaining: capacity - used,
      });
      if (required > capacity - used) {
        shortages.push({
          resource,
          label: RESOURCE_LABELS[resource],
          required,
          available: capacity - used,
          holders: holders
            .filter((hold) => hold.resource === resource)
            .map((hold) => {
              const session = s.sessions.find((item) => item.id === hold.sessionId)!;
              return {
                sessionId: hold.sessionId,
                title: session.title,
                coach: session.coach,
                qty: hold.qty,
              };
            }),
        });
      }
    }

    return { ok: shortages.length === 0, start: request.start, end: request.end, perResource, shortages };
  }

  // ---------- 器材清单 ----------

  setEquipmentCount(kind: ResourceKey, count: number): Promise<void> {
    return this.enqueue(() => {
      this.mutate((draft) => {
        const existing = draft.equipment.find((item) => item.kind === kind);
        const safeCount = Math.max(0, Math.round(count));
        if (existing) existing.count = safeCount;
        else draft.equipment.push({ kind, label: RESOURCE_LABELS[kind], count: safeCount });
      });
    });
  }

  // ---------- 路线库 ----------

  upsertRoute(input: {
    id?: string;
    name: string;
    obstacleKinds: ObstacleKind[];
    course?: unknown;
    bumpRev?: boolean;
  }): Promise<RouteDef> {
    return this.enqueue(() => {
      let result: RouteDef | undefined;
      this.mutate((draft) => {
        const existing = input.id
          ? draft.routeCatalog.find((route) => route.id === input.id)
          : undefined;
        if (existing) {
          existing.name = input.name;
          existing.obstacleKinds = input.obstacleKinds;
          existing.need = needFromKinds(input.obstacleKinds);
          if (input.course !== undefined) existing.course = input.course;
          if (input.bumpRev !== false) existing.rev += 1;
          existing.updatedAt = Date.now();
          result = existing;
        } else {
          const route: RouteDef = {
            id: input.id ?? engineId('route'),
            name: input.name,
            obstacleKinds: input.obstacleKinds,
            need: needFromKinds(input.obstacleKinds),
            course: input.course,
            rev: 1,
            updatedAt: Date.now(),
          };
          draft.routeCatalog.push(route);
          result = route;
        }
      });
      return result!;
    });
  }

  removeRoute(routeId: string): Promise<void> {
    return this.enqueue(() => {
      this.mutate((draft) => {
        draft.routeCatalog = draft.routeCatalog.filter((route) => route.id !== routeId);
      });
    });
  }

  // ---------- 草稿 ----------

  saveDraft(input: Omit<CoachDraft, 'id' | 'updatedAt'> & { id?: string }): Promise<CoachDraft> {
    return this.enqueue(() => {
      let result: CoachDraft | undefined;
      this.mutate((draft) => {
        const existing = input.id
          ? draft.drafts.find((item) => item.id === input.id)
          : undefined;
        if (existing) {
          const { id: _id, ...patch } = input;
          Object.assign(existing, patch, { updatedAt: Date.now() });
          result = existing;
        } else {
          const created: CoachDraft = { ...input, id: engineId('draft'), updatedAt: Date.now() };
          draft.drafts.push(created);
          result = created;
        }
      });
      return result!;
    });
  }

  removeDraft(draftId: string): Promise<void> {
    return this.enqueue(() => {
      this.mutate((draft) => {
        draft.drafts = draft.drafts.filter((item) => item.id !== draftId);
      });
    });
  }

  /**
   * 提交草稿。
   * - 余量够：confirmed，按类型与数量预占器材与场地。
   * - 余量不够：场次落为 pending_materials，并指出被哪些场次占用；草稿保留。
   * - 归还失败 / 保存失败：整场回滚到提交前。
   * - 同一 submissionId 重试：直接返回首次结果，不再扣减。
   */
  submitDraft(draftId: string, submissionId = engineId('sub')): Promise<SubmitResult> {
    return this.enqueue(() => {
      const cached = this.lookupOutcome(submissionId);
      if (cached) return cached;

      const draft = this.state.drafts.find((item) => item.id === draftId);
      if (!draft) {
        return this.recordOutcome(submissionId, {
          ok: false,
          status: 'rejected',
          sessionId: '',
          error: '草稿不存在',
        });
      }

      let sessionId = '';
      try {
        const result = this.transaction((draft2) => {
          const now = Date.now();
          const existingSession = draft2.sessions.find(
            (item) => item.coach === draft.coach && item.title === draft.title,
          );
          const session: TrainingSession = existingSession ?? {
            id: engineId('sess'),
            title: draft.title,
            coach: draft.coach,
            start: draft.start,
            end: draft.end,
            routeId: draft.routeId,
            arenaOverride: draft.arenaOverride,
            strideOverride: draft.strideOverride,
            status: 'pending_materials',
            createdAt: now,
            updatedAt: now,
          };
          session.start = draft.start;
          session.end = draft.end;
          session.routeId = draft.routeId;
          session.arenaOverride = draft.arenaOverride;
          session.strideOverride = draft.strideOverride;
          session.updatedAt = now;
          delete session.blockedReason;
          delete session.blockedBy;
          if (!existingSession) draft2.sessions.push(session);
          sessionId = session.id;

          const report = this.computeAvailability(draft2, {
            start: session.start,
            end: session.end,
            routeId: session.routeId,
            excludeSessionId: session.id,
          });

          if (!report.ok) {
            // 不够：停在待备料，不写任何 hold
            session.status = 'pending_materials';
            session.blockedReason = this.describeShortage(report.shortages);
            session.blockedBy = { shortages: report.shortages };
            return {
              ok: false,
              status: 'pending_materials' as SessionStatus,
              sessionId: session.id,
              shortage: { shortages: report.shortages },
              draftId,
            };
          }

          // 余量够：预占
          this.writeHolds(draft2, session.id, submissionId);
          session.status = 'confirmed';
          this.invalidateSessionArtifacts(draft2, session.id);
          return {
            ok: true,
            status: 'confirmed' as SessionStatus,
            sessionId: session.id,
          };
        });
        return this.recordOutcome(submissionId, result);
      } catch (error) {
        return this.recordOutcome(submissionId, {
          ok: false,
          status: 'rolled_back',
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /** 改时间 / 换场地 / 换路线：先查同时段余量，不够则停在待备料；任何失败整体回滚 */
  reviseSession(
    sessionId: string,
    patch: {
      start?: number;
      end?: number;
      routeId?: string;
      arenaOverride?: { width: number; length: number };
      strideOverride?: number;
    },
    submissionId = engineId('sub'),
  ): Promise<SubmitResult> {
    return this.enqueue(() => {
      const cached = this.lookupOutcome(submissionId);
      if (cached) return cached;
      try {
        const result = this.transaction((draft) => {
          const session = draft.sessions.find((item) => item.id === sessionId);
          if (!session) throw new Error('场次不存在');

          const next = {
            start: patch.start ?? session.start,
            end: patch.end ?? session.end,
            routeId: patch.routeId ?? session.routeId,
            arenaOverride: patch.arenaOverride !== undefined ? patch.arenaOverride : session.arenaOverride,
            strideOverride: patch.strideOverride !== undefined ? patch.strideOverride : session.strideOverride,
          };
          if (next.end <= next.start) throw new Error('结束时间必须晚于开始时间');

          // 只要本次修订触及时间 / 路线 / 场地 / 步幅，关联产物就要失效
          const inputsChanged =
            patch.start !== undefined ||
            patch.end !== undefined ||
            patch.routeId !== undefined ||
            patch.arenaOverride !== undefined ||
            patch.strideOverride !== undefined;

          // 先释放旧预占（归还失败会抛错并整体回滚）
          this.releaseHolds(draft, session.id, submissionId);

          Object.assign(session, next, { updatedAt: Date.now() });
          delete session.blockedReason;
          delete session.blockedBy;

          const report = this.computeAvailability(draft, {
            start: session.start,
            end: session.end,
            routeId: session.routeId,
            excludeSessionId: session.id,
          });

          if (!report.ok) {
            session.status = 'pending_materials';
            session.blockedReason = this.describeShortage(report.shortages);
            session.blockedBy = { shortages: report.shortages };
            // 即使停在待备料，旧的安全分析 / 裁判表也已不匹配（如换了路线），必须失效
            if (inputsChanged) this.invalidateSessionArtifacts(draft, session.id);
            return {
              ok: false,
              status: 'pending_materials' as SessionStatus,
              sessionId: session.id,
              shortage: { shortages: report.shortages },
            };
          }

          this.writeHolds(draft, session.id, submissionId);
          session.status = 'confirmed';
          // 任何关联输入变化都让产物失效；没受影响的其他场次不动
          this.invalidateSessionArtifacts(draft, session.id);
          return { ok: true, status: 'confirmed' as SessionStatus, sessionId: session.id };
        });
        return this.recordOutcome(submissionId, result);
      } catch (error) {
        return this.recordOutcome(submissionId, {
          ok: false,
          status: 'rolled_back',
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /** 复制一场：复用其路线 / 场地 / 步幅到新时段，走同一套余量检查 */
  copySession(
    sourceSessionId: string,
    target: { title: string; coach: string; start: number; end: number },
    submissionId = engineId('sub'),
  ): Promise<SubmitResult> {
    return this.enqueue(() => {
      const cached = this.lookupOutcome(submissionId);
      if (cached) return cached;
      const source = this.state.sessions.find((item) => item.id === sourceSessionId);
      if (!source) {
        return this.recordOutcome(submissionId, {
          ok: false,
          status: 'rejected',
          sessionId: '',
          error: '源场次不存在',
        });
      }
      let sessionId = '';
      try {
        const result = this.transaction((draft) => {
          const now = Date.now();
          const session: TrainingSession = {
            id: engineId('sess'),
            title: target.title,
            coach: target.coach,
            start: target.start,
            end: target.end,
            routeId: source.routeId,
            arenaOverride: source.arenaOverride,
            strideOverride: source.strideOverride,
            status: 'pending_materials',
            createdAt: now,
            updatedAt: now,
          };
          draft.sessions.push(session);
          sessionId = session.id;

          const report = this.computeAvailability(draft, {
            start: session.start,
            end: session.end,
            routeId: session.routeId,
            excludeSessionId: session.id,
          });
          if (!report.ok) {
            session.status = 'pending_materials';
            session.blockedReason = this.describeShortage(report.shortages);
            session.blockedBy = { shortages: report.shortages };
            return {
              ok: false,
              status: 'pending_materials' as SessionStatus,
              sessionId: session.id,
              shortage: { shortages: report.shortages },
            };
          }
          this.writeHolds(draft, session.id, submissionId);
          session.status = 'confirmed';
          return { ok: true, status: 'confirmed' as SessionStatus, sessionId: session.id };
        });
        return this.recordOutcome(submissionId, result);
      } catch (error) {
        return this.recordOutcome(submissionId, {
          ok: false,
          status: 'rolled_back',
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * 批量保存多个场次：任一场保存失败或余量不足，全部回滚，不产生任何预占。
   */
  saveMany(
    specs: Array<{ title: string; coach: string; start: number; end: number; routeId: string }>,
  ): Promise<{ ok: boolean; results: SubmitResult[]; shortage?: ShortageReport; error?: string }> {
    return this.enqueue(() => {
      try {
        const created: SubmitResult[] = [];
        this.transaction((draft) => {
          for (const spec of specs) {
            if (spec.end <= spec.start) throw new Error(`「${spec.title}」结束时间必须晚于开始时间`);
            const now = Date.now();
            const session: TrainingSession = {
              id: engineId('sess'),
              title: spec.title,
              coach: spec.coach,
              start: spec.start,
              end: spec.end,
              routeId: spec.routeId,
              status: 'pending_materials',
              createdAt: now,
              updatedAt: now,
            };
            draft.sessions.push(session);
            const report = this.computeAvailability(draft, {
              start: session.start,
              end: session.end,
              routeId: session.routeId,
              excludeSessionId: session.id,
            });
            if (!report.ok) {
              // 抛错触发整批回滚
              const error = new Error('BATCH_SHORTAGE') as Error & {
                shortage?: ShortageReport;
              };
              error.shortage = { shortages: report.shortages };
              throw error;
            }
            this.writeHolds(draft, session.id, engineId('sub'));
            session.status = 'confirmed';
            created.push({ ok: true, status: 'confirmed', sessionId: session.id });
          }
        });
        return { ok: true, results: created };
      } catch (error) {
        const shortage = (error as { shortage?: ShortageReport }).shortage;
        return {
          ok: false,
          results: [],
          shortage,
          error: shortage ? undefined : error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /** 取消场次：归还占用（失败则抛错并回滚，场次与占用都保持原状） */
  cancelSession(sessionId: string): Promise<void> {
    return this.enqueue(() => {
      this.mutate((draft) => {
        this.releaseHolds(draft, sessionId, engineId('sub'));
        draft.sessions = draft.sessions.filter((item) => item.id !== sessionId);
        draft.safety = draft.safety.filter((item) => item.sessionId !== sessionId);
        draft.judges = draft.judges.filter((item) => item.sessionId !== sessionId);
      });
    });
  }

  // ---------- 事务原语 ----------

  /** 在克隆上修改；persist 失败则丢弃克隆（调用方还可在 fn 内主动抛错） */
  private mutate(fn: (draft: ScheduleState) => void): ScheduleState {
    const clone = structuredClone(this.state);
    fn(clone);
    clone.revision += 1;
    if (this.faultHooks.failPersist) {
      throw new Error('持久化保存失败：存储不可用');
    }
    this.persistImpl(clone);
    this.state = clone;
    return clone;
  }

  /** mutate 的别名语义，事务体返回结果 */
  private transaction<T>(fn: (draft: ScheduleState) => T): T {
    let result: T;
    this.mutate((draft) => {
      result = fn(draft);
    });
    return result!;
  }

  private writeHolds(draft: ScheduleState, sessionId: string, submissionId: string) {
    const session = draft.sessions.find((item) => item.id === sessionId)!;
    const route = draft.routeCatalog.find((item) => item.id === session.routeId);
    const need = route ? routeNeed(route) : { [ARENA]: 1 };
    const now = Date.now();
    for (const [resource, qty] of Object.entries(need) as Array<[ResourceKey, number]>) {
      for (let index = 0; index < qty; index += 1) {
        draft.ledger.push({
          id: engineId('led'),
          submissionId,
          sessionId,
          resource,
          qty: 1,
          action: 'hold',
          at: now,
        });
      }
    }
  }

  /** 归还某场次全部活跃预占；failEquipmentReturn 时抛错，由外层整体回滚 */
  private releaseHolds(draft: ScheduleState, sessionId: string, submissionId: string) {
    const active = this.activeHolds(draft).filter((hold) => hold.sessionId === sessionId);
    if (active.length === 0) return;
    if (this.faultHooks.failEquipmentReturn) {
      const error = new Error('器材归还失败：仓库门禁未开启') as Error & {
        entry?: LedgerEntry;
      };
      const now = Date.now();
      error.entry = {
        id: engineId('led'),
        submissionId,
        sessionId,
        resource: active[0].resource,
        qty: active[0].qty,
        action: 'release',
        pairedEntryId: active[0].entryId,
        at: now,
        failure: 'return_failed',
      };
      throw error;
    }
    const now = Date.now();
    for (const hold of active) {
      draft.ledger.push({
        id: engineId('led'),
        submissionId,
        sessionId,
        resource: hold.resource,
        qty: hold.qty,
        action: 'release',
        pairedEntryId: hold.entryId,
        at: now,
      });
    }
  }

  /**
   * 幂等结论独立落库：它不属于“资源事务”，即使业务事务因 persist 失败而回滚，
   * 这条结论也要能写进去（不受业务故障开关影响），否则同键重试无法识别。
   * 自身再失败时退回内存，不影响返回给调用方的结论。
   */
  private recordOutcome(submissionId: string, result: SubmitResult): SubmitResult {
    const clone = structuredClone(this.state);
    clone.outcomes.push({
      submissionId,
      status: result.status,
      sessionId: result.sessionId,
      shortage: result.shortage,
      blockedDraftId: result.draftId,
      error: result.error,
      at: Date.now(),
    });
    clone.revision += 1;
    this.state = clone;
    try {
      this.persistImpl(clone);
    } catch {
      /* 结论至少保留在内存，下一次成功写操作会带上它 */
    }
    return result;
  }

  private lookupOutcome(submissionId: string): SubmitResult | undefined {
    return this.getOutcome(submissionId);
  }

  private describeShortage(shortages: ResourceShortage[]): string {
    return shortages
      .map((item) => {
        const who = item.holders.map((holder) => `${holder.title}(${holder.coach})×${holder.qty}`).join('、');
        return `${item.label}需${item.required}，余量仅${item.available}，被 ${who || '其他场次'} 占用`;
      })
      .join('；');
  }

  // ---------- 安全分析 / 裁判表（按签名失效，懒重算） ----------

  private effectiveCourse(session: TrainingSession): Course | undefined {
    const route = this.state.routeCatalog.find((item) => item.id === session.routeId);
    if (!route || !route.course) return undefined;
    const base = structuredClone(route.course) as Course;
    if (session.arenaOverride) {
      base.arena = { ...base.arena, ...session.arenaOverride };
    }
    if (session.strideOverride !== undefined) {
      base.horse = { ...base.horse, stepLength: session.strideOverride };
    }
    return base;
  }

  private safetySignature(session: TrainingSession): string {
    const route = this.state.routeCatalog.find((item) => item.id === session.routeId);
    const course = route?.course as Course | undefined;
    const geometry = course
      ? JSON.stringify(
          course.obstacles.map((o) => [o.kind, Math.round(o.x * 10) / 10, Math.round(o.y * 10) / 10, o.rotation]),
        )
      : 'no-course';
    const arena = session.arenaOverride
      ? `${session.arenaOverride.width}x${session.arenaOverride.length}`
      : course
        ? `${course.arena.width}x${course.arena.length}`
        : '';
    const stride = session.strideOverride ?? course?.horse.stepLength ?? '';
    return [
      'safety',
      session.routeId,
      route?.rev ?? 0,
      session.start,
      session.end,
      arena,
      stride,
      geometry,
    ].join('|');
  }

  private judgeSignature(session: TrainingSession): string {
    const route = this.state.routeCatalog.find((item) => item.id === session.routeId);
    const course = route?.course as Course | undefined;
    const geometry = course
      ? JSON.stringify(course.obstacles.map((o) => [o.id, o.height, o.spread]))
      : 'no-course';
    const arena = session.arenaOverride
      ? `${session.arenaOverride.width}x${session.arenaOverride.length}`
      : course
        ? `${course.arena.width}x${course.arena.length}`
        : '';
    const stride = session.strideOverride ?? course?.horse.stepLength ?? '';
    return [
      'judge',
      session.routeId,
      route?.rev ?? 0,
      session.start,
      session.end,
      arena,
      stride,
      geometry,
    ].join('|');
  }

  private invalidateSessionArtifacts(draft: ScheduleState, sessionId: string) {
    draft.safety = draft.safety.filter((item) => item.sessionId !== sessionId);
    draft.judges = draft.judges.filter((item) => item.sessionId !== sessionId);
  }

  /** 取安全分析：签名不匹配（时间/场地/步幅/路线改动）时重算，其余场次不受影响 */
  getSafetyAnalysis(sessionId: string): { artifact: SafetyArtifact; analysis: RouteAnalysis } | undefined {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) return undefined;
    const signature = this.safetySignature(session);
    const cached = this.state.safety.find((item) => item.sessionId === sessionId);
    if (cached && cached.signature === signature) {
      const course = this.effectiveCourse(session)!;
      return { artifact: cached, analysis: analyzeCourse(course) };
    }
    const course = this.effectiveCourse(session);
    if (!course) return undefined;
    const analysis = analyzeCourse(course);
    const artifact: SafetyArtifact = {
      sessionId,
      signature,
      computedAt: Date.now(),
      score: analysis.score,
      totalDistance: analysis.totalDistance,
      estimatedSeconds: analysis.estimatedSeconds,
      issueCount: analysis.issues.length,
      summary: analysis.issues.map((issue) => issue.title).join('；') || '全部区段合理',
    };
    this.state.safety = [
      ...this.state.safety.filter((item) => item.sessionId !== sessionId),
      artifact,
    ];
    return { artifact, analysis };
  }

  getJudgeSheet(sessionId: string): JudgeArtifact | undefined {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) return undefined;
    const signature = this.judgeSignature(session);
    const cached = this.state.judges.find((item) => item.sessionId === sessionId);
    if (cached && cached.signature === signature) return cached;
    const course = this.effectiveCourse(session);
    if (!course) return undefined;
    const analysis = analyzeCourse(course);
    const artifact: JudgeArtifact = {
      sessionId,
      signature,
      computedAt: Date.now(),
      score: analysis.score,
      rows: analysis.rows.map((row) => {
        const obstacle = course.obstacles.find((item) => item.id === row.fromId);
        return {
          number: row.fromNumber,
          obstacle: obstacle?.name ?? '',
          height: obstacle?.height ?? '',
          distance: row.distance,
          strides: row.strides,
          recommended: row.recommended,
          turn: row.turnAngle,
          verdict: row.level === 'ok' ? '合理' : row.level === 'warning' ? '需注意' : '有风险',
        };
      }),
    };
    this.state.judges = [
      ...this.state.judges.filter((item) => item.sessionId !== sessionId),
      artifact,
    ];
    return artifact;
  }

  isSafetyStale(sessionId: string): boolean {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) return false;
    const cached = this.state.safety.find((item) => item.sessionId === sessionId);
    return !cached || cached.signature !== this.safetySignature(session);
  }

  isJudgeStale(sessionId: string): boolean {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) return false;
    const cached = this.state.judges.find((item) => item.sessionId === sessionId);
    return !cached || cached.signature !== this.judgeSignature(session);
  }
}
