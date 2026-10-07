import { Badge, Button, Group, Paper, SimpleGrid, Text, Title } from '@mantine/core';
import { CalendarClock, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { useCourseStore } from '../stores/courseStore';
import { useScheduleStore, useScheduleVersion } from '../stores/scheduleStore';
import { analyzeCourse } from '../utils/course';

export function RoutesLibraryView() {
  const savedRoutes = useCourseStore((state) => state.savedRoutes);
  const loadCourse = useCourseStore((state) => state.loadCourse);
  const remove = useCourseStore((state) => state.deleteSavedRoute);
  const syncDesignerRoute = useScheduleStore((state) => state.syncDesignerRoute);
  useScheduleVersion();
  const scheduleRoutes = useScheduleStore.getState().snapshot().routeCatalog;
  const setNotice = useScheduleStore((state) => state.setNotice);

  const syncedIds = new Set(scheduleRoutes.map((route) => route.course ? (route.course as { id: string }).id : ''));

  return (
    <main className="page-wrap">
      <Group justify="space-between" align="flex-end" mb="xl">
        <div>
          <Text className="eyebrow">本地路线库</Text>
          <Title order={1}>已保存路线</Title>
          <Text c="dimmed" mt={6}>数据保存在当前浏览器，可随时载入继续调整或导出裁判资料。</Text>
        </div>
        <Badge size="lg" variant="light">{savedRoutes.length} 条路线</Badge>
      </Group>

      {savedRoutes.length === 0 ? (
        <Paper className="library-empty" p="xl" withBorder>
          <CalendarClock size={30} />
          <Title order={3} mt="md">路线库还是空的</Title>
          <Text c="dimmed" mt={6}>在路线设计器完成布局后，点击“保存”即可留存版本。</Text>
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="lg">
          {savedRoutes.map((route) => {
            const analysis = analyzeCourse(route.course);
            return (
              <Paper key={route.id} className="saved-route-card" p="lg" withBorder>
                <Group justify="space-between">
                  <Badge color={analysis.score > 80 ? 'teal' : 'yellow'}>{analysis.score} 分</Badge>
                  <Text size="xs" c="dimmed">
                    {new Date(route.savedAt).toLocaleString('zh-CN', { hour12: false })}
                  </Text>
                </Group>
                <Title order={3} mt="md">{route.name}</Title>
                <Text size="sm" c="dimmed" mt={6}>
                  {route.course.obstacles.length} 道障碍 · {analysis.totalDistance} m · 预计 {analysis.estimatedSeconds}s
                </Text>
                <Text size="xs" c="dimmed" mt="sm">
                  马匹：{route.course.horse.name} · 步幅 {route.course.horse.stepLength} m
                </Text>
                <Group mt="lg">
                  <Button
                    variant="light"
                    leftSection={<ExternalLink size={15} />}
                    onClick={() => loadCourse(route.course)}
                  >
                    载入设计器
                  </Button>
                  <Button
                    variant={syncedIds.has(route.course.id) ? 'subtle' : 'filled'}
                    color={syncedIds.has(route.course.id) ? 'teal' : 'indigo'}
                    leftSection={<RefreshCw size={15} />}
                    onClick={async () => {
                      await syncDesignerRoute(route.course);
                      setNotice(`「${route.name}」已同步到排场路线库`);
                    }}
                  >
                    {syncedIds.has(route.course.id) ? '更新到排场表' : '同步到排场表'}
                  </Button>
                  <Button
                    variant="subtle"
                    color="red"
                    leftSection={<Trash2 size={15} />}
                    onClick={() => remove(route.id)}
                  >
                    删除
                  </Button>
                </Group>
              </Paper>
            );
          })}
        </SimpleGrid>
      )}
    </main>
  );
}

