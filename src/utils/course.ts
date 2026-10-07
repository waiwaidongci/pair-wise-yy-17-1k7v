import type {
  Course,
  Difficulty,
  IssueLevel,
  Obstacle,
  ObstaclePreset,
  RouteAnalysis,
  RouteIssue,
  RouteOption,
  StrideRow,
} from '../types/course';

export const OBSTACLE_PRESETS: ObstaclePreset[] = [
  { kind: 'vertical', name: '单横木', width: 3.5, spread: 0.8, height: 90, color: '#d94841' },
  { kind: 'oxer', name: '双横木', width: 3.8, spread: 1.3, height: 105, color: '#2563eb' },
  { kind: 'triple', name: '三重横木', width: 4.2, spread: 1.8, height: 115, color: '#f59e0b' },
  { kind: 'wall', name: '砖墙', width: 3.2, spread: 0.8, height: 100, color: '#8b5e3c' },
  { kind: 'water', name: '水障', width: 4.0, spread: 3.2, height: 45, color: '#1596a6' },
  { kind: 'combination', name: '连续组合', width: 4.4, spread: 2.4, height: 100, color: '#7c3aed' },
];

export const COLOR_LIBRARY = ['#d94841', '#2563eb', '#f59e0b', '#1596a6', '#7c3aed', '#2f855a', '#4a5568', '#db2777'];

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const roundTo = (value: number, precision = 0.1) =>
  Math.round(value / precision) * precision;

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createObstacle(
  preset: ObstaclePreset,
  x: number,
  y: number,
  number: number,
): Obstacle {
  return {
    id: createId('obs'),
    kind: preset.kind,
    name: `${number}号 ${preset.name}`,
    x,
    y,
    rotation: 0,
    width: preset.width,
    spread: preset.spread,
    color: preset.color,
    difficulty: preset.kind === 'vertical' ? '入门' : preset.kind === 'combination' ? '挑战' : '进阶',
    height: preset.height,
  };
}

export function createInitialCourse(): Course {
  const specs: Array<[ObstaclePreset, number, number, number]> = [
    [OBSTACLE_PRESETS[0], 18, 68, 0],
    [OBSTACLE_PRESETS[1], 37, 74, 12],
    [OBSTACLE_PRESETS[2], 47, 46, -22],
    [OBSTACLE_PRESETS[3], 34, 25, 8],
    [OBSTACLE_PRESETS[4], 15, 31, 28],
  ];
  const obstacles = specs.map(([preset, x, y, rotation], index) => ({
    ...createObstacle(preset, x, y, index + 1),
    rotation,
  }));

  return {
    id: createId('course'),
    name: '周五进阶训练路线',
    arena: { width: 60, length: 90, surface: '纤维沙场地' },
    horse: { name: 'Lucky Star', stepLength: 3.5, approach: 1.8, landing: 1.6 },
    obstacles,
    sequence: obstacles.map((item) => item.id),
    gridSize: 2,
    updatedAt: Date.now(),
  };
}

export function obstaclePoint(obstacle: Obstacle): [number, number] {
  return [obstacle.x, obstacle.y];
}

export function distanceBetween(a: Obstacle, b: Obstacle) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleBetween(a: Obstacle, b: Obstacle, c: Obstacle) {
  const first = Math.atan2(b.y - a.y, b.x - a.x);
  const second = Math.atan2(c.y - b.y, c.x - b.x);
  let degrees = ((second - first) * 180) / Math.PI;
  while (degrees > 180) degrees -= 360;
  while (degrees < -180) degrees += 360;
  return Math.abs(degrees);
}

