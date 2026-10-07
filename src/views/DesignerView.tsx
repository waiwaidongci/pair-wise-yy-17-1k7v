import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  ArrowLeftRight,
  Clipboard,
  Download,
  Grid3X3,
  WandSparkles,
  MousePointer2,
  Printer,
  Redo2,
  RotateCcw,
  Save,
  Share2,
  Undo2,
} from 'lucide-react';
import { ArenaCanvas } from '../components/ArenaCanvas';
import { ObstacleInspector } from '../components/ObstacleInspector';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { useCourseStore } from '../stores/courseStore';
import type { ObstaclePreset } from '../types/course';
import {
  OBSTACLE_PRESETS,
  analyzeCourse,
  courseToShareToken,
} from '../utils/course';
import { courseToDataUrl } from '../utils/drawing';
import { downloadJudgeSheet, openPrintableCourse } from '../utils/exports';

export function DesignerView() {
  const course = useCourseStore((state) => state.course);
  const selectedId = useCourseStore((state) => state.selectedId);
  const snapEnabled = useCourseStore((state) => state.snapEnabled);
  const gridVisible = useCourseStore((state) => state.gridVisible);
  const options = useCourseStore((state) => state.routeOptions);
  const history = useCourseStore((state) => state.history);
  const future = useCourseStore((state) => state.future);
  const store = useCourseStore();
  const [placementPreset, setPlacementPreset] = useState<ObstaclePreset | null>(null);
  const [customColor, setCustomColor] = useState(OBSTACLE_PRESETS[0].color);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState(course.name);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');

  const selected = course.obstacles.find((item) => item.id === selectedId) ?? null;
  const selectedIndex = selected ? course.sequence.indexOf(selected.id) : -1;
  const analysis = useMemo(() => analyzeCourse(course), [course]);

  const handleDuplicate = () => {
    if (!selected) return;
    store.addObstacle(
      {
        kind: selected.kind,
        name: selected.name,
        width: selected.width,
        spread: selected.spread,
        height: selected.height,
        color: selected.color,
      },
      selected.x + 3,
      selected.y - 3,
    );
  };

  const handleShare = async () => {
    const token = courseToShareToken(course);
    const url = `${window.location.origin}${window.location.pathname}#course=${token}`;
    setShareText(url);
    setShareOpen(true);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard access can be unavailable in file preview or privacy modes.
    }
  };

  return (
    <div className="designer-layout">
      <aside className="tool-rail panel-surface">
        <Text className="eyebrow">障碍库</Text>
        <Text className="rail-title">选择后点击场地</Text>
        <Stack gap={8} mt="md">
          <button
            className={`tool-card ${placementPreset === null ? 'active' : ''}`}
            onClick={() => setPlacementPreset(null)}
          >
            <MousePointer2 size={18} />
            <span><b>选择 / 移动</b><small>拖动障碍并调整布局</small></span>
          </button>
          {OBSTACLE_PRESETS.map((preset) => (
            <button
              key={preset.kind}
              className={`tool-card ${placementPreset?.kind === preset.kind ? 'active' : ''}`}
              onClick={() => {
                setPlacementPreset({ ...preset, color: customColor });
                setCustomColor(preset.color);
              }}
            >
              <span className="obstacle-swatch" style={{ background: customColor || preset.color }} />
              <span><b>{preset.name}</b><small>{preset.width} m · 高 {preset.height} cm</small></span>
            </button>
          ))}
        </Stack>
        <Divider my="md" />
        <Text size="xs" fw={700} c="dimmed" mb={7}>障碍默认颜色</Text>
        <div className="color-grid">
          {['#d94841', '#2563eb', '#f59e0b', '#1596a6', '#7c3aed', '#2f855a'].map((color) => (
            <button
              key={color}
              aria-label={`使用颜色 ${color}`}
              className={`color-dot ${customColor === color ? 'active' : ''}`}
              style={{ background: color }}
              onClick={() => {
                setCustomColor(color);
                setPlacementPreset((previous) => previous ? { ...previous, color } : previous);
              }}
            />
          ))}
        </div>
        <Divider my="md" />
        <Switch
          label="栅格吸附"
          checked={snapEnabled}
          onChange={store.toggleSnap}
          size="sm"
        />
        <Switch
          mt={10}
          label="显示栅格"
          checked={gridVisible}
          onChange={store.toggleGrid}
          size="sm"
        />
      </aside>

      <main className="workspace-column">
        <div className="course-toolbar panel-surface">
          <Group gap="sm" wrap="nowrap">
            <TextInput
              aria-label="路线名称"
              variant="unstyled"
              className="course-name-input"
              value={course.name}
              onChange={(event) => store.setCourseName(event.currentTarget.value)}
            />
            <Badge variant="light" color={analysis.score > 80 ? 'teal' : 'yellow'}>
              稳定度 {analysis.score}
            </Badge>
          </Group>
          <Group gap={6} wrap="nowrap">
            <Tooltip label="撤销">
              <ActionIcon variant="default" onClick={store.undo} disabled={!history.length}><Undo2 size={17} /></ActionIcon>
            </Tooltip>
            <Tooltip label="重做">
              <ActionIcon variant="default" onClick={store.redo} disabled={!future.length}><Redo2 size={17} /></ActionIcon>
            </Tooltip>
            <Button
              variant={placementPreset ? 'filled' : 'light'}
              leftSection={<WandSparkles size={16} />}
              onClick={() => {
                store.generateOptions();
                setGeneratorOpen(true);
              }}
            >
              自动生成路线
            </Button>
            <Button variant="light" leftSection={<Save size={16} />} onClick={() => { setSaveName(course.name); setSaveOpen(true); }}>
              保存
            </Button>
            <Tooltip label="复制分享链接"><ActionIcon variant="default" onClick={handleShare}><Share2 size={17} /></ActionIcon></Tooltip>
          </Group>
        </div>

        <div className="arena-stage panel-surface">
          <ArenaCanvas
            course={course}
            selectedId={selectedId}
            highlightedIds={analysis.issues.flatMap((issue) => issue.obstacleIds)}
            gridVisible={gridVisible}
            placementPreset={placementPreset}
            onSelect={store.select}
            onMove={store.moveObstacle}
            onPlace={store.addObstacle}
          />
          <div className="arena-statusbar">
            <Group gap="lg">
              <Text size="xs"><b>{course.arena.width} × {course.arena.length} m</b> {course.arena.surface}</Text>
              <Text size="xs">步幅 {course.horse.stepLength} m</Text>
              <Text size="xs">接近 {course.horse.approach} m</Text>
              <Text size="xs">落地 {course.horse.landing} m</Text>
            </Group>
            <Group gap="xs">
              <Grid3X3 size={13} />
              <Text size="xs">栅格 {course.gridSize} m</Text>
            </Group>
          </div>
        </div>
      </main>

      <aside className="right-panel panel-surface">
        <Tabs defaultValue="inspect" className="right-tabs">
          <Tabs.List grow>
            <Tabs.Tab value="inspect">障碍</Tabs.Tab>
            <Tabs.Tab value="analysis">路线分析</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="inspect" pt="md">
            <ScrollArea h="100%" offsetScrollbars>
              <ObstacleInspector
                course={course}
                obstacle={selected}
                sequenceIndex={selectedIndex}
                onUpdate={(patch) => selected && store.updateObstacle(selected.id, patch)}
                onMoveSequence={(direction) => selected && store.moveInSequence(selected.id, direction)}
                onRemove={() => selected && store.removeObstacle(selected.id)}
                onDuplicate={handleDuplicate}
              />
              <Divider my="lg" />
              <Text fw={800} size="sm" mb="sm">马匹与场地参数</Text>
              <Stack gap="sm">
                <Select
                  label="场地类型"
                  value={course.arena.surface}
                  data={['纤维沙场地', '室外草地', '室内沙地', '训练场']}
                  onChange={(value) => value && store.setArena({ surface: value })}
                />
                <Group grow>
                  <NumberInput
                    label="场地宽 (m)"
                    value={course.arena.width}
                    min={40}
                    max={100}
                    onChange={(value) => store.setArena({ width: Number(value) || 60 })}
                  />
                  <NumberInput
                    label="场地长 (m)"
                    value={course.arena.length}
                    min={60}
                    max={140}
                    onChange={(value) => store.setArena({ length: Number(value) || 90 })}
                  />
                </Group>
                <TextInput
                  label="马匹档案"
                  value={course.horse.name}
                  onChange={(event) => store.setHorse({ name: event.currentTarget.value })}
                />
                <Group grow>
                  <NumberInput
                    label="步幅 (m)"
                    value={course.horse.stepLength}
                    min={2.6}
                    max={4.5}
                    step={0.1}
                    decimalScale={1}
                    onChange={(value) => store.setHorse({ stepLength: Number(value) || 3.5 })}
                  />
                  <NumberInput
                    label="栅格 (m)"
                    value={course.gridSize}
                    min={0.5}
                    max={5}
                    step={0.5}
                    decimalScale={1}
                    onChange={(value) => store.setGridSize(Number(value) || 2)}
                  />
                </Group>
                <Group grow>
                  <NumberInput
                    label="接近段 (m)"
                    value={course.horse.approach}
                    min={0.5}
                    max={4}
                    step={0.1}
                    decimalScale={1}
                    onChange={(value) => store.setHorse({ approach: Number(value) || 1.8 })}
                  />
                  <NumberInput
                    label="落地段 (m)"
                    value={course.horse.landing}
                    min={0.5}
                    max={4}
                    step={0.1}
                    decimalScale={1}
                    onChange={(value) => store.setHorse({ landing: Number(value) || 1.6 })}
                  />
                </Group>
              </Stack>
            </ScrollArea>
          </Tabs.Panel>
          <Tabs.Panel value="analysis" pt="md">
            <ScrollArea h="100%" offsetScrollbars>
              <AnalysisPanel analysis={analysis} />
            </ScrollArea>
          </Tabs.Panel>
        </Tabs>
        <div className="export-strip">
          <Button
            variant="light"
            fullWidth
            leftSection={<Printer size={16} />}
            onClick={() => openPrintableCourse(course, analysis, courseToDataUrl(course))}
          >
            打印路线图
          </Button>
          <Button
            variant="light"
            fullWidth
            leftSection={<Download size={16} />}
            onClick={() => downloadJudgeSheet(course, analysis)}
          >
            导出裁判表
          </Button>
        </div>
      </aside>

      <Modal opened={generatorOpen} onClose={() => setGeneratorOpen(false)} title="自动生成备选路线" size="lg">
        {options.length === 0 ? (
          <Text c="dimmed">正在计算路线组合与安全检查...</Text>
        ) : (
          <div className="route-option-grid">
            {options.map((option) => (
              <Paper key={option.id} className="route-option-card" p="md" withBorder>
                <Group justify="space-between">
                  <Badge color={option.difficulty === '挑战' ? 'red' : option.difficulty === '进阶' ? 'blue' : 'teal'}>
                    {option.difficulty}
                  </Badge>
                  <Text fw={900}>{option.score} 分</Text>
                </Group>
                <Text fw={800} mt="sm">{option.name}</Text>
                <Text size="xs" c="dimmed" mt={5}>{option.description}</Text>
                <Group mt="md" gap="xs">
                  <Badge variant="light">{option.sequence.length} 跳</Badge>
                  <Badge variant="light">约 {option.estimatedSeconds}s</Badge>
                </Group>
                <Button
                  mt="md"
                  fullWidth
                  variant="light"
                  leftSection={<ArrowLeftRight size={15} />}
                  onClick={() => {
                    store.applyRoute(option.sequence);
                    setGeneratorOpen(false);
                  }}
                >
                  应用这条路线
                </Button>
              </Paper>
            ))}
          </div>
        )}
      </Modal>

      <Modal opened={saveOpen} onClose={() => setSaveOpen(false)} title="保存到路线库">
        <TextInput
          label="路线名称"
          value={saveName}
          onChange={(event) => setSaveName(event.currentTarget.value)}
        />
        <Button
          mt="md"
          fullWidth
          onClick={() => {
            store.saveNamedRoute(saveName.trim() || course.name);
            setSaveOpen(false);
          }}
        >
          保存路线
        </Button>
      </Modal>

      <Modal opened={shareOpen} onClose={() => setShareOpen(false)} title="路线分享链接">
        <Text size="sm" c="dimmed">链接包含当前场地、马匹参数和完整障碍布局。收到链接的教练可直接继续编辑。</Text>
        <Paper withBorder mt="md" p="sm">
          <Text size="xs" className="share-url">{shareText}</Text>
        </Paper>
        <Button
          mt="md"
          leftSection={<Clipboard size={16} />}
          fullWidth
          onClick={() => navigator.clipboard.writeText(shareText)}
        >
          复制链接
        </Button>
      </Modal>
    </div>
  );
}
