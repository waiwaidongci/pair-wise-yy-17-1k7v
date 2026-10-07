import { ActionIcon, Badge, Group, Tabs, Text } from '@mantine/core';
import { BookOpen, FilePenLine, RotateCcw } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useCourseStore } from './stores/courseStore';

export default function App() {
  const location = useLocation();
  const resetCourse = useCourseStore((state) => state.resetCourse);
  const obstacles = useCourseStore((state) => state.course.obstacles.length);

  return (
    <div className="app-shell">
      <header className="app-header">
        <Group>
          <div className="brand-mark">SP</div>
          <div>
            <Text fw={900} className="brand-name">StridePlan</Text>
            <Text className="brand-subtitle">马术障碍路线设计器</Text>
          </div>
        </Group>
        <Tabs
          value={location.pathname.startsWith('/routes') ? 'routes' : 'designer'}
          variant="pills"
          className="main-nav"
        >
          <Tabs.List>
            <Tabs.Tab value="designer" leftSection={<FilePenLine size={16} />}>
              <Link to="/designer">路线设计</Link>
            </Tabs.Tab>
            <Tabs.Tab value="routes" leftSection={<BookOpen size={16} />}>
              <Link to="/routes">路线库</Link>
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Group>
          <Badge variant="light">{obstacles} 道障碍</Badge>
          <ActionIcon variant="subtle" color="gray" onClick={resetCourse} title="恢复示例路线">
            <RotateCcw size={18} />
          </ActionIcon>
        </Group>
      </header>
      <Outlet />
    </div>
  );
}

