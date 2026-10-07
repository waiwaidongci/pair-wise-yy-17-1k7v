import { ActionIcon, Badge, Group, Paper, Stack, Text, Title, Tooltip } from '@mantine/core';
import { FileEdit, Trash2 } from 'lucide-react';
import { useScheduleStore, useScheduleVersion } from '../../stores/scheduleStore';
import type { CoachDraft } from '../../scheduling/types';
import { RESOURCE_LABELS } from '../../scheduling/engine';
import { formatRange } from './time';

interface DraftListProps {
  onEdit: (draft: CoachDraft) => void;
}

/** 草稿清单：草稿不占资源，可以并存多份；提交后才进入排场表 */
export function DraftList({ onEdit }: DraftListProps) {
  const version = useScheduleVersion();
  const snapshot = useScheduleStore.getState().snapshot();
  void version;
  const removeDraft = useScheduleStore((s) => s.removeDraft);

  const drafts = snapshot.drafts;
  if (drafts.length === 0) {
    return (
      <Paper withBorder radius="md" p="lg" className="drafts-empty">
        <Text size="sm" c="dimmed" ta="center">
          还没有草稿。两位教练可以各自起草同一时段，先点「提交排场」的一方先占用。
        </Text>
      </Paper>
    );
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Title order={5}>教练草稿（{drafts.length}）</Title>
        <Text size="xs" c="dimmed">草稿不预占器材</Text>
      </Group>
      {drafts.map((draft) => {
        const route = snapshot.routeCatalog.find((item) => item.id === draft.routeId);
        return (
          <Paper key={draft.id} withBorder radius="md" p="sm" className="draft-row">
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Group gap={6} mb={3}>
                  <Badge variant="light" size="sm">{draft.coach}</Badge>
                  <Text size="sm" fw={750} truncate>{draft.title}</Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {formatRange(draft.start, draft.end)} · {route?.name ?? '未知路线'} ·{' '}
                  {(route?.obstacleKinds ?? [])
                    .reduce<Array<[string, number]>>((acc, kind) => {
                      const last = acc[acc.length - 1];
                      if (last && last[0] === kind) last[1] += 1;
                      else acc.push([kind, 1]);
                      return acc;
                    }, [])
                    .map(([kind, qty]) => `${RESOURCE_LABELS[kind as keyof typeof RESOURCE_LABELS]}×${qty}`)
                    .join('，')}
                </Text>
              </div>
              <Group gap={4} wrap="nowrap">
                <Tooltip label="编辑">
                  <ActionIcon variant="subtle" onClick={() => onEdit(draft)}>
                    <FileEdit size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="删除草稿">
                  <ActionIcon variant="subtle" color="red" onClick={() => removeDraft(draft.id)}>
                    <Trash2 size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
