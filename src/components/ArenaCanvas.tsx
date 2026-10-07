import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Course, Obstacle, ObstaclePreset } from '../types/course';
import {
  drawCourse,
  fromCanvasPoint,
  getArenaTransform,
  toCanvasPoint,
} from '../utils/drawing';

interface ArenaCanvasProps {
  course: Course;
  selectedId: string | null;
  highlightedIds: string[];
  gridVisible: boolean;
  placementPreset: ObstaclePreset | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onPlace: (preset: ObstaclePreset, x: number, y: number) => void;
}

export function ArenaCanvas({
  course,
  selectedId,
  highlightedIds,
  gridVisible,
  placementPreset,
  onSelect,
  onMove,
  onPlace,
}: ArenaCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 900, height: 700 });
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const [cursor, setCursor] = useState('default');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(420, Math.floor(entry.contentRect.width)),
        height: Math.max(480, Math.floor(entry.contentRect.height)),
      });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCourse(context, course, {
      width: size.width,
      height: size.height,
      selectedId,
      highlightedIds,
      showGrid: gridVisible,
    });
  }, [course, gridVisible, highlightedIds, selectedId, size]);

  const byId = useMemo(() => new Map(course.obstacles.map((item) => [item.id, item])), [course.obstacles]);

  function getCoursePoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return fromCanvasPoint(
      course,
      size.width,
      size.height,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  function findObstacle(event: ReactPointerEvent<HTMLCanvasElement>): Obstacle | null {
    const point = getCoursePoint(event);
    const transform = getArenaTransform(course, size.width, size.height);
    const threshold = Math.max(14, 0.7 * transform.scale);
    return (
      [...course.obstacles]
        .reverse()
        .find((item) => {
          const center = toCanvasPoint(course, size.width, size.height, item.x, item.y);
          const mouse = toCanvasPoint(course, size.width, size.height, point.x, point.y);
          return Math.hypot(center.x - mouse.x, center.y - mouse.y) < threshold + (item.width * transform.scale) / 2;
        }) ?? null
    );
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = getCoursePoint(event);
    if (placementPreset) {
      onPlace(placementPreset, point.x, point.y);
      return;
    }
    const obstacle = findObstacle(event);
    if (!obstacle) {
      onSelect(null);
      return;
    }
    onSelect(obstacle.id);
    dragRef.current = { id: obstacle.id, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCursor('grabbing');
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) {
      setCursor(placementPreset ? 'crosshair' : findObstacle(event) ? 'grab' : 'default');
      return;
    }
    const obstacle = byId.get(dragRef.current.id);
    if (!obstacle) return;
    const point = getCoursePoint(event);
    onMove(obstacle.id, point.x, point.y);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
      setCursor('grab');
    }
  }

  return (
    <div className="arena-host" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="arena-canvas"
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="arena-compass">
        <span>北</span>
        <span className="compass-arrow">↑</span>
      </div>
    </div>
  );
}

