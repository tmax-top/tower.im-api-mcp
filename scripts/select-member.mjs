#!/usr/bin/env node
/**
 * 选定「当前操作人」。
 *
 * 场景：安装时填的 client_id / client_secret 是**管理员**的，但实际用这套 MCP 的是
 * 团队成员（比如测试人员）。这里让安装者从团队里选一名成员作为当前操作人，
 * 之后与「人」相关的操作默认都以他为对象：
 *
 *   - tower_create_todo 不传 assignee_id → 默认指派给他
 *   - tower_list_member_todos 不传 member_id → 默认查他的任务
 *
 * 不选的话，一切仍按 client_id 对应的账号处理。
 *
 * 用法：
 *   npm run select-member            # 交互式选择
 *   npm run select-member -- --clear # 清除已选的操作人
 *
 * 环境变量：
 *   TOWER_MEMBER_ID      直接指定成员 id，跳过交互
 *   TOWER_IDENTITY_FILE  身份文件路径（默认 ~/.tower-mcp/identity.json）
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

const identityFile = expandHome(process.env.TOWER_IDENTITY_FILE ?? '~/.tower-mcp/identity.json');
const clear = process.argv.includes('--clear');

/** 读 ~/.tower-mcp/env，让脚本不依赖启动器也能拿到 API 凭证 */
function loadEnvFile() {
  const p = expandHome(process.env.TOWER_ENV_FILE ?? '~/.tower-mcp/env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (!process.env[key]) process.env[key] = t.slice(i + 1);
  }
}

function item(label, value) {
  process.stdout.write(`  ${label.padEnd(10)} ${value}\n`);
}

if (clear) {
  if (existsSync(identityFile)) {
    rmSync(identityFile);
    item('已清除', identityFile);
    process.stdout.write('\n之后所有操作都按 client_id 对应的账号处理。\n');
  } else {
    item('无需清除', `没有找到 ${identityFile}`);
  }
  process.exit(0);
}

loadEnvFile();

const { loadConfig } = await import(join(projectRoot, 'dist', 'config.js'));
const { TowerClient } = await import(join(projectRoot, 'dist', 'tower-client.js'));

const client = new TowerClient(loadConfig());

// 先确定团队与账号
let teamId = process.env.TOWER_TEAM_ID?.trim();
let account = null;
try {
  if (!teamId) {
    const teams = await client.get('/teams');
    teamId = teams.data?.[0]?.id;
  }
  const me = await client.get('/user');
  const a = me.data?.attributes ?? {};
  account = a.nickname ? `${a.nickname}${a.email ? ` <${a.email}>` : ''}` : null;
} catch (err) {
  process.stderr.write(`读取团队/账号失败：${err instanceof Error ? err.message : err}\n`);
  process.stderr.write('请确认已完成授权（npm run auth）。\n');
  process.exit(1);
}

if (!teamId) {
  process.stderr.write('拿不到团队 id，可设 TOWER_TEAM_ID 指定。\n');
  process.exit(1);
}

const members = await client.get(`/teams/${teamId}/members`);
const list = (members.data ?? []).map((m) => ({
  id: m.id,
  name: m.attributes?.nickname ?? '(无名)',
  email: m.attributes?.mailbox ?? '',
  role: m.attributes?.role ?? '',
}));

if (list.length === 0) {
  process.stderr.write('团队里没有查到成员。\n');
  process.exit(1);
}

process.stdout.write('当前 API 账号（client_id 对应的）：');
process.stdout.write(account ? `${account}\n\n` : '(未知)\n\n');

// 非交互：直接按 TOWER_MEMBER_ID 指定
const preset = process.env.TOWER_MEMBER_ID?.trim();
let chosen = null;

if (preset) {
  chosen = list.find((m) => m.id === preset) ?? { id: preset, name: null, email: '', role: '' };
  process.stdout.write(`按 TOWER_MEMBER_ID 指定为：${chosen.name ?? chosen.id}\n`);
} else {
  process.stdout.write(`团队成员（${list.length} 人）：\n`);
  list.forEach((m, i) => {
    const role = m.role === 'admin' ? '管理员' : m.role === 'member' ? '成员' : m.role;
    process.stdout.write(`  ${String(i + 1).padStart(3)}. ${m.name}${m.email ? ` <${m.email}>` : ''}  ${role}\n`);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write('\n选定「当前操作人」——新建任务会默认指派给他，查任务也默认查他。\n');
    const answer = (await rl.question('输入序号（直接回车表示不指定，按 client_id 的账号处理）：')).trim();
    if (answer) {
      const n = Number.parseInt(answer, 10);
      if (!Number.isInteger(n) || n < 1 || n > list.length) {
        process.stderr.write(`序号超出范围（1-${list.length}）。\n`);
        process.exit(1);
      }
      chosen = list[n - 1];
    }
  } finally {
    rl.close();
  }
}

if (!chosen) {
  if (existsSync(identityFile)) rmSync(identityFile);
  process.stdout.write('\n没有指定操作人，之后所有操作都按 client_id 对应的账号处理。\n');
  process.exit(0);
}

const identity = {
  memberId: chosen.id,
  memberName: chosen.name ?? null,
  memberEmail: chosen.email || null,
  selectedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  selectedBy: {
    systemUser: (() => {
      try {
        return userInfo().username;
      } catch {
        return process.env.USER ?? undefined;
      }
    })(),
    host: (() => {
      try {
        return hostname();
      } catch {
        return undefined;
      }
    })(),
    ...(account ? { towerAccount: account } : {}),
  },
};

writeFileSync(identityFile, `${JSON.stringify(identity, null, 2)}\n`);

process.stdout.write('\n');
item('已记录', identityFile);
item('操作人', `${identity.memberName ?? identity.memberId}${identity.memberEmail ? ` <${identity.memberEmail}>` : ''}`);
item('成员 id', identity.memberId);
process.stdout.write(
  '\n之后：新建任务不传 assignee_id 会默认指派给他；查成员任务不传 member_id 也默认查他。\n' +
    '要改：重跑 npm run select-member；要取消：npm run select-member -- --clear\n' +
    '改完重启 MCP 客户端即可生效。\n',
);
