import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ScheduleEngine, ARENA, overlaps, needFromKinds } from './engine';
import type { ObstacleKind, ScheduleState } from './types';
import { createInitialCourse } from '../utils/course';
import type { Course } from '../types/course';

function routeAKinds(): ObstacleKind[] {
  return ['vertical', 'vertical', 'oxer', 'wall', 'water'];
}
function routeBKinds(): ObstacleKind[] {
  return ['vertical', 'oxer', 'oxer'];
}

/** 固定时段：2026-10-08 本地时间 */
function t(hour: number, minute = 0): number {
  return new Date(2026, 9, 8, hour, minute).getTime();
}

async function setup(overrides?: { vertical?: number; oxer?: number; water?: number }): Promise<{
  engine: ScheduleEngine;
  routeA: string;
  routeB: string;
}> {
  const engine = new ScheduleEngine();
  engine.setPersist(() => {});
  await engine.setEquipmentCount(ARENA, 1);
  await engine.setEquipmentCount('vertical', overrides?.vertical ?? 4);
  await engine.setEquipmentCount('oxer', overrides?.oxer ?? 2);
  await engine.setEquipmentCount('triple', 2);
  await engine.setEquipmentCount('wall', 2);
  await engine.setEquipmentCount('water', overrides?.water ?? 1);
  await engine.setEquipmentCount('combination', 1);

  const a = await engine.upsertRoute({ name: 'A 路线', obstacleKinds: routeAKinds() });
  const b = await engine.upsertRoute({ name: 'B 路线', obstacleKinds: routeBKinds() });
  return { engine, routeA: a.id, routeB: b.id };
}

function courseFor(kinds: ObstacleKind[]): Course {
  const base = createInitialCourse();
  kinds.forEach((kind, index) => {
    if (base.obstacles[index]) base.obstacles[index].kind = kind;
  });
  base.sequence = base.obstacles.slice(0, kinds.length).map((o) => o.id);
  return base;
}

function activeHoldCount(state: ScheduleState, sessionId: string): number {
  const released = new Set<string>();
  for (const entry of state.ledger) {
    if (entry.action === 'release' && entry.pairedEntryId) released.add(entry.pairedEntryId);
  }
  return state.ledger.filter(
    (e) => e.action === 'hold' && !released.has(e.id) && e.sessionId === sessionId,
  ).length;
}

describe('时间与需求工具', () => {
  test('半开区间：相接不重叠，交叉才重叠', () => {
    const base = t(9);
    const hour = 3600_000;
    assert.equal(overlaps(base, base + hour, base + hour, base + 2 * hour), false);
    assert.equal(overlaps(base, base + 2 * hour, base + hour, base + 3 * hour), true);
  });

  test('按障碍类型与数量聚合，场地恒为 1', () => {
    assert.deepEqual(needFromKinds(['vertical', 'vertical', 'oxer']), {
      [ARENA]: 1,
      vertical: 2,
      oxer: 1,
    });
  });
});

