import { create } from 'zustand';
import type { Course, Obstacle, ObstaclePreset, SavedRoute } from '../types/course';
import {
  analyzeCourse,
  clamp,
  createId,
  createInitialCourse,
  createObstacle,
  generateRouteOptions,
  roundTo,
} from '../utils/course';

const COURSE_KEY = 'strideplan:course';
const SAVED_KEY = 'strideplan:saved-routes';

function cloneCourse(course: Course): Course {
  return structuredClone(course);
}

function readCourse() {
  try {
    const raw = localStorage.getItem(COURSE_KEY);
    return raw ? (JSON.parse(raw) as Course) : createInitialCourse();
  } catch {
    return createInitialCourse();
  }
}

export function readSavedRoutes(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedRoute[]) : [];
  } catch {
    return [];
  }
}

// 首次使用时内置几条样本路线，供排场表直接选路
function seedSavedRoutes(): SavedRoute[] {
  const base = createInitialCourse();
  const variants: Array<{ name: string; mutate: (course: Course) => Course }> = [
    { name: '周五进阶训练路线', mutate: (course) => course },
    {
      name: '周六入门热身路线',
      mutate: (course) => ({
        ...course,
        obstacles: course.obstacles.map((obstacle) => ({ ...obstacle, kind: 'vertical' as const })),
      }),
    },
    {
      name: '周日挑战竞技路线',
      mutate: (course) => ({
        ...course,
        obstacles: course.obstacles.map((obstacle, index) => {
          if (index === 1) return { ...obstacle, kind: 'oxer' as const };
          if (index === 2) return { ...obstacle, kind: 'triple' as const };
          if (index === 4) return { ...obstacle, kind: 'combination' as const };
          return obstacle;
        }),
      }),
    },
  ];

  const seeded: SavedRoute[] = variants.map(({ name, mutate }, index) => {
    const course = mutate({
      ...base,
      id: createId('course'),
      name,
      obstacles: base.obstacles.map((obstacle) => ({ ...obstacle, id: createId('obs') })),
      sequence: [],
      updatedAt: Date.now() - index * 1000,
    });
    course.sequence = course.obstacles.map((item) => item.id);
    const analysis = analyzeCourse(course);
    return {
      id: course.id,
      name,
      savedAt: Date.now() - index * 3600_000,
      course,
      score: analysis.score,
    };
  });

  localStorage.setItem(SAVED_KEY, JSON.stringify(seeded));
  return seeded;
}

function persist(course: Course, savedRoutes?: SavedRoute[]) {
  localStorage.setItem(COURSE_KEY, JSON.stringify(course));
  if (savedRoutes) localStorage.setItem(SAVED_KEY, JSON.stringify(savedRoutes));
}

interface CourseState {
  course: Course;
  selectedId: string | null;
  snapEnabled: boolean;
  gridVisible: boolean;
  routeOptions: ReturnType<typeof import('../utils/course').generateRouteOptions>;
  savedRoutes: SavedRoute[];
  history: Course[];
  future: Course[];
  select: (id: string | null) => void;
  toggleSnap: () => void;
  toggleGrid: () => void;
  addObstacle: (preset: ObstaclePreset, x: number, y: number) => void;
  updateObstacle: (id: string, patch: Partial<Obstacle>) => void;
  moveObstacle: (id: string, x: number, y: number) => void;
  removeObstacle: (id: string) => void;
  moveInSequence: (id: string, direction: -1 | 1) => void;
  setCourseName: (name: string) => void;
  setArena: (patch: Partial<Course['arena']>) => void;
  setHorse: (patch: Partial<Course['horse']>) => void;
  setGridSize: (size: number) => void;
  applyRoute: (sequence: string[]) => void;
  generateOptions: () => void;
  undo: () => void;
  redo: () => void;
  resetCourse: () => void;
  loadCourse: (course: Course) => void;
  saveNamedRoute: (name: string) => SavedRoute;
  deleteSavedRoute: (id: string) => void;
}

