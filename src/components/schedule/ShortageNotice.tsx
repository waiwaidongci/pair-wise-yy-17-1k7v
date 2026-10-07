import { Alert, Badge, Group, Stack, Text } from '@mantine/core';
import { AlertTriangle } from 'lucide-react';
import type { ShortageReport } from '../../scheduling/types';

/** 待备料提示：每种资源缺多少、被哪些场次占用 */
export function ShortageNotice({
  report,
  mode = 'blocked',
}: {
  report?: ShortageReport;
  mode?: 'blocked' | 'preview';
}) {
  if (!report || report.shortages.length === 0) return null;
  return (
    <Alert
      color="orange"
      variant="light"
      icon={<AlertTriangle size={17} />}
      title={mode === 'preview' ? '当前同时段余量不足，提交后将停在待备料' : '余量不足，已停在「待备料」'}
      className="shortage-alert"
    >
      <Stack gap={8}>
        {report.shortages.map((item) => (
          <div key={item.resource}>
            <Group gap={6}>
              <Badge color="orange" variant="filled" size="sm">
                {item.label}
              </Badge>
              <Text size="xs" span>
                需 <b>{item.required}</b>，余量仅 <b>{item.available}</b>
              </Text>
            </Group>
            {item.holders.length > 0 ? (
              <Text size="xs" c="dimmed" mt={3} ml={4}>
                被同时段场次占用：
                {item.holders.map((holder, index) => (
                  <Text key={`${holder.sessionId}-${index}`} span ml={index > 0 ? 8 : 4}>
                    {index > 0 ? '、' : ''}
                    <b>{holder.title}</b>（{holder.coach}，占 {holder.qty}）
                  </Text>
                ))}
              </Text>
            ) : (
              <Text size="xs" c="dimmed" mt={3} ml={4}>
                库存不足，暂无占用场次
              </Text>
            )}
          </div>
        ))}
      </Stack>
    </Alert>
  );
}
