import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { globalLabels, loadLabels, resolveLabelRefs, searchGlobalLabels } from '../labels.js';

/**
 * 造一个临时映射文件并让被测代码读它。
 * 每个用例用独立目录，避免相互干扰。
 */
function withLabels(data: unknown): void {
  const dir = mkdtempSync(join(tmpdir(), 'tower-labels-'));
  const file = join(dir, 'labels.json');
  writeFileSync(file, JSON.stringify(data));
  process.env.TOWER_LABELS_FILE = file;
}

const SAMPLE = {
  teamId: 't1',
  teamName: '测试团队',
  syncedAt: '2026-09-28T00:00:00Z',
  source: 'https://example.invalid/labels/',
  labels: {
    global: [
      { id: 3860323, name: 'H5', count: 2057 },
      { id: 3635834, name: 'Android', count: 2033 },
      { id: 4732007, name: 'CMS', count: 7 },
    ],
    project: [{ id: 4675041, name: 'Bug', count: 69 }],
  },
};

test('读取映射文件', () => {
  withLabels(SAMPLE);
  const file = loadLabels();
  assert.equal(file?.teamName, '测试团队');
  assert.equal(globalLabels().length, 3);
});

test('文件不存在时返回 null 而不是抛错', () => {
  process.env.TOWER_LABELS_FILE = join(tmpdir(), 'tower-labels-definitely-missing.json');
  assert.equal(loadLabels(), null);
  assert.deepEqual(globalLabels(), []);
});

test('文件损坏时也返回 null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tower-labels-'));
  const file = join(dir, 'labels.json');
  writeFileSync(file, '{ 这不是 JSON');
  process.env.TOWER_LABELS_FILE = file;
  assert.equal(loadLabels(), null);
});

test('数字 id 原样透传', () => {
  withLabels(SAMPLE);
  assert.deepEqual(resolveLabelRefs([3860323, 3635834]), [3860323, 3635834]);
});

test('标签名能解析成 id，且不区分大小写', () => {
  withLabels(SAMPLE);
  assert.deepEqual(resolveLabelRefs(['H5']), [3860323]);
  assert.deepEqual(resolveLabelRefs(['h5']), [3860323]);
  assert.deepEqual(resolveLabelRefs(['cms']), [4732007]);
});

test('id 与名字可以混着传', () => {
  withLabels(SAMPLE);
  assert.deepEqual(resolveLabelRefs(['H5', 4732007]), [3860323, 4732007]);
});

test('重复的引用会去重', () => {
  withLabels(SAMPLE);
  assert.deepEqual(resolveLabelRefs(['H5', 3860323, 'h5']), [3860323]);
});

test('传项目标签要明确报错，不能让它静默失败', () => {
  // Tower 对项目标签返回 200 但什么也不做，所以必须在发请求前拦住
  withLabels(SAMPLE);
  assert.throws(() => resolveLabelRefs(['Bug']), /项目标签/);
});

test('名字对不上时报错，并给出相近的候选', () => {
  withLabels(SAMPLE);
  assert.throws(() => resolveLabelRefs(['Andriod']), /找不到名为/);
  assert.throws(() => resolveLabelRefs(['And']), /你是不是想找：Android/);
});

test('没有映射文件时，用名字会给出可操作的提示', () => {
  process.env.TOWER_LABELS_FILE = join(tmpdir(), 'tower-labels-definitely-missing.json');
  assert.throws(() => resolveLabelRefs(['H5']), /labels:sync/);
});

test('模糊查找优先前缀匹配', () => {
  withLabels(SAMPLE);
  assert.deepEqual(
    searchGlobalLabels('and').map((l) => l.name),
    ['Android'],
  );
  assert.deepEqual(searchGlobalLabels('').length, 0);
});