export const useCourseStore = create<CourseState>((set, get) => {
  const initial = readCourse();

  const commit = (nextCourse: Course) => {
    const current = get().course;
    const next = { ...cloneCourse(nextCourse), updatedAt: Date.now() };
    persist(next, get().savedRoutes);
    set((state) => ({
      course: next,
      history: [...state.history.slice(-39), cloneCourse(current)],
      future: [],
    }));
  };

  return {
    course: initial,
    selectedId: initial.sequence[0] ?? null,
    snapEnabled: true,
    gridVisible: true,
    routeOptions: [],
    savedRoutes: readSavedRoutes().length ? readSavedRoutes() : seedSavedRoutes(),
    history: [],
    future: [],
    select: (id) => set({ selectedId: id }),
    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
    toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),
    addObstacle: (preset, x, y) => {
      const current = get().course;
      const nextNumber = current.obstacles.length + 1;
      const obstacle = createObstacle(
        preset,
        clamp(roundTo(x, 0.5), 2, current.arena.width - 2),
        clamp(roundTo(y, 0.5), 2, current.arena.length - 2),
        nextNumber,
      );
      commit({
        ...current,
        obstacles: [...current.obstacles, obstacle],
        sequence: [...current.sequence, obstacle.id],
      });
      set({ selectedId: obstacle.id });
    },
    updateObstacle: (id, patch) => {
      const current = get().course;
      commit({
        ...current,
        obstacles: current.obstacles.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      });
    },
    moveObstacle: (id, x, y) => {
      const current = get().course;
      const snap = get().snapEnabled ? current.gridSize : 0.1;
      commit({
        ...current,
        obstacles: current.obstacles.map((item) =>
          item.id === id
            ? {
                ...item,
                x: clamp(roundTo(x, snap), 1, current.arena.width - 1),
                y: clamp(roundTo(y, snap), 1, current.arena.length - 1),
              }
            : item,
        ),
      });
    },
    removeObstacle: (id) => {
      const current = get().course;
      commit({
        ...current,
        obstacles: current.obstacles.filter((item) => item.id !== id),
        sequence: current.sequence.filter((item) => item !== id),
      });
      set({ selectedId: null });
    },
    moveInSequence: (id, direction) => {
      const current = get().course;
      const index = current.sequence.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.sequence.length) return;
      const sequence = [...current.sequence];
      [sequence[index], sequence[nextIndex]] = [sequence[nextIndex], sequence[index]];
      commit({ ...current, sequence });
    },
    setCourseName: (name) => commit({ ...get().course, name }),
    setArena: (patch) =>
      commit({
        ...get().course,
        arena: { ...get().course.arena, ...patch },
      }),
    setHorse: (patch) =>
      commit({
        ...get().course,
        horse: { ...get().course.horse, ...patch },
      }),
    setGridSize: (gridSize) => commit({ ...get().course, gridSize }),
    applyRoute: (sequence) => {
      commit({ ...get().course, sequence });
      set({ routeOptions: [] });
    },
    generateOptions: () => {
      set({ routeOptions: generateRouteOptions(get().course) });
    },
    undo: () => {
      const { history, course } = get();
      if (!history.length) return;
      const previous = history[history.length - 1];
      set({ course: previous, history: history.slice(0, -1), future: [course, ...get().future] });
      persist(previous, get().savedRoutes);
    },
    redo: () => {
      const { future, course } = get();
      if (!future.length) return;
      const next = future[0];
      set({ course: next, future: future.slice(1), history: [...get().history, course] });
      persist(next, get().savedRoutes);
    },
    resetCourse: () => {
      const course = createInitialCourse();
      set({ course, history: [], future: [], selectedId: course.sequence[0], routeOptions: [] });
      persist(course, get().savedRoutes);
    },
    loadCourse: (course) => {
      set({ course, history: [], future: [], selectedId: course.sequence[0] ?? null, routeOptions: [] });
      persist(course, get().savedRoutes);
    },
    saveNamedRoute: (name) => {
      const course = cloneCourse({ ...get().course, name });
      const analysis = analyzeCourse(course);
      const saved: SavedRoute = {
        id: course.id,
        name,
        savedAt: Date.now(),
        course,
        score: analysis.score,
      };
      const savedRoutes = [saved, ...get().savedRoutes.filter((item) => item.id !== saved.id)];
      set({ savedRoutes, course });
      persist(course, savedRoutes);
      return saved;
    },
    deleteSavedRoute: (id) => {
      const savedRoutes = get().savedRoutes.filter((item) => item.id !== id);
      set({ savedRoutes });
      persist(get().course, savedRoutes);
    },
  };
});
