import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { AlertTriangle, CalendarPlus, Package, Plus, RotateCcw } from 'lucide-react';
import { useScheduleStore } from '../stores/scheduleStore';
import {
  EQUIPMENT_KINDS,
  EQUIPMENT_LABELS,
  HOUR_HEIGHT,
  reservedForSlot,
  timeToMinutes,
  todayString,
} from '../utils/schedule';
import { SessionEditorModal } from '../components/SessionEditorModal';
import { EquipmentModal } from '../components/EquipmentModal';
import type { SessionStatus, TrainingSession } from '../types/schedule';

const DAY_START = 8 * 60; // 08:00
const DAY_END = 20 * 60; // 20:00
const HOURS = Array.from({ length: 13 }, (_, i) => DAY_START / 60 + i);

const statusColor: Record<SessionStatus, string> = {
  draft: 'gray',
  pending: 'red',
  scheduled: 'teal',
  cancelled: 'gray',
};

const statusLabel: Record<SessionStatus, string> = {
  draft: '草稿',
  pending: '待备料',
  scheduled: '已排定',
  cancelled: '已取消',
};

export function ScheduleView() {
  const sessions = useScheduleStore((state) => state.sessions);
  const equipment = useScheduleStore((state) => state.equipment);
  const createSession = useScheduleStore((state) => state.createSession);
  const duplicateSession = useScheduleStore((state) => state.duplicateSession);
  const hydrate = useScheduleStore((state) => state.hydrate);

  const [date, setDate] = useState(todayString());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [equipmentOpen, setEquipmentOpen] = useState(false);

  // 首次进入时从本地加载（含内置样本）
  useEffect(() => {
    hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const daySessions = useMemo(
    () => sessions.filter((item) => item.date === date).sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime)),
    [sessions, date],
  );

  // 当日已排定场次的器材占用（按同时段取峰值）
  const dayReserved = useMemo(() => {
    const scheduled = daySessions.filter((item) => item.status === 'scheduled');
    const peak: Record<string, number> = {};
    scheduled.forEach((session) => {
      const reserved = reservedForSlot(scheduled, session, session.id);
      EQUIPMENT_KINDS.forEach((kind) => {
        peak[kind] = Math.max(peak[kind] ?? 0, reserved[kind] + (session.reserved[kind] ?? 0));
      });
    });
    return peak;
  }, [daySessions]);

  const openNew = () => {
    const id = createSession({ date });
    setEditingId(id);
    setEditorOpen(true);
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setEditorOpen(true);
  };

  const handleDuplicate = (id: string) => {
    const copyId = duplicateSession(id);
    if (copyId) {
      setEditingId(copyId);
      setEditorOpen(true);
    }
  };

  return (
    <main className="page-wrap">
      <Group justify="space-between" align="flex-end" mb="xl">
        <div>
          <Text className="eyebrow">排场表</Text>
          <Title order={1}>训练场次排场</Title>
          <Text c="dimmed" mt={6}>
            路线库、器材清单与训练场次共用同一份排场表：每场选定路线后按障碍类型与数量预占器材，同时段余量不足即停在待备料。
          </Text>
        </div>
        <Group>
          <TextInput
            type="date"
            value={date}
            onChange={(event) => setDate(event.currentTarget.value)}
            leftSection={<CalendarPlus size={15} />}
          />
          <Tooltip label="回到今天">
            <ActionIcon variant="default" size="lg" onClick={() => setDate(todayString())}>
              <RotateCcw size={16} />
            </ActionIcon>
          </Tooltip>
          <Button variant="light" leftSection={<Package size={16} />} onClick={() => setEquipmentOpen(true)}>
            器材清单
          </Button>
          <Button leftSection={<Plus size={16} />} onClick={openNew}>
            新增场次
          </Button>
        </Group>
      </Group>

      <Paper withBorder p="sm" mb="md">
        <Group gap="lg">
          <Text size="xs" fw={700} c="dimmed">器材总量</Text>
          {EQUIPMENT_KINDS.map((kind) => (
            <Group key={kind} gap={4}>
              <Badge variant="light" color="indigo">
                {EQUIPMENT_LABELS[kind]} {equipment[kind]}
              </Badge>
              {dayReserved[kind] ? (
                <Text size="xs" c="dimmed">
                  当日峰值占用 {dayReserved[kind]}
                </Text>
              ) : null}
            </Group>
          ))}
        </Group>
      </Paper>

      <Paper withBorder p="md" className="schedule-paper">
        <ScrollArea h={640} offsetScrollbars>
          <div className="schedule-timeline">
            <div className="schedule-gutter">
              {HOURS.map((hour) => (
                <div key={hour} className="schedule-hour">
                  {String(Math.floor(hour)).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            <div className="schedule-track">
              {HOURS.map((hour) => (
                <div key={hour} className="schedule-hour-line" style={{ top: (hour - DAY_START / 60) * HOUR_HEIGHT }} />
              ))}
              {daySessions.map((session) => (
                <SessionBlock
                  key={session.id}
                  session={session}
                  onOpen={() => openEdit(session.id)}
                  onDuplicate={() => handleDuplicate(session.id)}
                />
              ))}
              {daySessions.length === 0 && (
                <Text c="dimmed" size="sm" className="schedule-empty">
                  当日暂无场次，点击「新增场次」开始排场。
                </Text>
              )}
            </div>
          </div>
        </ScrollArea>
      </Paper>

      <SessionEditorModal
        opened={editorOpen}
        sessionId={editingId}
        onClose={() => setEditorOpen(false)}
      />
      <EquipmentModal opened={equipmentOpen} onClose={() => setEquipmentOpen(false)} />
    </main>
  );
}

function SessionBlock({
  session,
  onOpen,
  onDuplicate,
}: {
  session: TrainingSession;
  onOpen: () => void;
  onDuplicate: () => void;
}) {
  const start = timeToMinutes(session.startTime);
  const end = timeToMinutes(session.endTime);
  const top = ((start - DAY_START) / 60) * HOUR_HEIGHT;
  const height = Math.max(36, ((end - start) / 60) * HOUR_HEIGHT - 4);
  const shortageKinds = EQUIPMENT_KINDS.filter((kind) => (session.reserved[kind] ?? 0) > 0);

  return (
    <button
      type="button"
      className={`session-block session-${session.status}`}
      style={{ top, height }}
      onClick={onOpen}
    >
      <Group justify="space-between" wrap="nowrap" gap={4}>
        <Text size="xs" fw={800} truncate>
          {session.startTime}-{session.endTime} {session.name}
        </Text>
        <Badge size="xs" color={statusColor[session.status]} variant={session.status === 'pending' ? 'filled' : 'light'}>
          {statusLabel[session.status]}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed" truncate>
        {session.coach || '未填教练'} · {session.routeName}
      </Text>
      {session.status === 'pending' && (
        <Group gap={4} mt={2}>
          <AlertTriangle size={12} color="#dc2626" />
          <Text size="xs" c="red" truncate>
            器材不足，待备料
          </Text>
        </Group>
      )}
      {height > 50 && shortageKinds.length > 0 && (
        <Group gap={4} mt={4}>
          {shortageKinds.slice(0, 4).map((kind) => (
            <Badge key={kind} size="xs" variant="outline" color="dark">
              {EQUIPMENT_LABELS[kind]} × {session.reserved[kind]}
            </Badge>
          ))}
        </Group>
      )}
      <ActionIcon
        size="xs"
        variant="subtle"
        className="session-duplicate"
        onClick={(event) => {
          event.stopPropagation();
          onDuplicate();
        }}
        title="复制场次"
      >
        <Plus size={12} />
      </ActionIcon>
    </button>
  );
}
