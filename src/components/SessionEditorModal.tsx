import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Collapse,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { AlertTriangle, CheckCircle2, ClipboardList, RotateCcw, Save, Undo2 } from 'lucide-react';
import { useScheduleStore } from '../stores/scheduleStore';
import { useCourseStore } from '../stores/courseStore';
import {
  EQUIPMENT_KINDS,
  EQUIPMENT_LABELS,
  availabilityForSession,
  getSessionAnalysis,
  sessionInputHash,
} from '../utils/schedule';
import { downloadJudgeSheet } from '../utils/exports';
import type { SubmitResult } from '../types/schedule';

interface SessionEditorModalProps {
  opened: boolean;
  sessionId: string | null;
  onClose: () => void;
}

export function SessionEditorModal({ opened, sessionId, onClose }: SessionEditorModalProps) {
  const sessions = useScheduleStore((state) => state.sessions);
  const equipment = useScheduleStore((state) => state.equipment);
  const updateSession = useScheduleStore((state) => state.updateSession);
  const submitSession = useScheduleStore((state) => state.submitSession);
  const releaseSession = useScheduleStore((state) => state.releaseSession);
  const ensureAnalysis = useScheduleStore((state) => state.ensureAnalysis);
  const savedRoutes = useCourseStore((state) => state.savedRoutes);
  const currentCourse = useCourseStore((state) => state.course);

  const [simulateFailure, setSimulateFailure] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [paramsOpen, setParamsOpen] = useState(false);

  const session = sessions.find((item) => item.id === sessionId) ?? null;

  const availability = useMemo(
    () => (session ? availabilityForSession(session, sessions, equipment) : []),
    [session, sessions, equipment],
  );
  const analysis = useMemo(() => (session ? getSessionAnalysis(session) : null), [session]);
  const stale = session ? session.analysisHash !== sessionInputHash(session) : false;

  // 路线 / 时间 / 场地 / 马匹改动后，失效分析自动重算
  useEffect(() => {
    if (opened && sessionId) ensureAnalysis(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, sessionId, session?.analysisHash]);

  useEffect(() => {
    if (opened) setResult(null);
  }, [opened, sessionId]);

  if (!session) return null;

  const occupiedBy = session.conflictSessionId
    ? sessions.find((item) => item.id === session.conflictSessionId)
    : null;

  const routeOptions = [
    { value: '__current__', label: '当前设计中的路线' },
    ...savedRoutes.map((route) => ({ value: route.id, label: route.name })),
  ];

  const patch = (next: Partial<typeof session>) => updateSession(session.id, next);

  const handlePickRoute = (routeId: string | null) => {
    if (!routeId) return;
    if (routeId === '__current__') {
      patch({ routeId: null, routeName: currentCourse.name, course: structuredClone(currentCourse) });
      return;
    }
    const route = savedRoutes.find((item) => item.id === routeId);
    if (route) {
      patch({ routeId: route.id, routeName: route.name, course: structuredClone(route.course) });
    }
  };

  const handleSubmit = () => {
    const res = submitSession(session.id, simulateFailure);
    setResult(res);
  };

  const handleRelease = () => {
    const res = releaseSession(session.id, simulateFailure);
    setResult(res);
  };

  const statusMeta = {
    draft: { label: '草稿', color: 'gray' },
    pending: { label: '待备料', color: 'red' },
    scheduled: { label: '已排定', color: 'teal' },
    cancelled: { label: '已取消', color: 'gray' },
  } as const;

  return (
    <Modal opened={opened} onClose={onClose} title="训练场次排场" size="lg" centered>
      <Stack gap="md">
        <Group justify="space-between">
          <Badge color={statusMeta[session.status].color} size="lg" variant="light">
            {statusMeta[session.status].label}
          </Badge>
          <Text size="xs" c="dimmed">
            提交时按障碍类型与数量预占器材，先交先得
          </Text>
        </Group>

        {session.status === 'pending' && (
          <Alert icon={<AlertTriangle size={18} />} color="red" title="器材不足，已停在待备料">
            <Text size="sm">{session.conflictDetail}</Text>
            {occupiedBy && (
              <Text size="xs" mt={6} c="dimmed">
                占用场次：{occupiedBy.name}（{occupiedBy.coach} 教练）· {occupiedBy.date} {occupiedBy.startTime}-{occupiedBy.endTime}
              </Text>
            )}
            <Button size="xs" mt="sm" color="red" variant="light" leftSection={<RotateCcw size={14} />} onClick={handleSubmit}>
              重新提交
            </Button>
          </Alert>
        )}

        {result && result.ok && (
          <Alert icon={<CheckCircle2 size={18} />} color="teal" title={session.status === 'draft' ? '器材已归还' : '排场成功'}>
            <Text size="sm">
              {session.status === 'draft'
                ? '器材已归还，场次回到草稿。'
                : '器材已按本场所需预占，重试不会重复扣减。'}
            </Text>
          </Alert>
        )}
        {result && !result.ok && result.reason === 'error' && (
          <Alert icon={<Undo2 size={18} />} color="orange" title="已回滚到提交前">
            <Text size="sm">{result.error}。整场占用已回到提交前状态，可修改后重试。</Text>
          </Alert>
        )}

        <Divider label="基本信息" labelPosition="left" />
        <Group grow>
          <TextInput label="场次名称" value={session.name} onChange={(e) => patch({ name: e.currentTarget.value })} />
          <TextInput label="教练" value={session.coach} onChange={(e) => patch({ coach: e.currentTarget.value })} />
        </Group>
        <Group grow>
          <TextInput label="日期" type="date" value={session.date} onChange={(e) => patch({ date: e.currentTarget.value })} />
          <TextInput label="开始" type="time" value={session.startTime} onChange={(e) => patch({ startTime: e.currentTarget.value })} />
          <TextInput label="结束" type="time" value={session.endTime} onChange={(e) => patch({ endTime: e.currentTarget.value })} />
        </Group>

        <Divider label="选择路线" labelPosition="left" />
        <Select
          label="路线"
          data={routeOptions}
          value={session.routeId ?? '__current__'}
          onChange={handlePickRoute}
          leftSection={<ClipboardList size={16} />}
        />
        <Group gap={6}>
          {EQUIPMENT_KINDS.map((kind) => {
            const count = session.course.sequence.filter(
              (id) => session.course.obstacles.find((o) => o.id === id)?.kind === kind,
            ).length;
            if (count === 0) return null;
            return (
              <Badge key={kind} variant="light" color="indigo">
                {EQUIPMENT_LABELS[kind]} × {count}
              </Badge>
            );
          })}
        </Group>

        <Button variant="subtle" size="xs" onClick={() => setParamsOpen((v) => !v)}>
          {paramsOpen ? '收起场地与马匹参数' : '调整场地与马匹参数'}
        </Button>
        <Collapse in={paramsOpen}>
          <Stack gap="sm">
            <Group grow>
              <NumberInput
                label="场地宽 (m)"
                value={session.course.arena.width}
                min={40}
                max={100}
                onChange={(v) => patch({ course: { ...session.course, arena: { ...session.course.arena, width: Number(v) || 60 } } })}
              />
              <NumberInput
                label="场地长 (m)"
                value={session.course.arena.length}
                min={60}
                max={140}
                onChange={(v) => patch({ course: { ...session.course, arena: { ...session.course.arena, length: Number(v) || 90 } } })}
              />
            </Group>
            <Group grow>
              <NumberInput
                label="步幅 (m)"
                value={session.course.horse.stepLength}
                min={2.6}
                max={4.5}
                step={0.1}
                decimalScale={1}
                onChange={(v) => patch({ course: { ...session.course, horse: { ...session.course.horse, stepLength: Number(v) || 3.5 } } })}
              />
              <NumberInput
                label="接近段 (m)"
                value={session.course.horse.approach}
                min={0.5}
                max={4}
                step={0.1}
                decimalScale={1}
                onChange={(v) => patch({ course: { ...session.course, horse: { ...session.course.horse, approach: Number(v) || 1.8 } } })}
              />
              <NumberInput
                label="落地段 (m)"
                value={session.course.horse.landing}
                min={0.5}
                max={4}
                step={0.1}
                decimalScale={1}
                onChange={(v) => patch({ course: { ...session.course, horse: { ...session.course.horse, landing: Number(v) || 1.6 } } })}
              />
            </Group>
          </Stack>
        </Collapse>

        <Divider label="同时段器材余量" labelPosition="left" />
        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>类型</Table.Th>
              <Table.Th>本场所需</Table.Th>
              <Table.Th>同时段已占</Table.Th>
              <Table.Th>可用</Table.Th>
              <Table.Th>总量</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {availability.map((row) => (
              <Table.Tr key={row.kind}>
                <Table.Td>{row.label}</Table.Td>
                <Table.Td>{row.required}</Table.Td>
                <Table.Td>{row.reserved}</Table.Td>
                <Table.Td>
                  <Badge color={row.shortage > 0 ? 'red' : 'teal'} variant="light">
                    {row.available}
                    {row.shortage > 0 ? ` (缺 ${row.shortage})` : ''}
                  </Badge>
                </Table.Td>
                <Table.Td>{row.total}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Divider label="安全分析与裁判表" labelPosition="left" />
        {analysis && (
          <Paper withBorder p="sm">
            <Group justify="space-between">
              <Group gap="xs">
                <Text fw={800} size="lg">{analysis.score}</Text>
                <Text size="xs" c="dimmed">/100 稳定度</Text>
                {stale && <Badge size="xs" color="yellow">已失效，重算中</Badge>}
              </Group>
              <Group gap="xs">
                <Badge variant="light" color={analysis.issues.some((i) => i.level === 'error') ? 'red' : analysis.issues.some((i) => i.level === 'warning') ? 'yellow' : 'teal'}>
                  {analysis.issues.length} 项风险
                </Badge>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => downloadJudgeSheet(session.course, analysis)}
                >
                  导出裁判表
                </Button>
              </Group>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              总距离 {analysis.totalDistance} m · 预计 {analysis.estimatedSeconds}s
            </Text>
          </Paper>
        )}

        <Divider />
        <Group justify="space-between">
          <Switch
            label="模拟保存失败（验证回滚）"
            checked={simulateFailure}
            onChange={(e) => setSimulateFailure(e.currentTarget.checked)}
            size="sm"
          />
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>关闭</Button>
            {session.status === 'scheduled' && (
              <Button color="orange" variant="light" leftSection={<Undo2 size={15} />} onClick={handleRelease}>
                归还器材
              </Button>
            )}
            {session.status === 'pending' ? (
              <Button color="red" leftSection={<RotateCcw size={15} />} onClick={handleSubmit}>
                重新提交
              </Button>
            ) : (
              <Button leftSection={<Save size={15} />} onClick={handleSubmit}>
                提交占器材
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
