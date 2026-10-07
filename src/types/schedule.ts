import type { Course, ObstacleKind, RouteAnalysis } from './course';

// 器材类别与障碍类型一一对应：俱乐部只有一套障碍器材，按类型计数。
export type EquipmentKind = ObstacleKind;

// 场次状态
export type SessionStatus =
  | 'draft' // 草稿：未提交，未占器材
  | 'pending' // 待备料：已提交但同时段器材不足，等待占用释放
  | 'scheduled' // 已排定：器材已预占
  | 'cancelled'; // 已取消：器材已归还

export interface TrainingSession {
  id: string;
  name: string; // 场次名称
  coach: string; // 教练
  date: string; // 日期 YYYY-MM-DD
  startTime: string; // 开始 HH:mm
  endTime: string; // 结束 HH:mm
  routeId: string | null; // 选中的路线（saved route id）
  routeName: string; // 路线名称快照
  course: Course; // 路线快照（含障碍布局、场地尺寸、马匹步幅）
  status: SessionStatus;
  reserved: Partial<Record<EquipmentKind, number>>; // 已预占器材（提交时锁定的绝对值）
  conflictSessionId: string | null; // 占用方场次 id（待备料时）
  conflictDetail: string | null; // 占用说明
  note: string;
  createdAt: number;
  updatedAt: number;
  submittedAt: number | null;
  version: number; // 乐观锁 / 幂等版本
  // 缓存的派生分析：输入不变则沿用，输入变化则失效重算
  analysis: RouteAnalysis | null;
  analysisHash: string | null;
}

export interface ScheduleState {
  sessions: TrainingSession[];
  // 器材清单：俱乐部该类器材总数量（一套障碍器材）
  equipment: Record<EquipmentKind, number>;
  revision: number; // 排场表版本号，用于并发提交的乐观校验
}

export interface SubmitResult {
  ok: boolean;
  reason?: 'conflict' | 'error';
  session?: TrainingSession;
  error?: string;
}
