import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  currentMemberId,
  describeOperator,
  identityHint,
  loadIdentity,
  operatorDefaultNote,
} from '../identity.js';

function withIdentity(data: unknown | null): void {
  const dir = mkdtempSync(join(tmpdir(), 'tower-identity-'));
  const file = join(dir, 'identity.json');
  if (data !== null) writeFileSync(file, JSON.stringify(data));
  process.env.TOWER_IDENTITY_FILE = file;
  delete process.env.TOWER_MEMBER_ID;
}

const SAMPLE = {
  memberId: '02704e3699294e98156cfe2208814fbc',
  memberName: 'Young',
  memberEmail: 'young@example.com',
  selectedAt: '2026-09-28T06:00:00Z',
  selectedBy: { systemUser: 'mk', host: 'bill-mac-m2', towerAccount: '窦非凡 <bill.dou@mkcorp.com>' },
};

test('没有身份文件时返回 null，一切按 client_id 账号处理', () => {
  withIdentity(null);
  assert.equal(loadIdentity(), null);
  assert.equal(currentMemberId(), null);
  assert.match(describeOperator(), /没有指定操作人/);
});

test('读取身份文件', () => {
  withIdentity(SAMPLE);
  const id = loadIdentity();
  assert.equal(id?.memberId, SAMPLE.memberId);
  assert.equal(id?.memberName, 'Young');
  assert.equal(id?.selectedBy?.host, 'bill-mac-m2');
  assert.equal(currentMemberId(), SAMPLE.memberId);
});

test('文件损坏时当作没选定，而不是抛错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tower-identity-'));
  const file = join(dir, 'identity.json');
  writeFileSync(file, '{ 不是 JSON');
  process.env.TOWER_IDENTITY_FILE = file;
  delete process.env.TOWER_MEMBER_ID;
  assert.equal(loadIdentity(), null);
});

test('memberId 为空字符串时也算没选定', () => {
  withIdentity({ ...SAMPLE, memberId: '' });
  assert.equal(loadIdentity(), null);
});

test('TOWER_MEMBER_ID 覆盖文件里的选择', () => {
  withIdentity(SAMPLE);
  process.env.TOWER_MEMBER_ID = 'another-member-id';
  const id = loadIdentity();
  assert.equal(id?.memberId, 'another-member-id');
  assert.equal(id?.memberName, null, '换了人不该沿用原来的名字');
});

test('TOWER_MEMBER_ID 与文件一致时保留名字', () => {
  withIdentity(SAMPLE);
  process.env.TOWER_MEMBER_ID = SAMPLE.memberId;
  assert.equal(loadIdentity()?.memberName, 'Young');
});

test('TOWER_MEMBER_ID 可以单独用，不需要身份文件', () => {
  withIdentity(null);
  process.env.TOWER_MEMBER_ID = 'env-only-member';
  assert.equal(currentMemberId(), 'env-only-member');
});

test('描述里带上人名与 id', () => {
  withIdentity(SAMPLE);
  const text = describeOperator();
  assert.match(text, /Young/);
  assert.match(text, /young@example\.com/);
  assert.match(text, new RegExp(SAMPLE.memberId));
});

test('没选定时不给工具描述追加「默认值」说明', () => {
  withIdentity(null);
  assert.equal(operatorDefaultNote('assignee_id'), '');
});

test('选定后工具描述里会说明默认值', () => {
  withIdentity(SAMPLE);
  assert.match(operatorDefaultNote('assignee_id'), /Young/);
});

test('没选定时给出可操作提示', () => {
  withIdentity(null);
  assert.match(identityHint() ?? '', /select-member/);
});

test('已选定时不提示', () => {
  withIdentity(SAMPLE);
  assert.equal(identityHint(), null);
});