describe('余量检查与预占', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  test('选定路线后按类型与数量预占，余量对应减少', async () => {
    const { engine, routeA } = ctx;
    const draft = await engine.saveDraft({ coach: '王教练', title: '早课', start: t(9), end: t(10, 30), routeId: routeA });
    const result = await engine.submitDraft(draft.id);
    assert.equal(result.status, 'confirmed');

    const report = engine.checkAvailability({ start: t(9), end: t(10, 30), routeId: routeA });
    assert.equal(report.perResource.find((r) => r.resource === ARENA)!.remaining, 0);
    const vertical = report.perResource.find((r) => r.resource === 'vertical')!;
    assert.equal(vertical.used, 2);
    assert.equal(vertical.remaining, 2);
  });

  test('不重叠时段（首尾相接）互不占用', async () => {
    const { engine, routeA } = ctx;
    const d1 = await engine.saveDraft({ coach: '王教练', title: '早课', start: t(9), end: t(10, 30), routeId: routeA });
    await engine.submitDraft(d1.id);
    const report = engine.checkAvailability({ start: t(10, 30), end: t(12), routeId: routeA });
    assert.equal(report.ok, true);
    assert.equal(report.perResource.find((r) => r.resource === ARENA)!.remaining, 1);
  });

  test('场地冲突：停在待备料、指出被哪场占用、草稿保留、不产生预占', async () => {
    const { engine, routeA } = ctx;
    const d1 = await engine.saveDraft({ coach: '王教练', title: '早课', start: t(9), end: t(10, 30), routeId: routeA });
    await engine.submitDraft(d1.id);

    const d2 = await engine.saveDraft({ coach: '李教练', title: '撞场课', start: t(10), end: t(11), routeId: routeA });
    const result = await engine.submitDraft(d2.id);
    assert.equal(result.status, 'pending_materials');
    const arenaShortage = result.shortage!.shortages.find((s) => s.resource === ARENA)!;
    assert.equal(arenaShortage.available, 0);
    assert.equal(arenaShortage.holders[0].title, '早课');
    assert.equal(arenaShortage.holders[0].coach, '王教练');
    assert.ok(engine.getState().drafts.some((draft) => draft.id === d2.id));
    const session = engine.getState().sessions.find((s) => s.id === result.sessionId)!;
    assert.equal(session.status, 'pending_materials');
    assert.equal(activeHoldCount(engine.getState(), session.id), 0);
  });

  test('待备料场次在资源释放后重新提交可确认', async () => {
    const { engine, routeA } = ctx;
    const d1 = await engine.saveDraft({ coach: '王教练', title: '早课', start: t(9), end: t(10, 30), routeId: routeA });
    const r1 = await engine.submitDraft(d1.id);
    const d2 = await engine.saveDraft({ coach: '李教练', title: '撞场课', start: t(10), end: t(11), routeId: routeA });
    const r2 = await engine.submitDraft(d2.id);
    assert.equal(r2.status, 'pending_materials');

    await engine.cancelSession(r1.sessionId);
    const retry = await engine.submitDraft(d2.id);
    assert.equal(retry.status, 'confirmed');
  });
});

describe('并发提交：先交先得', () => {
  test('两名教练同时提交不同草稿抢同一时段，先入队者占用', async () => {
    const { engine, routeA } = await setup();
    const wang = await engine.saveDraft({ coach: '王教练', title: '王课', start: t(9), end: t(10, 30), routeId: routeA });
    const li = await engine.saveDraft({ coach: '李教练', title: '李课', start: t(9), end: t(10, 30), routeId: routeA });

    // 不 await，构造真正并发；引擎内部队列按调用顺序串行处理
    const firstPromise = engine.submitDraft(wang.id);
    const secondPromise = engine.submitDraft(li.id);
    const [r1, r2] = await Promise.all([firstPromise, secondPromise]);

    assert.equal(r1.status, 'confirmed');
    assert.equal(r2.status, 'pending_materials');
    const arenaShortage = r2.shortage!.shortages.find((s) => s.resource === ARENA)!;
    assert.equal(arenaShortage.holders[0].coach, '王教练');
    assert.equal(arenaShortage.holders[0].sessionId, r1.sessionId);
    assert.ok(engine.getState().drafts.some((d) => d.id === li.id), '后交者草稿保留');
  });
});

