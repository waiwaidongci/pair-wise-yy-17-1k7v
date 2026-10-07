import { create } from 'zustand';
import type { Course, Obstacle, ObstaclePreset, SavedRoute } from '../types/course';
import {
  analyzeCourse,
  clamp,
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
    savedRoutes: readSavedRoutes(),
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