function orientation(a: Obstacle, b: Obstacle, c: Obstacle) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentsCross(a: Obstacle, b: Obstacle, c: Obstacle, d: Obstacle) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function analyzeCourse(course: Course): RouteAnalysis {
  const byId = new Map(course.obstacles.map((item) => [item.id, item]));
  const ordered = course.sequence.map((id) => byId.get(id)).filter(Boolean) as Obstacle[];
  const rows: StrideRow[] = [];
  let totalDistance = 0;

  ordered.slice(0, -1).forEach((from, index) => {
    const to = ordered[index + 1];
    const distance = distanceBetween(from, to);
    const clearDistance = Math.max(0, distance - course.horse.approach - course.horse.landing);
    const rawStrides = clearDistance / course.horse.stepLength;
    const strides = Math.round(rawStrides);
    const deviation = Math.abs(rawStrides - strides);
    const turnAngle = index > 0 ? angleBetween(ordered[index - 1], from, to) : 0;
    let level: IssueLevel = 'ok';
    if (deviation > 0.38 || turnAngle > 82) level = 'warning';
    if (clearDistance < course.horse.stepLength * 0.55 || turnAngle > 112) level = 'error';
    totalDistance += distance;
    rows.push({
      fromId: from.id,
      toId: to.id,
      fromNumber: ordered.indexOf(from) + 1,
      toNumber: index + 2,
      distance: roundTo(distance, 0.1),
      clearDistance: roundTo(clearDistance, 0.1),
      strides: roundTo(rawStrides, 0.1),
      recommended: strides,
      deviation: roundTo(deviation, 0.1),
      turnAngle: roundTo(turnAngle, 1),
      level,
    });
  });

  const issues: RouteIssue[] = [];
  rows.forEach((row) => {
    if (row.level === 'error') {
      issues.push({
        id: `distance-${row.fromId}-${row.toId}`,
        level: 'error',
        title: `${row.fromNumber} → ${row.toNumber} 距离不足`,
        detail: `净距离 ${row.clearDistance} 米，不足一个稳定步幅，建议移动障碍或调整接近段。`,
        obstacleIds: [row.fromId, row.toId],
      });
    } else if (row.level === 'warning') {
      issues.push({
        id: `distance-${row.fromId}-${row.toId}`,
        level: 'warning',
        title: `${row.fromNumber} → ${row.toNumber} 步数偏差`,
        detail: `实测 ${row.strides} 步，推荐 ${row.recommended} 步；骑手需要缩短或延伸步幅。`,
        obstacleIds: [row.fromId, row.toId],
      });
    }
    if (row.turnAngle > 112) {
      issues.push({
        id: `turn-${row.toId}`,
        level: 'error',
        title: `${row.toNumber} 号障碍转角过急`,
        detail: `进线转角约 ${row.turnAngle}°，高速通过时容易拒跳，建议增加弧线距离。`,
        obstacleIds: [row.fromId, row.toId],
      });
    } else if (row.turnAngle > 82) {
      issues.push({
        id: `turn-warning-${row.toId}`,
        level: 'warning',
        title: `${row.toNumber} 号障碍入线偏紧`,
        detail: `进线转角约 ${row.turnAngle}°，需要提前建立外侧屈挠。`,
        obstacleIds: [row.fromId, row.toId],
      });
    }
  });

  for (let first = 0; first < ordered.length - 1; first += 1) {
    for (let second = first + 1; second < ordered.length - 1; second += 1) {
      if (Math.abs(first - second) <= 1) continue;
      if (segmentsCross(ordered[first], ordered[first + 1], ordered[second], ordered[second + 1])) {
        issues.push({
          id: `cross-${first}-${second}`,
          level: 'error',
          title: '路线发生交叉',
          detail: `${first + 1}→${first + 2} 与 ${second + 1}→${second + 2} 的路线相交。`,
          obstacleIds: [ordered[first].id, ordered[second].id],
        });
      }
    }
  }

  const score = clamp(
    100 -
      issues.filter((item) => item.level === 'error').length * 12 -
      issues.filter((item) => item.level === 'warning').length * 5,
    20,
    100,
  );
  const estimatedSeconds = Math.round((totalDistance / 5.2) * 10) / 10;

  return { rows, issues, totalDistance: roundTo(totalDistance, 0.1), estimatedSeconds, score };
}

function shuffled<T>(items: T[], seed: number) {
  const copy = [...items];
  let value = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    value = (value * 9301 + 49297) % 233280;
    const swapIndex = Math.floor((value / 233280) * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function generateRouteOptions(course: Course): RouteOption[] {
  const difficulties: Difficulty[] = ['入门', '进阶', '挑战'];
  const seeds = [17, 41, 89];
  return difficulties.map((difficulty, index) => {
    let sequence = shuffled(course.sequence, seeds[index]);
    if (difficulty === '入门') {
      const first = course.obstacles.find((item) => item.kind === 'vertical');
      const last = course.obstacles.find((item) => item.kind !== 'combination');
      sequence = [
        ...(first ? [first.id] : []),
        ...sequence.filter((id) => id !== first?.id && id !== last?.id),
        ...(last && last.id !== first?.id ? [last.id] : []),
      ];
    }
    const hypothetical = { ...course, sequence };
    const analysis = analyzeCourse(hypothetical);
    return {
      id: `route-option-${index}`,
      name: ['流畅起跳线', '技术弯曲线', '竞技挑战线'][index],
      difficulty,
      description: [
        '长直线与缓弯为主，适合热身和年轻马建立节奏。',
        '包含连续弧线与两次方向转换，考验骑手线路控制。',
        '短步距与锐角组合更多，适合高水平赛前训练。',
      ][index],
      sequence,
      score: analysis.score,
      estimatedSeconds: analysis.estimatedSeconds,
    };
  });
}

export function courseToShareToken(course: Course) {
  const bytes = new TextEncoder().encode(JSON.stringify(course));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function courseFromShareToken(token: string): Course | null {
  try {
    const binary = atob(token);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Course;
  } catch {
    return null;
  }
}