describe('失败回滚与幂等重试', () => {
  test('器材归还失败：整场占用回到提交前，原占用不动', async () => {
    const { engine, routeA } = await setup();
    const d1 = await engine.saveDraft({ coach: '王教练', title: '早课', start: t(9), end: t(10, 30), routeId: routeA });
    const r1 = await engine.submitDraft(d1.id);
    const holdsBefore = activeHoldCount(engine.getState(), r1.sessionId);
    assert.ok(holdsBefore > 0);

    engine.setFaults({ failEquipmentReturn: true });
    const move = await engine.reviseSession(r1.sessionId, { start: t(11), end: t(12, 30) });
    assert.equal(move.status, 'rolled_back');
    assert.match(move.error ?? '', /归还失败/);

    const after = engine.getState();
    const session = after.sessions.find((s) => s.id === r1.sessionId)!;
    assert.equal(session.start, t(9), '时间必须回到提交前');
    assert.equal(session.status, 'confirmed');
    assert.equal(after.ledger.filter((e) => e.action === 'release').length, 0);
    assert.equal(activeHoldCount(after, r1.sessionId), holdsBefore);

    engine.setFaults({ failEquipmentReturn: false });
    const report = engine.checkAvailability({ start: t(9), end: t(10), routeId: routeA });
    assert.equal(report.ok, false, '故障恢复后原场次仍占着同时段');
  });

  test('场次保存失败：整场回到提交前，不产生预占', async () => {
    const { engine, routeA } = await setup();
    const sessionsBefore = engine.getState().sessions.length;
    const d1 = await engine.saveDraft({ coach: '王教练', title: '保存会失败', start: t(14), end: t(15), routeId: routeA });
    // 草稿已落库，此刻让“场次保存”失败
    engine.setFaults({ failPersist: true });
    const result = await engine.submitDraft(d1.id, 'sub-persist-fail');
    assert.equal(result.status, 'rolled_back');
    assert.match(result.error ?? '', /保存失败/);
    assert.equal(engine.getState().sessions.length, sessionsBefore);
    assert.equal(engine.getState().ledger.filter((e) => e.action === 'hold').length, 0);

    // 故障恢复后同键重试：结论是上一次的 rolled_back（幂等），换新键则可正常确认
    engine.setFaults({ failPersist: false });
    const retried = await engine.submitDraft(d1.id, 'sub-persist-fail');
    assert.equal(retried.status, 'rolled_back', '同键重试返回首次结论，不重复扣减');
    const fresh = await engine.submitDraft(d1.id);
    assert.equal(fresh.status, 'confirmed');
  });

  test('同一提交键重试不重复扣减，直接返回首次结果', async () => {
    const { engine, routeA } = await setup();
    const d1 = await engine.saveDraft({ coach: '王教练', title: '早课', start: t(9), end: t(10, 30), routeId: routeA });
    const key = 'fixed-submission-key';
    const first = await engine.submitDraft(d1.id, key);
    const holdsAfterFirst = engine.getState().ledger.filter((e) => e.action === 'hold').length;
    assert.ok(holdsAfterFirst > 0);

    const retry = await engine.submitDraft(d1.id, key);
    assert.equal(retry.sessionId, first.sessionId);
    assert.equal(retry.status, 'confirmed');
    assert.equal(
      engine.getState().ledger.filter((e) => e.action === 'hold').length,
      holdsAfterFirst,
      '重试不能再扣减',
    );
  });

  test('归还失败后用同一提交键重试，不残留半截 release', async () => {
    const { engine, routeA } = await setup();
    const d1 = await engine.saveDraft({ coach: '王教练', title: '早课', start: t(9), end: t(10, 30), routeId: routeA });
    const r1 = await engine.submitDraft(d1.id, 'sub-1');

    engine.setFaults({ failEquipmentReturn: true });
    const failed = await engine.reviseSession(r1.sessionId, { start: t(11) }, 'sub-move');
    assert.equal(failed.status, 'rolled_back');
    const retry = await engine.reviseSession(r1.sessionId, { start: t(11) }, 'sub-move');
    assert.equal(retry.status, 'rolled_back');
    assert.equal(engine.getState().ledger.filter((e) => e.action === 'release').length, 0);
  });
});

