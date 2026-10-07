import {
  ActionIcon,
  Badge,
  Button,
  ColorInput,
  Divider,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { ArrowDown, ArrowUp, Copy, RotateCw, Trash2 } from 'lucide-react';
import type { Course, Obstacle, ObstacleKind } from '../types/course';
import { COLOR_LIBRARY } from '../utils/course';

interface ObstacleInspectorProps {
  course: Course;
  obstacle: Obstacle | null;
  sequenceIndex: number;
  onUpdate: (patch: Partial<Obstacle>) => void;
  onMoveSequence: (direction: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

const kindOptions: Array<{ value: ObstacleKind; label: string }> = [
  { value: 'vertical', label: '单横木' },
  { value: 'oxer', label: '双横木' },
  { value: 'triple', label: '三重横木' },
  { value: 'wall', label: '砖墙' },
  { value: 'water', label: '水障' },
  { value: 'combination', label: '连续组合' },
];

export function ObstacleInspector({
  course,
  obstacle,
  sequenceIndex,
  onUpdate,
  onMoveSequence,
  onRemove,
  onDuplicate,
}: ObstacleInspectorProps) {
  if (!obstacle) {
    return (
      <Paper className="empty-inspector" p="xl">
        <Text fw={700}>尚未选择障碍</Text>
        <Text size="sm" c="dimmed" mt={6}>
          在左侧选择障碍类型后点击场地放置，或直接点击已放置的障碍进行编辑。
        </Text>
      </Paper>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Text fw={800} size="sm">障碍检查器</Text>
          <Text size="xs" c="dimmed">第 {sequenceIndex + 1} 跳 · ID {obstacle.id.slice(-5)}</Text>
        </div>
        <Badge color={obstacle.difficulty === '挑战' ? 'red' : obstacle.difficulty === '进阶' ? 'blue' : 'teal'}>
          {obstacle.difficulty}
        </Badge>
      </Group>

      <TextInput
        label="障碍名称"
        value={obstacle.name}
        onChange={(event) => onUpdate({ name: event.currentTarget.value })}
      />
      <Select
        label="障碍类型"
        data={kindOptions}
        value={obstacle.kind}
        onChange={(value) => value && onUpdate({ kind: value as ObstacleKind })}
      />
      <Group grow>
        <NumberInput
          label="横向宽度 (m)"
          value={obstacle.width}
          min={2}
          max={6}
          step={0.1}
          decimalScale={1}
          onChange={(value) => onUpdate({ width: Number(value) || 0 })}
        />
        <NumberInput
          label="纵深层数 (m)"
          value={obstacle.spread}
          min={0.5}
          max={4}
          step={0.1}
          decimalScale={1}
          onChange={(value) => onUpdate({ spread: Number(value) || 0 })}
        />
      </Group>
      <Group grow>
        <NumberInput
          label="高度 (cm)"
          value={obstacle.height}
          min={30}
          max={160}
          step={5}
          onChange={(value) => onUpdate({ height: Number(value) || 0 })}
        />
        <NumberInput
          label="旋转 (度)"
          value={obstacle.rotation}
          min={-180}
          max={180}
          step={5}
          onChange={(value) => onUpdate({ rotation: Number(value) || 0 })}
        />
      </Group>
      <Group grow>
        <NumberInput
          label="横向坐标"
          value={Number(obstacle.x.toFixed(1))}
          min={0}
          max={course.arena.width}
          step={0.5}
          decimalScale={1}
          onChange={(value) => onUpdate({ x: Number(value) || 0 })}
        />
        <NumberInput
          label="纵向坐标"
          value={Number(obstacle.y.toFixed(1))}
          min={0}
          max={course.arena.length}
          step={0.5}
          decimalScale={1}
          onChange={(value) => onUpdate({ y: Number(value) || 0 })}
        />
      </Group>
      <ColorInput
        label="障碍颜色"
        value={obstacle.color}
        swatches={COLOR_LIBRARY}
        onChange={(value) => onUpdate({ color: value })}
      />

      <Divider />
      <Text size="xs" fw={700} c="dimmed">路线顺序</Text>
      <Group grow>
        <Button
          variant="light"
          leftSection={<ArrowUp size={15} />}
          disabled={sequenceIndex <= 0}
          onClick={() => onMoveSequence(-1)}
        >
          前移一跳
        </Button>
        <Button
          variant="light"
          rightSection={<ArrowDown size={15} />}
          disabled={sequenceIndex < 0 || sequenceIndex >= course.sequence.length - 1}
          onClick={() => onMoveSequence(1)}
        >
          后移一跳
        </Button>
      </Group>
      <Group grow>
        <ActionIcon variant="default" size={36} onClick={() => onUpdate({ rotation: obstacle.rotation + 15 })}>
          <Tooltip label="顺时针旋转 15°"><RotateCw size={17} /></Tooltip>
        </ActionIcon>
        <ActionIcon variant="default" size={36} onClick={onDuplicate}>
          <Tooltip label="复制障碍"><Copy size={17} /></Tooltip>
        </ActionIcon>
        <ActionIcon variant="light" color="red" size={36} onClick={onRemove}>
          <Tooltip label="删除障碍"><Trash2 size={17} /></Tooltip>
        </ActionIcon>
      </Group>
    </Stack>
  );
}

