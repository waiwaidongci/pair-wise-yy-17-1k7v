import type { Course, Obstacle } from '../types/course';
import { obstaclePoint } from './course';

interface DrawingOptions {
  width: number;
  height: number;
  selectedId?: string | null;
  highlightedIds?: string[];
  showGrid?: boolean;
  background?: string;
}

export interface ArenaTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  margin: number;
}

export function getArenaTransform(course: Course, width: number, height: number): ArenaTransform {
  const margin = Math.max(28, Math.min(width, height) * 0.07);
  const scale = Math.min(
    (width - margin * 2) / course.arena.width,
    (height - margin * 2) / course.arena.length,
  );
  return {
    scale,
    offsetX: (width - course.arena.width * scale) / 2,
    offsetY: (height - course.arena.length * scale) / 2,
    margin,
  };
}

export function toCanvasPoint(
  course: Course,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const transform = getArenaTransform(course, width, height);
  return {
    x: transform.offsetX + x * transform.scale,
    y: transform.offsetY + (course.arena.length - y) * transform.scale,
  };
}

export function fromCanvasPoint(
  course: Course,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const transform = getArenaTransform(course, width, height);
  return {
    x: (x - transform.offsetX) / transform.scale,
    y: course.arena.length - (y - transform.offsetY) / transform.scale,
  };
}

function drawArrow(
  context: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = 10;
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - length * Math.cos(angle - Math.PI / 6), to.y - length * Math.sin(angle - Math.PI / 6));
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - length * Math.cos(angle + Math.PI / 6), to.y - length * Math.sin(angle + Math.PI / 6));
  context.stroke();
}