describe('批量保存原子性', () => {
  test('任一场次余量不足，整批回滚不产生任何占用', async () => {
    const { engine, routeA, routeB } = await setup();
    const result = await engine.saveMany([
      { title: '批一', coach: '王教练', start: t(9), end: t(10, 30), routeId: routeB },
      { title: '批二', coach: '李教练', start: t(10), end: t(11), routeId: routeA },
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.shortage);
    assert.equal(engine.getState().sessions.length, 0);
    assert.equal(engine.getState().ledger.length, 0);
  });

  test('全部可排时整批确认', async () => {
    const { engine, routeA, routeB } = await setup();
    const result = await engine.saveMany([
      { title: '批一', coach: '王教练', start: t(9), end: t(10, 30), routeId: routeA },
      { title: '批二', coach: '李教练', start: t(10, 30), end: t(12), routeId: routeB },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 2);
  });
});

describe('复制与改路线', () => {
  test('复制场次到空闲时段成功，到冲突时段待备料', async () => {
    const { engine, routeA } = await setup();
    const d1 = await engine.saveDraft({ coach: '王教练', title: '原课', start: t(9), end: t(10, 30), routeId: routeA });
    const r1 = await engine.submitDraft(d1.id);

    const ok = await engine.copySession(r1.sessionId, {
      title: '复制课',
      coach: '李教练',
      start: t(13),
      end: t(14, 30),
    });
    assert.equal(ok.status, 'confirmed');

    const clash = await engine.copySession(r1.sessionId, {
      title: '冲突复制',
      coach: '赵教练',
      start: t(9),
      end: t(10),
    });
    assert.equal(clash.status, 'pending_materials');
  });

  test('改时间/路线后余量不足：待备料且旧占用已按事务回滚不留半截', async () => {
    const { engine, routeA, routeB } = await setup({ vertical: 10, oxer: 2, water: 10 });
    const dB = await engine.saveDraft({ coach: '王教练', title: 'B 课', start: t(9), end: t(11), routeId: routeB });
    const rB = await engine.submitDraft(dB.id);
    const dA = await engine.saveDraft({ coach: '李教练', title: 'A 课', start: t(13), end: t(15), routeId: routeA });
    const rA = await engine.submitDraft(dA.id);
    assert.equal(rB.status, 'confirmed');
    assert.equal(rA.status, 'confirmed');

    // A 课改到与 B 同时段：场地必然不够 → 待备料，事务内释放的旧 hold 随回滚撤销
    const moved = await engine.reviseSession(rA.sessionId, { start: t(9), end: t(11), routeId: routeB });
    assert.equal(moved.status, 'pending_materials');
    assert.ok(moved.shortage!.shortages.some((s) => s.resource === ARENA));
    assert.equal(activeHoldCount(engine.getState(), rA.sessionId), 0, '待备料场次不持有资源');
    // B 课占用不受影响
    assert.ok(activeHoldCount(engine.getState(), rB.sessionId) > 0);
  });
});

describe('安全分析与裁判表失效', () => {
  test('时间/场地/步幅改动让关联分析失效重算，未受影响场次照旧', async () => {
    const { engine, routeA } = await setup();
    await engine.upsertRoute({
      id: routeA,
      name: 'A 路线',
      obstacleKinds: routeAKinds(),
      course: courseFor(routeAKinds()),
    });
    const d1 = await engine.saveDraft({ coach: '王教练', title: '课一', start: t(9), end: t(10, 30), routeId: routeA });
    const d2 = await engine.saveDraft({ coach: '李教练', title: '课二', start: t(13), end: t(14, 30), routeId: routeA });
    const r1 = await engine.submitDraft(d1.id);
    const r2 = await engine.submitDraft(d2.id);

    const sig1 = engine.getSafetyAnalysis(r1.sessionId)!.artifact.signature;
    const sig2 = engine.getSafetyAnalysis(r2.sessionId)!.artifact.signature;
    const judgeSig2 = engine.getJudgeSheet(r2.sessionId)!.signature;

    // 只改课一时间 → 课一失效，课二签名不变
    await engine.reviseSession(r1.sessionId, { start: t(9, 30) });
    assert.notEqual(engine.getSafetyAnalysis(r1.sessionId)!.artifact.signature, sig1);
    assert.equal(engine.getSafetyAnalysis(r2.sessionId)!.artifact.signature, sig2);
    assert.equal(engine.getJudgeSheet(r2.sessionId)!.signature, judgeSig2);

    // 改课一步幅 → 课一签名再变，课二照旧
    const sig1b = engine.getSafetyAnalysis(r1.sessionId)!.artifact.signature;
    await engine.reviseSession(r1.sessionId, { strideOverride: 4.0 });
    assert.notEqual(engine.getSafetyAnalysis(r1.sessionId)!.artifact.signature, sig1b);
    assert.equal(engine.getSafetyAnalysis(r2.sessionId)!.artifact.signature, sig2);

    // 改课一场地尺寸 → 课一裁判表失效，课二裁判表不变
    const judgeSig1 = engine.getJudgeSheet(r1.sessionId)!.signature;
    await engine.reviseSession(r1.sessionId, { arenaOverride: { width: 70, length: 100 } });
    assert.notEqual(engine.getJudgeSheet(r1.sessionId)!.signature, judgeSig1);
    assert.equal(engine.getJudgeSheet(r2.sessionId)!.signature, judgeSig2);
  });

  test('路线库几何 rev 递增只让关联场次失效', async () => {
    const { engine, routeA, routeB } = await setup();
    const course = courseFor(routeAKinds());
    await engine.upsertRoute({ id: routeA, name: 'A', obstacleKinds: routeAKinds(), course });
    await engine.upsertRoute({ id: routeB, name: 'B', obstacleKinds: routeBKinds(), course });
    const d1 = await engine.saveDraft({ coach: '王', title: '课一', start: t(9), end: t(10), routeId: routeA });
    const d2 = await engine.saveDraft({ coach: '李', title: '课二', start: t(11), end: t(12), routeId: routeB });
    const r1 = await engine.submitDraft(d1.id);
    const r2 = await engine.submitDraft(d2.id);
    const sigA = engine.getSafetyAnalysis(r1.sessionId)!.artifact.signature;
    const sigB = engine.getSafetyAnalysis(r2.sessionId)!.artifact.signature;

    await engine.upsertRoute({ id: routeA, name: 'A 改', obstacleKinds: routeAKinds(), course });
    assert.notEqual(engine.getSafetyAnalysis(r1.sessionId)!.artifact.signature, sigA);
    assert.equal(engine.getSafetyAnalysis(r2.sessionId)!.artifact.signature, sigB, '课二不受影响');
  });

  test('换路线即使落到待备料，旧的安全分析/裁判表也失效', async () => {
    const { engine, routeA, routeB } = await setup();
    const course = courseFor(routeAKinds());
    await engine.upsertRoute({ id: routeA, name: 'A', obstacleKinds: routeAKinds(), course });
    await engine.upsertRoute({ id: routeB, name: 'B', obstacleKinds: routeBKinds(), course });
    // 先用 B 占住 9-11 的场地
    const blocker = await engine.saveDraft({ coach: '占位', title: '占位课', start: t(9), end: t(11), routeId: routeB });
    await engine.submitDraft(blocker.id);
    const d1 = await engine.saveDraft({ coach: '王', title: '课一', start: t(13), end: t(14), routeId: routeA });
    const r1 = await engine.submitDraft(d1.id);
    const oldSig = engine.getSafetyAnalysis(r1.sessionId)!.artifact.signature;
    const oldJudge = engine.getJudgeSheet(r1.sessionId)!.signature;

    // 把课一挪进被占时段并换成 B 路线 → 待备料；产物应已失效且指向 B
    const moved = await engine.reviseSession(r1.sessionId, { start: t(9), end: t(11), routeId: routeB });
    assert.equal(moved.status, 'pending_materials');
    assert.notEqual(engine.getSafetyAnalysis(r1.sessionId)!.artifact.signature, oldSig);
    assert.notEqual(engine.getJudgeSheet(r1.sessionId)!.signature, oldJudge);
  });
});
