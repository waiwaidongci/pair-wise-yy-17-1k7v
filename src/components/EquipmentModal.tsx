import {
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { useScheduleStore } from '../stores/scheduleStore';
import { EQUIPMENT_KINDS, EQUIPMENT_LABELS } from '../utils/schedule';

interface EquipmentModalProps {
  opened: boolean;
  onClose: () => void;
}

export function EquipmentModal({ opened, onClose }: EquipmentModalProps) {
  const equipment = useScheduleStore((state) => state.equipment);
  const setEquipmentStock = useScheduleStore((state) => state.setEquipmentStock);

  return (
    <Modal opened={opened} onClose={onClose} title="器材清单" size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          俱乐部只有一套障碍器材，按类型计数。排场时按障碍类型与数量预占，同时段余量不足则该场停在待备料。
        </Text>
        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>器材类型</Table.Th>
              <Table.Th>总数量（件）</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {EQUIPMENT_KINDS.map((kind) => (
              <Table.Tr key={kind}>
                <Table.Td>{EQUIPMENT_LABELS[kind]}</Table.Td>
                <Table.Td>
                  <NumberInput
                    value={equipment[kind]}
                    min={0}
                    max={99}
                    step={1}
                    w={90}
                    onChange={(value) => setEquipmentStock(kind, Number(value) || 0)}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group justify="flex-end">
          <Button onClick={onClose}>完成</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