function drawObstacle(
  context: CanvasRenderingContext2D,
  obstacle: Obstacle,
  number: number,
  center: { x: number; y: number },
  scale: number,
  selected: boolean,
  highlighted: boolean,
) {
  const halfWidth = (obstacle.width * scale) / 2;
  const halfSpread = (obstacle.spread * scale) / 2;
  context.save();
  context.translate(center.x, center.y);
  context.rotate((obstacle.rotation * Math.PI) / 180);
  if (selected || highlighted) {
    context.shadowColor = highlighted ? '#ef4444' : '#2563eb';
    context.shadowBlur = 14;
  }
  if (obstacle.kind === 'water') {
    context.fillStyle = `${obstacle.color}55`;
    context.strokeStyle = obstacle.color;
    context.lineWidth = 2;
    context.fillRect(-halfWidth, -halfSpread, halfWidth * 2, halfSpread * 2);
    context.strokeRect(-halfWidth, -halfSpread, halfWidth * 2, halfSpread * 2);
    context.strokeStyle = '#ffffffaa';
    for (let line = -halfSpread + 5; line < halfSpread; line += 9) {
      context.beginPath();
      context.moveTo(-halfWidth + 5, line);
      context.bezierCurveTo(-halfWidth / 3, line - 3, halfWidth / 3, line + 3, halfWidth - 5, line);
      context.stroke();
    }
  } else {
    context.strokeStyle = obstacle.color;
    context.fillStyle = obstacle.color;
    context.lineWidth = selected ? 4 : 3;
    if (obstacle.kind === 'wall') {
      context.fillRect(-halfWidth, -halfSpread, halfWidth * 2, halfSpread * 2);
      context.strokeStyle = '#ffffff99';
      context.lineWidth = 1;
      for (let x = -halfWidth + 8; x < halfWidth; x += 12) {
        context.beginPath();
        context.moveTo(x, -halfSpread);
        context.lineTo(x, halfSpread);
        context.stroke();
      }
    } else {
      const railCount = obstacle.kind === 'triple' ? 3 : obstacle.kind === 'oxer' ? 2 : 1;
      for (let rail = 0; rail < railCount; rail += 1) {
        const y = railCount === 1 ? 0 : -halfSpread + (rail / (railCount - 1)) * halfSpread * 2;
        context.beginPath();
        context.moveTo(-halfWidth, y);
        context.lineTo(halfWidth, y);
        context.stroke();
      }
      context.lineWidth = 3;
      [-halfWidth, halfWidth].forEach((x) => {
        context.beginPath();
        context.moveTo(x, -halfSpread - 4);
        context.lineTo(x, halfSpread + 4);
        context.stroke();
      });
    }
  }
  context.shadowBlur = 0;
  context.fillStyle = '#111827';
  context.beginPath();
  context.arc(-halfWidth - 13, 0, 11, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#fff';
  context.font = 'bold 12px "Avenir Next", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(number), -halfWidth - 13, 0.5);
  context.restore();
}

export function drawCourse(
  context: CanvasRenderingContext2D,
  course: Course,
  options: DrawingOptions,
) {
  const { width, height, selectedId, highlightedIds = [], showGrid = true } = options;
  context.clearRect(0, 0, width, height);
  context.fillStyle = options.background ?? '#f8fafc';
  context.fillRect(0, 0, width, height);

  const transform = getArenaTransform(course, width, height);
  const arenaX = transform.offsetX;
  const arenaY = transform.offsetY;
  const arenaW = course.arena.width * transform.scale;
  const arenaH = course.arena.length * transform.scale;

  context.fillStyle = '#d9c7a5';
  context.fillRect(arenaX, arenaY, arenaW, arenaH);
  context.strokeStyle = '#8f7959';
  context.lineWidth = 7;
  context.strokeRect(arenaX, arenaY, arenaW, arenaH);
  context.strokeStyle = '#fff8e8';
  context.lineWidth = 2;
  context.strokeRect(arenaX + 7, arenaY + 7, arenaW - 14, arenaH - 14);

  if (showGrid) {
    context.strokeStyle = 'rgba(82, 65, 42, 0.12)';
    context.lineWidth = 1;
    for (let x = course.gridSize; x < course.arena.width; x += course.gridSize) {
      const canvasX = transform.offsetX + x * transform.scale;
      context.beginPath();
      context.moveTo(canvasX, arenaY);
      context.lineTo(canvasX, arenaY + arenaH);
      context.stroke();
    }
    for (let y = course.gridSize; y < course.arena.length; y += course.gridSize) {
      const canvasY = transform.offsetY + y * transform.scale;
      context.beginPath();
      context.moveTo(arenaX, canvasY);
      context.lineTo(arenaX + arenaW, canvasY);
      context.stroke();
    }
  }

  context.fillStyle = 'rgba(66, 51, 30, .62)';
  context.font = '11px "Avenir Next", sans-serif';
  context.textAlign = 'center';
  context.fillText(`${course.arena.width} m`, arenaX + arenaW / 2, arenaY - 12);
  context.save();
  context.translate(arenaX - 16, arenaY + arenaH / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(`${course.arena.length} m`, 0, 0);
  context.restore();

  const byId = new Map(course.obstacles.map((item) => [item.id, item]));
  const ordered = course.sequence.map((id) => byId.get(id)).filter(Boolean) as Obstacle[];
  if (ordered.length > 1) {
    context.save();
    context.strokeStyle = 'rgba(37, 99, 235, .82)';
    context.lineWidth = 2.5;
    context.setLineDash([8, 7]);
    context.beginPath();
    ordered.forEach((obstacle, index) => {
      const point = toCanvasPoint(course, width, height, ...obstaclePoint(obstacle));
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
    context.setLineDash([]);
    ordered.slice(0, -1).forEach((obstacle, index) => {
      const from = toCanvasPoint(course, width, height, ...obstaclePoint(obstacle));
      const next = ordered[index + 1];
      const to = toCanvasPoint(course, width, height, ...obstaclePoint(next));
      const t = 0.64;
      drawArrow(context, from, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    });
    context.restore();
  }

  ordered.forEach((obstacle, index) => {
    const point = toCanvasPoint(course, width, height, ...obstaclePoint(obstacle));
    drawObstacle(
      context,
      obstacle,
      index + 1,
      point,
      transform.scale,
      selectedId === obstacle.id,
      highlightedIds.includes(obstacle.id),
    );
  });
}

export function courseToDataUrl(course: Course, width = 1200, height = 1600) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  drawCourse(context, course, { width, height, showGrid: true, background: '#ffffff' });
  return canvas.toDataURL('image/png');
}

