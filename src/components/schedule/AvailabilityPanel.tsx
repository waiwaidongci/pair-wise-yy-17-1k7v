import { Badge, Group, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { RESOURCE_LABELS } from '../../scheduling/engine';
import type { AvailabilityReport, ResourceKey } from '../../scheduling/types';

/** 某时段的逐资源余量条 */
export function AvailabilityPanel({ report }: { report: AvailabilityReport | null }) {
  if (!report) {
    return (
      <Text size="xs" c="dimmed">
        选择路线和时段后，这里按障碍类型与数量显示同时段余量。
      </Text>
    );
  }
  return (
    <Stack gap={8}>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {new Date(report.start).toLocaleString('zh-CN', { hour12: false })} –{' '}
          {new Date(report.end).toLocaleTimeString('zh-CN', { hour12: false })}
        </Text>
        <Badge color={report.ok ? 'teal' : 'red'} variant="light">
          {report.ok ? '余量充足' : '余量不足'}
        </Badge>
      </Group>
      {report.perResource.map((row) => {
        const value = row.capacity === 0 ? 0 : Math.max(0, Math.min(100, (row.used / row.capacity) * 100));
        const tight = row.required > row.remaining;
        return (
          <Tooltip
            key={row.resource}
            label={`需 ${row.required} · 已占 ${row.used} · 余 ${row.remaining} / 共 ${row.capacity}`}
            withArrow
          >
            <div>
              <Group justify="space-between" mb={2}>
                <Text size="xs" fw={700}>
                  {RESOURCE_LABELS[row.resource as ResourceKey]}
                  <Text span c="dimmed" ml={6}>
                    需 {row.required}
                  </Text>
                </Text>
                <Text size="xs" c={tight ? 'red' : 'dimmed'} fw={700}>
                  余 {row.remaining}/{row.capacity}
                </Text>
              </Group>
              <Progress
                value={value}
                color={row.remaining === 0 ? 'red' : tight ? 'orange' : 'teal'}
                size={8}
                radius="xl"
              />
            </div>
          </Tooltip>
        );
      })}
    </Stack>
  );
}
