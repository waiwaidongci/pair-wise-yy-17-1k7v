/**
 * 排场 / 占料领域模型
 *
 * 三类基础数据：路线库（routeCatalog）、器材清单（equipment）、训练场次（sessions）。
 * 草稿（drafts）是教练未提交的工作台，不占用任何资源。
 */

/** 障碍类型与设计器保持一致 */
export type ObstacleKind =
  | 'vertical'
  | 'oxer'
  | 'triple'
  | 'wall'
  | 'water'
  | 'combination';

/** 资源键：障碍器材按类型计数；arena 是唯一场地，容量恒为 1 */
export type ResourceKey = ObstacleKind | 'arena';

/** 器材清单条目 */
export interface EquipmentItem {
  kind: ResourceKey;
  label: string;
  /** 可用库存（静态容量）。arena 固定为 1 */
  count: number;
}

/** 路线对各类资源的需求（按障碍类型聚合数量，场地固定需要 1） */
export type ResourceNeed = Partial<Record<ResourceKey, number>>;

/** 路线库里的一条路线。course 为可选，便于只登记需求而不带完整图纸 */
export interface RouteDef {
  id: string;
  name: string;
  /** 每条障碍的类型，按路线顺序 */
  obstacleKinds: ObstacleKind[];
  /** 冗余的聚合需求，缺省时由 obstacleKinds 推导 */
  need?: ResourceNeed;
  /** 来自设计器的完整路线（含场地尺寸、步幅、几何），用于安全分析与裁判表 */
  course?: unknown;
  /** 几何版本：路线被改动后递增，用于判定关联分析失效 */
  rev: number;
  updatedAt: number;
}

export type SessionStatus = 'confirmed' | 'pending_materials';

/** 训练场次 */
export interface TrainingSession {
  id: string;
  title: string;
  coach: string;
  start: number;
  end: number;
  routeId: string;
  status: SessionStatus;
  /** 场次级覆盖：场地尺寸 / 马匹步幅改动写在这里，不改路线库原件 */
  arenaOverride?: { width: number; length: number };
  strideOverride?: number;
  /** 待备料原因（status = pending_materials 时给出） */
  blockedReason?: string;
  /** 余量不足时，指出每种资源被哪些场次占用 */
  blockedBy?: ShortageReport;
  createdAt: number;
  updatedAt: number;
}

/** 教练草稿：可以同时存在、互不可见提交结果之外的内容 */
export interface CoachDraft {
  id: string;
  coach: string;
  title: string;
  start: number;
  end: number;
  routeId: string;
  arenaOverride?: { width: number; length: number };
  strideOverride?: number;
  updatedAt: number;
}

/** 单个资源的缺口 */
export interface ResourceShortage {
  resource: ResourceKey;
  label: string;
  required: number;
  available: number;
  /** 同时段已占用该资源的场次，按提交先后排列 */
  holders: Array<{ sessionId: string; title: string; coach: string; qty: number }>;
}

/** 一次余量检查的完整缺口报告 */
export interface ShortageReport {
  shortages: ResourceShortage[];
}

/** 预占 / 归还流水。holdings 由未归还的 hold 推导，不靠可变计数器，避免重复扣减 */
export interface LedgerEntry {
  id: string;
  /** 幂等键：同一次提交的 hold / release 共用，重试时可识别 */
  submissionId: string;
  sessionId: string;
  resource: ResourceKey;
  qty: number;
  action: 'hold' | 'release';
  /** release 指向被归还的 hold 条目 */
  pairedEntryId?: string;
  at: number;
  failure?: 'return_failed' | 'persist_failed';
}

/** 提交结果（幂等记录）。重试返回同一结果，不会再次扣减 */
export interface SubmissionOutcome {
  submissionId: string;
  status: SessionStatus | 'rejected' | 'rolled_back';
  sessionId: string;
  shortage?: ShortageReport;
  blockedDraftId?: string;
  /** 失败回滚时的原因 */
  error?: string;
  at: number;
}

/** 安全分析快照 */
export interface SafetyArtifact {
  sessionId: string;
  signature: string;
  computedAt: number;
  score: number;
  totalDistance: number;
  estimatedSeconds: number;
  issueCount: number;
  summary: string;
}

/** 裁判表快照 */
export interface JudgeArtifact {
  sessionId: string;
  signature: string;
  computedAt: number;
  rows: Array<{
    number: number;
    obstacle: string;
    height: number | string;
    distance: number;
    strides: number;
    recommended: number;
    turn: number;
    verdict: string;
  }>;
  score: number;
}

/** 引擎内部状态（整块持久化） */
export interface ScheduleState {
  version: number;
  equipment: EquipmentItem[];
  routeCatalog: RouteDef[];
  sessions: TrainingSession[];
  drafts: CoachDraft[];
  ledger: LedgerEntry[];
  outcomes: SubmissionOutcome[];
  safety: SafetyArtifact[];
  judges: JudgeArtifact[];
  revision: number;
}

/** 提交 / 改期后返回的结果 */
export interface SubmitResult {
  ok: boolean;
  status: SessionStatus | 'rejected' | 'rolled_back';
  sessionId: string;
  shortage?: ShortageReport;
  draftId?: string;
  error?: string;
}

export interface AvailabilityRequest {
  start: number;
  end: number;
  routeId: string;
  /** 改期 / 换路线时忽略自身 */
  excludeSessionId?: string;
  arenaOverride?: { width: number; length: number };
  strideOverride?: number;
}

export interface AvailabilityReport {
  ok: boolean;
  start: number;
  end: number;
  /** 每种资源的 需求 / 已占 / 余量 */
  perResource: Array<{
    resource: ResourceKey;
    label: string;
    required: number;
    capacity: number;
    used: number;
    remaining: number;
  }>;
  shortages: ResourceShortage[];
}

/** 注入故障，用于演示与测试 */
export interface FaultHooks {
  /** 器材归还（release）时抛错 */
  failEquipmentReturn?: boolean;
  /** 持久化保存时抛错 */
  failPersist?: boolean;
}
