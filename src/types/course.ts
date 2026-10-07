export type ObstacleKind =
  | 'vertical'
  | 'oxer'
  | 'triple'
  | 'wall'
  | 'water'
  | 'combination';

export type Difficulty = '入门' | '进阶' | '挑战';

export interface Arena {
  width: number;
  length: number;
  surface: string;
}

export interface HorseProfile {
  name: string;
  stepLength: number;
  approach: number;
  landing: number;
}

export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  name: string;
  x: number;
  y: number;
  rotation: number;
  width: number;
  spread: number;
  color: string;
  difficulty: Difficulty;
  height: number;
}

export interface Course {
  id: string;
  name: string;
  arena: Arena;
  horse: HorseProfile;
  obstacles: Obstacle[];
  sequence: string[];
  gridSize: number;
  updatedAt: number;
}

export type IssueLevel = 'ok' | 'warning' | 'error';

export interface RouteIssue {
  id: string;
  level: IssueLevel;
  title: string;
  detail: string;
  obstacleIds: string[];
}

export interface StrideRow {
  fromId: string;
  toId: string;
  fromNumber: number;
  toNumber: number;
  distance: number;
  clearDistance: number;
  strides: number;
  recommended: number;
  deviation: number;
  turnAngle: number;
  level: IssueLevel;
}

export interface RouteAnalysis {
  rows: StrideRow[];
  issues: RouteIssue[];
  totalDistance: number;
  estimatedSeconds: number;
  score: number;
}

export interface RouteOption {
  id: string;
  name: string;
  difficulty: Difficulty;
  description: string;
  sequence: string[];
  score: number;
  estimatedSeconds: number;
}

export interface SavedRoute {
  id: string;
  name: string;
  savedAt: number;
  course: Course;
  score: number;
}

export interface ObstaclePreset {
  kind: ObstacleKind;
  name: string;
  width: number;
  spread: number;
  height: number;
  color: string;
}

