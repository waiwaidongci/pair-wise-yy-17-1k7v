import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Paper, Stack, Table, Tabs, Text, Tooltip } from '@mantine/core';
import { Copy, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { useScheduleStore, useScheduleVersion } from '../../stores/scheduleStore';
import { RESOURCE_LABELS } from '../../scheduling/engine';
import type { ResourceKey, SubmitResult, TrainingSession } from '../../scheduling/types';
import { formatRange } from './time';
import { ShortageNotice } from './ShortageNotice';

interface SessionCardProps {
  session: TrainingSession;
  onResult: (result: SubmitResult) => void;
  onCopy: (session: TrainingSession) => void;
}

function summarizeKinds(kinds: ResourceKey[]): string {
  const counts = new Map<ResourceKey, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [
    ...Array.from(counts.entries()).map(([kind, qty]) => `${RESOURCE_LABELS[kind]}×${qty}`),
    `${RESOURCE_LABELS.arena}×1`,
  ].join('，');
}

/** 单场排场：状态、占用、待备料原因、安全分析 / 裁判表的失效与重算 */
export function SessionCard({ session, onResult, onCopy }: SessionCardProps) {
  const version = useScheduleVersion();
  const snapshot = useScheduleStore.getState().snapshot();
  void version;
  const cancelSession = useScheduleStore((s) => s.cancelSession);
  const reviseSession = useScheduleStore((s) => s.reviseSession);
  const getSafety = useScheduleStore((s) => s.getSafety);
  const getJudge = useScheduleStore((s) => s.getJudge);
  const isSafetyStale = useScheduleStore((s) => s.isSafetyStale)(session.id);
  const isJudgeStale = useScheduleStore((s) => s.isJudgeStale)(session.id);
  const [tab, setTab] = useState<string | null>('safety');

  const route = snapshot.routeCatalog.find((item) => item.id === session.routeId);
  const confirmed = session.status === 'confirmed';
  const safety = getSafety(session.id);
  const judge = getJudge(session.id);

  return (
    <Paper withBorder radius="md" p="sm" className={`session-card ${confirmed ? 'is-confirmed' : 'is-pending'}`}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div style={{ minWidth: 0 }}>
          <Group gap={6} mb={4}>
            <Badge color={confirmed ? 'teal' : 'orange'} variant="filled" size="sm">
              {confirmed ? '已确认 · 已预占' : '待备料'}
            </Badge>
            <Badge variant="light" size="sm">{session.coach}</Badge>
            <Text fw={800} size="sm">{session.title}</Text>
          </Group>
          <Text size="xs" c="dimmed">
            {formatRange(session.start, session.end)} · {route?.name ?? '未知路线'}
            {session.arenaOverride ? ` · 场地 ${session.arenaOverride.width}×${session.arenaOverride.length}` : ''}
            {session.strideOverride !== undefined ? ` · 步幅 ${session.strideOverride}m` : ''}
          </Text>
          <Text size="xs" c="dimmed" mt={3}>
            预占：{summarizeKinds(route?.obstacleKinds ?? [])}
          </Text>
        </div>
        <Group gap={2} wrap="nowrap">
          <Tooltip label="复制到新时段">
            <ActionIcon variant="subtle" onClick={() => onCopy(session)}>
              <Copy size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="取消并归还器材">
            <ActionIcon variant="subtle" color="red" onClick={() => cancelSession(session.id)}>
              <Trash2 size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {!confirmed && session.blockedBy && (
        <Stack mt={8} gap={6}>
          <ShortageNotice report={session.blockedBy} />
          <Button
            size="xs"
            variant="light"
            style={{ alignSelf: 'flex-start' }}
            leftSection={<RefreshCw size={13} />}
            onClick={async () => onResult(await reviseSession(session.id, {}))}
          >
            重新检查余量
          </Button>
        </Stack>
      )}

      <Paper mt={10} bg="#f8fafc" withBorder radius="sm" className="artifact-panel">
        <Tabs value={tab} onChange={setTab} variant="outline">
          <Tabs.List>
            <Tabs.Tab
              value="safety"
              leftSection={<ShieldAlert size={13} />}
              rightSection={isSafetyStale ? <Badge color="red" size="xs" variant="filled" circle>!</Badge> : null}
            >
              安全分析
            </Tabs.Tab>
            <Tabs.Tab
              value="judge"
              rightSection={isJudgeStale ? <Badge color="red" size="xs" variant="filled" circle>!</Badge> : null}
            >
              裁判表
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="safety" p="sm">
            {!safety ? (
              <Text size="xs" c="dimmed">该路线没有完整图纸，暂无安全分析。请在「路线库」同步一条设计器路线。</Text>
            ) : (
              <Stack gap={4}>
                <Group justify="space-between">
                  <Badge color={safety.artifact.score >= 80 ? 'teal' : 'yellow'} variant="light">
                    评分 {safety.artifact.score}
                  </Badge>
                  <Text size="10px" c="dimmed">
                    {isSafetyStale
                      ? '时间/场地/步幅/路线已改，待重算'
                      : `已算于 ${new Date(safety.artifact.computedAt).toLocaleTimeString('zh-CN', { hour12: false })}`}
                  </Text>
                </Group>
                <Text size="xs">
                  总距离 {safety.artifact.totalDistance} m · 预计 {safety.artifact.estimatedSeconds}s · 风险{' '}
                  {safety.artifact.issueCount} 条
                </Text>
                <Text size="xs" c="dimmed">{safety.artifact.summary}</Text>
              </Stack>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="judge" p="sm">
            {!judge ? (
              <Text size="xs" c="dimmed">该路线没有完整图纸，暂无裁判表。</Text>
            ) : (
              <Table horizontalSpacing={6} verticalSpacing={3} className="judge-mini-table">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>次</Table.Th>
                    <Table.Th>障碍</Table.Th>
                    <Table.Th>高</Table.Th>
                    <Table.Th>距</Table.Th>
                    <Table.Th>步</Table.Th>
                    <Table.Th>转</Table.Th>
                    <Table.Th>判定</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {judge.rows.map((row) => (
                    <Table.Tr key={row.number}>
                      <Table.Td>{row.number}</Table.Td>
                      <Table.Td>{row.obstacle}</Table.Td>
                      <Table.Td>{row.height}</Table.Td>
                      <Table.Td>{row.distance}</Table.Td>
                      <Table.Td>
                        {row.strides}/{row.recommended}
                      </Table.Td>
                      <Table.Td>{row.turn}°</Table.Td>
                      <Table.Td>{row.verdict}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Tabs.Panel>
        </Tabs>
      </Paper>
    </Paper>
  );
}
