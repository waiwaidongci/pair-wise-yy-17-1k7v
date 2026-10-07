import { useState } from 'react';
import {
  Button,
  Divider,
  Group,
  NumberInput,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { DatabaseZap, PackageCheck, RotateCcw, Zap } from 'lucide-react';
import { useScheduleStore, useScheduleVersion } from '../../stores/scheduleStore';
import { ARENA, RESOURCE_LABELS } from '../../scheduling/engine';
import { seedTime } from '../../scheduling/seed';
import type { ResourceKey } from '../../scheduling/types';

/** 器材清单：场馆固定 1，其余按类型可调库存 */
function EquipmentEditor() {
  const version = useScheduleVersion();
  const snapshot = useScheduleStore.getState().snapshot();
  void version;
  const setCount = useScheduleStore((s) => s.setEquipmentCount);

  return (
    <Paper withBorder radius="md" p="md">
      <Group gap={6} mb="xs">
        <PackageCheck size={15} />
        <Title order={5}>器材清单（库存）</Title>
      </Group>
      <Stack gap={6}>
        {snapshot.equipment.map((item) => (
          <Group key={item.kind} justify="space-between" wrap="nowrap">
            <Text size="sm" fw={item.kind === ARENA ? 800 : 500}>
              {RESOURCE_LABELS[item.kind]}
              {item.kind === ARENA && (
                <Text span c="dimmed" size="xs" ml={6}>
                  唯一场地
                </Text>
              )}
            </Text>
            {item.kind === ARENA ? (
              <Tooltip label="俱乐部只有一个场地，容量固定为 1">
                <NumberInput value={1} w={70} readOnly size="xs" />
              </Tooltip>
            ) : (
              <NumberInput
                value={item.count}
                w={70}
                min={0}
                max={20}
                size="xs"
                onChange={(value) => setCount(item.kind as ResourceKey, Number(value) || 0)}
              />
            )}
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}

function FaultPanel() {
  const setFaults = useScheduleStore((s) => s.setFaults);
  const [failReturn, setFailReturn] = useState(false);
  const [failPersist, setFailPersist] = useState(false);

  function toggle(nextReturn: boolean, nextPersist: boolean) {
    setFailReturn(nextReturn);
    setFailPersist(nextPersist);
    setFaults({ failEquipmentReturn: nextReturn, failPersist: nextPersist });
  }

  return (
    <Paper withBorder radius="md" p="md" className="fault-panel">
      <Group gap={6} mb="xs">
        <Zap size={15} />
        <Title order={5}>故障注入（验证回滚）</Title>
      </Group>
      <Stack gap={6}>
        <Switch
          size="xs"
          labelPosition="left"
          label="器材归还失败"
          description="改时间/取消时归还抛错，整场回到提交前"
          checked={failReturn}
          onChange={(event) => toggle(event.currentTarget.checked, failPersist)}
        />
        <Switch
          size="xs"
          labelPosition="left"
          label="场次保存失败"
          description="持久化抛错，不产生任何预占"
          checked={failPersist}
          onChange={(event) => toggle(failReturn, event.currentTarget.checked)}
        />
      </Stack>
    </Paper>
  );
}

function RacePanel({ onNoticed }: { onNoticed: (text: string) => void }) {
  const version = useScheduleVersion();
  const snapshot = useScheduleStore.getState().snapshot();
  void version;
  const [busy, setBusy] = useState(false);
  const resetDemo = useScheduleStore((s) => s.resetDemo);

  async function simulateRace() {
    setBusy(true);
    try {
      const store = useScheduleStore.getState();
      const routeId = snapshot.routeCatalog[0]?.id;
      if (!routeId) return;
      const slot = { start: seedTime(16), end: seedTime(17, 30), routeId };
      const wang = await store.saveDraft({ coach: '王教练', title: '王教练抢场', ...slot });
      const li = await store.saveDraft({ coach: '李教练', title: '李教练抢场', ...slot });
      // 同时提交，不 await；队列保证先交（王）先得
      const p1 = store.submitDraft(wang.id, 'race-wang');
      const p2 = store.submitDraft(li.id, 'race-li');
      const [r1, r2] = await Promise.all([p1, p2]);
      onNoticed(
        `并发结果：王教练 ${labelOf(r1.status)}，李教练 ${labelOf(r2.status)}` +
          (r2.shortage
            ? `；李教练看到 ${r2.shortage.shortages[0].holders.map((h) => h.title).join('、')} 已占用，草稿保留`
            : ''),
      );
    } finally {
      setBusy(false);
    }
  }

  async function simulateBatch() {
    setBusy(true);
    try {
      const store = useScheduleStore.getState();
      const [routeA, routeB] = snapshot.routeCatalog;
      if (!routeA || !routeB) return;
      const result = await store.saveMany([
        { title: '批量课一', coach: '赵教练', start: seedTime(18), end: seedTime(19), routeId: routeA.id },
        { title: '批量课二', coach: '赵教练', start: seedTime(18, 30), end: seedTime(20), routeId: routeB.id },
      ]);
      onNoticed(
        result.ok
          ? `批量保存成功：${result.results.length} 场全部确认`
          : `批量整批回滚：${result.shortage ? '同时段资源冲突' : result.error}，未产生任何占用`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Group gap={6} mb="xs">
        <DatabaseZap size={15} />
        <Title order={5}>事务演示</Title>
      </Group>
      <Stack gap={8}>
        <Button size="xs" variant="light" loading={busy} onClick={simulateRace}>
          两教练同时提交抢同一时段
        </Button>
        <Button size="xs" variant="light" color="grape" loading={busy} onClick={simulateBatch}>
          批量保存（其中一场冲突）
        </Button>
        <Divider />
        <Button size="xs" variant="subtle" color="gray" leftSection={<RotateCcw size={13} />} onClick={resetDemo}>
          重置全部演示数据
        </Button>
      </Stack>
    </Paper>
  );
}

function labelOf(status: string): string {
  if (status === 'confirmed') return '占用成功';
  if (status === 'pending_materials') return '待备料';
  if (status === 'rolled_back') return '已回滚';
  return status;
}

export function ScheduleSidebar({ onNoticed }: { onNoticed: (text: string) => void }) {
  return (
    <Stack gap="md">
      <EquipmentEditor />
      <FaultPanel />
      <RacePanel onNoticed={onNoticed} />
    </Stack>
  );
}
