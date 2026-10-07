import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { CalendarRange, Plus, RefreshCw } from 'lucide-react';
import { useScheduleStore, useScheduleVersion } from '../stores/scheduleStore';
import type { CoachDraft, SubmitResult, TrainingSession } from '../scheduling/types';
import { DraftComposer } from '../components/schedule/DraftComposer';
import { DraftList } from '../components/schedule/DraftList';
import { SessionCard } from '../components/schedule/SessionCard';
import { ScheduleSidebar } from '../components/schedule/ScheduleSidebar';
import { ShortageNotice } from '../components/schedule/ShortageNotice';
import { fromInputValue, toInputValue } from '../components/schedule/time';

export function ScheduleView() {
  const version = useScheduleVersion();
  const snapshot = useScheduleStore.getState().snapshot();
  void version;
  const copySession = useScheduleStore((s) => s.copySession);

  const [composerOpen, setComposerOpen] = useState(true);
  const [editing, setEditing] = useState<CoachDraft | null>(null);
  const [banner, setBanner] = useState<{ tone: 'green' | 'red' | 'orange'; text: string; shortage?: SubmitResult['shortage'] } | null>(null);
  const [copyTarget, setCopyTarget] = useState<TrainingSession | null>(null);
  const [copyStart, setCopyStart] = useState('15:00');
  const [copyEnd, setCopyEnd] = useState('16:30');
  const [copyTitle, setCopyTitle] = useState('');
  const [copyBusy, setCopyBusy] = useState(false);

  const sessions = useMemo(
    () => [...snapshot.sessions].sort((a, b) => a.start - b.start),
    [snapshot.sessions],
  );
  const confirmedCount = sessions.filter((s) => s.status === 'confirmed').length;

  function handleResult(result: SubmitResult, draftTitle?: string) {
    if (result.status === 'confirmed') {
      setBanner({ tone: 'green', text: `「${draftTitle ?? '场次'}」已确认，器材与场地按路线需求预占完成。` });
      setComposerOpen(false);
      setEditing(null);
    } else if (result.status === 'pending_materials') {
      setBanner({
        tone: 'orange',
        text: draftTitle ? `「${draftTitle}」余量不足，已停在待备料，草稿已保留。` : '余量不足，已停在待备料。',
        shortage: result.shortage,
      });
    } else if (result.status === 'rolled_back') {
      setBanner({ tone: 'red', text: `操作失败，整场占用已回到提交前：${result.error ?? '未知错误'}。重试不会重复扣减。` });
    }
  }

  async function handleCopy() {
    if (!copyTarget || !copyTitle.trim()) return;
    setCopyBusy(true);
    try {
      const result = await copySession(copyTarget.id, {
        title: copyTitle.trim(),
        coach: copyTarget.coach,
        start: fromInputValue(copyStart),
        end: fromInputValue(copyEnd),
      });
      setCopyTarget(null);
      handleResult(result, copyTitle.trim());
    } finally {
      setCopyBusy(false);
    }
  }

  return (
    <main className="page-wrap schedule-page">
      <Group justify="space-between" align="flex-end" mb="lg">
        <div>
          <Text className="eyebrow">排场 · 占料</Text>
          <Title order={1}>训练场排场表</Title>
          <Text c="dimmed" mt={6} size="sm">
            路线库、器材清单、训练场次接成同一张表：选定路线即按障碍类型与数量预占，冲突时停在待备料并指明占用场次。
          </Text>
        </div>
        <Group>
          <Badge size="lg" variant="light">{confirmedCount} 场已确认</Badge>
          <Badge size="lg" color="orange" variant="light">
            {sessions.length - confirmedCount} 场待备料
          </Badge>
          <Button
            leftSection={<Plus size={16} />}
            onClick={() => {
              setEditing(null);
              setComposerOpen(true);
            }}
          >
            新草稿
          </Button>
        </Group>
      </Group>

      {banner && (
        <Alert
          mb="md"
          color={banner.tone}
          variant={banner.tone === 'green' ? 'light' : 'filled'}
          onClose={() => setBanner(null)}
          withCloseButton
          title={banner.tone === 'green' ? '排场成功' : banner.tone === 'orange' ? '待备料' : '事务已回滚'}
        >
          <Stack gap={6}>
            <Text size="sm">{banner.text}</Text>
            {banner.shortage ? <ShortageNotice report={banner.shortage} /> : null}
          </Stack>
        </Alert>
      )}

      <div className="schedule-layout">
        <div className="schedule-main">
          <Paper withBorder radius="md" className="board-paper">
            <Group justify="space-between" p="sm" px="md" className="board-head">
              <Group gap={6}>
                <CalendarRange size={16} />
                <Title order={5}>10 月 8 日（周四）训练场次</Title>
              </Group>
              <Text size="xs" c="dimmed">场地与同类型障碍在重叠时段共享库存</Text>
            </Group>
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm" p="sm" pt={0}>
              {sessions.length === 0 ? (
                <Paper className="library-empty" p="xl" withBorder>
                  <Title order={4}>还没有排场</Title>
                  <Text c="dimmed" size="sm" mt={6}>从右上方「新草稿」开始选定路线与时段。</Text>
                </Paper>
              ) : (
                sessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onResult={(result) => handleResult(result)}
                    onCopy={(source) => {
                      setCopyTarget(source);
                      setCopyTitle(`${source.title} 副本`);
                      setCopyStart(toInputValue(source.start));
                      setCopyEnd(toInputValue(source.end));
                    }}
                  />
                ))
              )}
            </SimpleGrid>
          </Paper>

          <Group mt="lg" mb="xs">
            <Tooltip label="草稿区折叠/展开">
              <ActionIcon variant="subtle" onClick={() => setComposerOpen((v) => !v)}>
                <RefreshCw size={15} />
              </ActionIcon>
            </Tooltip>
            <Title order={5}>教练草稿区</Title>
          </Group>
          {composerOpen ? (
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
              <DraftComposer
                key={editing?.id ?? 'new'}
                editing={editing}
                onDone={() => {
                  setComposerOpen(false);
                  setEditing(null);
                }}
                onResult={(result, label) => handleResult(result, label)}
              />
              <DraftList onEdit={(draft) => { setEditing(draft); setComposerOpen(true); }} />
            </SimpleGrid>
          ) : (
            <DraftList onEdit={(draft) => { setEditing(draft); setComposerOpen(true); }} />
          )}
        </div>

        <aside className="schedule-side">
          <ScheduleSidebar onNoticed={(text) => setBanner({ tone: text.includes('回滚') ? 'red' : text.includes('待备料') ? 'orange' : 'green', text })} />
        </aside>
      </div>

      <Modal
        opened={copyTarget !== null}
        onClose={() => setCopyTarget(null)}
        title={`复制「${copyTarget?.title ?? ''}」到新时段`}
        centered
      >
        <Stack gap="sm">
          <Text size="xs" c="dimmed">
            复制沿用原路线、场地尺寸与步幅；提交时同样先查同时段余量，不够会停在待备料。
          </Text>
          <TextInput label="新场次名称" value={copyTitle} onChange={(e) => setCopyTitle(e.currentTarget.value)} />
          <Group grow>
            <TextInput type="time" label="开始（10/08）" value={copyStart} onChange={(e) => setCopyStart(e.currentTarget.value)} />
            <TextInput type="time" label="结束（10/08）" value={copyEnd} onChange={(e) => setCopyEnd(e.currentTarget.value)} />
          </Group>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setCopyTarget(null)}>取消</Button>
            <Button loading={copyBusy} onClick={handleCopy}>查余量并复制</Button>
          </Group>
        </Stack>
      </Modal>
    </main>
  );
}
