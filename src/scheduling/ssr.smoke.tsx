import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

// 组件模块在顶层会读 localStorage，Node 环境补桩
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}
(globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage() as unknown as Storage;

import { ScheduleView } from '../views/ScheduleView';
import { RoutesLibraryView } from '../views/RoutesLibraryView';
import App from '../App';

function render(node: React.ReactNode) {
  return renderToString(React.createElement(MantineProvider, null, node));
}

test('排场表整页可服务端渲染（无渲染期崩溃）', () => {
  const html = render(
    React.createElement(MemoryRouter, { initialEntries: ['/schedule'] }, React.createElement(ScheduleView)),
  );
  assert.match(html, /训练场排场表/);
  assert.match(html, /器材清单/);
  assert.match(html, /进阶班场地课|训练场次/);
});

test('排场表渲染出种子场次的待备料/已确认状态与占用信息', () => {
  const html = render(
    React.createElement(MemoryRouter, { initialEntries: ['/schedule'] }, React.createElement(ScheduleView)),
  );
  assert.match(html, /已确认/);
  assert.match(html, /场地/);
});

test('路线库页（含同步到排场表按钮）可渲染', () => {
  const html = render(
    React.createElement(MemoryRouter, { initialEntries: ['/routes'] }, React.createElement(RoutesLibraryView)),
  );
  assert.match(html, /已保存路线|路线库/);
});

test('App 外壳含排场表导航', () => {
  const html = render(
    React.createElement(MemoryRouter, { initialEntries: ['/schedule'] }, React.createElement(App)),
  );
  assert.match(html, /排场表/);
});
