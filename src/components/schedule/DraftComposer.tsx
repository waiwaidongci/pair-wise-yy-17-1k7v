import { useMemo, useState } from 'react';
import {
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Send } from 'lucide-react';
import { useScheduleStore, useScheduleVersion } from '../../stores/scheduleStore';
import type { CoachDraft, SubmitResult } from '../../scheduling/types';
import { AvailabilityPanel } from './AvailabilityPanel';
import { ShortageNotice } from './ShortageNotice';
import { fromInputValue, toInputValue } from './time';

const COACHES = ['王教练', '李教练', '赵教练'];

interface DraftComposerProps {
  editing: CoachDraft | null;
  onDone: () => void;
  onResult: (result: SubmitResult, draftLabel: string) => void;
}

/** 教练草稿工作台：保存草稿不占资源；提交时才查余量并预占 */
export function DraftComposer({ editing, onDone, onResult }: DraftComposerProps) {
  const version = useScheduleVersion();
  const snapshot = useScheduleStore.getState().snapshot();
  const saveDraft = useScheduleStore((s) => s.saveDraft);
  const submitDraft = useScheduleStore((s) => s.submitDraft);
  const availability = useScheduleStore((s) => s.availability);

  const [coach, setCoach] = useState(editing?.coach ?? COACHES[0]);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [routeId, setRouteId] = useState(editing?.routeId ?? snapshot.routeCatalog[0]?.id ?? '');
  const [start, setStart] = useState(toInputValue(editing?.start ?? fromInputValue('14:00')));
  const [end, setEnd] = useState(toInputValue(editing?.end ?? fromInputValue('15:30')));
  const [useArenaOverride, setUseArenaOverride] = useState(Boolean(editing?.arenaOverride));
  const [arenaW, setArenaW] = useState<number>(editing?.arenaOverride?.width ?? 60);
  const [arenaL, setArenaL] = useState<number>(editing?.arenaOverride?.length ?? 90);
  const [useStrideOverride, setUseStrideOverride] = useState(editing?.strideOverride !== undefined);
  const [stride, setStride] = useState<number>(editing?.strideOverride ?? 3.5);
  const [busy, setBusy] = useState(false);

  const routeOptions = snapshot.routeCatalog.map((route) => ({
    value: route.id,
    label: `${route.name}（${route.obstacleKinds.length} 道）`,
  }));

  const previewRequest = useMemo(
    () => ({
      start: fromInputValue(start),
      end: fromInputValue(end),
      routeId,
      arenaOverride: useArenaOverride ? { width: arenaW, length: arenaL } : undefined,
      strideOverride: useStrideOverride ? stride : undefined,
    }),
    [start, end, routeId, useArenaOverride, arenaW, arenaL, useStrideOverride, stride],
  );

  const report = useMemo(
    () => (routeId ? availability(previewRequest) : null),
    // availability 依赖引擎当前状态；version 变化时重算
    [availability, previewRequest, routeId, version],
  );

  const invalidTime = fromInputValue(end) <= fromInputValue(start);

  async function handleSubmit() {
    if (!routeId || !title.trim() || invalidTime) return;
    setBusy(true);
    try {
      const draft = await saveDraft({
        id: editing?.id,
        coach,
        title: title.trim(),
        start: fromInputValue(start),
        end: fromInputValue(end),
        routeId,
        arenaOverride: useArenaOverride ? { width: arenaW, length: arenaL } : undefined,
        strideOverride: useStrideOverride ? stride : undefined,
      });
      const result = await submitDraft(draft.id);
      onResult(result, draft.title);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md" className="composer-card">
      <Title order={4} mb="sm">
        {editing ? '编辑草稿' : '新训练草稿'}
      </Title>
      <Stack gap="xs">
        <Group grow>
          <Select
            label="教练"
            data={COACHES}
            value={coach}
            onChange={(value) => value && setCoach(value)}
            allowDeselect={false}
          />
          <TextInput
            label="场次名称"
            placeholder="如：周六进阶场地课"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </Group>
        <Select
          label="选定路线"
          data={routeOptions}
          value={routeId}
          onChange={(value) => value && setRouteId(value)}
          allowDeselect={false}
          searchable
        />
        <Group grow>
          <TextInput
            type="time"
            label="开始（10/08）"
            value={start}
            onChange={(event) => setStart(event.currentTarget.value)}
          />
          <TextInput
            type="time"
            label="结束（10/08）"
            value={end}
            onChange={(event) => setEnd(event.currentTarget.value)}
            error={invalidTime ? '结束须晚于开始' : undefined}
          />
        </Group>

        <Switch
          mt={4}
          label="本场改用不同场地尺寸"
          checked={useArenaOverride}
          onChange={(event) => setUseArenaOverride(event.currentTarget.checked)}
          size="xs"
        />
        {useArenaOverride && (
          <Group grow>
            <NumberInput label="场地宽 (m)" value={arenaW} onChange={(v) => setArenaW(Number(v) || 60)} min={20} />
            <NumberInput label="场地长 (m)" value={arenaL} onChange={(v) => setArenaL(Number(v) || 90)} min={20} />
          </Group>
        )}
        <Switch
          label="本场改用不同马匹步幅"
          checked={useStrideOverride}
          onChange={(event) => setUseStrideOverride(event.currentTarget.checked)}
          size="xs"
        />
        {useStrideOverride && (
          <NumberInput
            label="步幅 (m)"
            value={stride}
            onChange={(v) => setStride(Number(v) || 3.5)}
            step={0.1}
            decimalScale={1}
            min={2}
            max={6}
          />
        )}

        <Paper bg="#f8fafc" withBorder p="sm" radius="sm" mt={6}>
          <Text className="panel-subtitle" mt={0} mb={8}>
            同时段余量（提交前预检）
          </Text>
          <AvailabilityPanel report={report} />
        </Paper>

        <ShortageNotice mode="preview" report={report?.ok ? undefined : { shortages: report?.shortages ?? [] }} />

        <Group justify="flex-end" mt="sm">
          <Button variant="subtle" color="gray" onClick={onDone}>
            {editing ? '取消' : '收起'}
          </Button>
          <Button
            leftSection={<Send size={15} />}
            onClick={handleSubmit}
            loading={busy}
            disabled={!routeId || !title.trim() || invalidTime}
          >
            查余量并提交排场
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
