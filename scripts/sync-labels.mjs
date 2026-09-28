#!/usr/bin/env node
/**
 * 从 Tower 网页端同步「标签管理」页，刷新标签 id ↔ 名称映射。
 *
 * 为什么必须走网页端：Tower 的公开 API **不提供任何标签接口**
 * （/labels、/teams/{id}/labels、/todo_labels 等十几个候选全部 404），
 * 任务响应里也只有标签名、没有 id。而网页端那个页面是服务端渲染的，
 * 标签直接嵌在 HTML 里，抓下来就能拿到完整映射。
 *
 * 用法：
 *   npm run labels:sync
 *
 * 需要的凭证：
 *   1. 会话 cookie —— 该页面要登录才能访问。从下面二选一取：
 *        · 环境变量 TOWER_SESSION_COOKIE
 *        · 文件 ~/.tower-mcp/cookie（每行一个 cookie，或整条 Cookie 头）
 *   2. API 凭证 —— 用来查团队 id，从 ~/.tower-mcp/env 自动读取
 *
 * 环境变量：
 *   TOWER_SESSION_COOKIE   会话 cookie
 *   TOWER_TEAM_ID          直接指定团队 id，跳过 API 查询
 *   TOWER_LABELS_FILE      输出路径（默认 ~/.tower-mcp/labels.json）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

const labelsFile = expandHome(process.env.TOWER_LABELS_FILE ?? '~/.tower-mcp/labels.json');
const cookieFile = expandHome(process.env.TOWER_COOKIE_FILE ?? '~/.tower-mcp/cookie');

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

function readCookie() {
  const fromEnv = process.env.TOWER_SESSION_COOKIE?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(cookieFile)) {
    const raw = readFileSync(cookieFile, 'utf8').trim();
    if (raw) {
      // 支持两种写法：整条 Cookie 头，或每行一个 name=value
      return raw.includes('=') && !raw.includes('\n')
        ? raw
        : raw.split('\n').map((l) => l.trim()).filter(Boolean).join('; ');
    }
  }
  return null;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** 从一段 HTML 里抽出所有 <div id="label_N">…<div class="name">NAME</div> */
function extractLabels(segment) {
  const out = [];
  for (const chunk of segment.split('id="label_').slice(1)) {
    const idMatch = /^(\d+)/.exec(chunk);
    const nameMatch = /<div class="name">([\s\S]*?)<\/div>/.exec(chunk);
    if (!idMatch || !nameMatch) continue;
    const cntMatch = /<div class="todo-count">\s*([\d,]+)\s*个任务/.exec(chunk);
    out.push({
      id: Number(idMatch[1]),
      name: decodeEntities(nameMatch[1]).trim(),
      count: cntMatch ? Number(cntMatch[1].replace(/,/g, '')) : null,
    });
  }
  return out;
}

function diff(oldList, newList) {
  const oldMap = new Map(oldList.map((x) => [x.id, x.name]));
  const newMap = new Map(newList.map((x) => [x.id, x.name]));
  const added = newList.filter((x) => !oldMap.has(x.id));
  const removed = oldList.filter((x) => !newMap.has(x.id));
  const renamed = newList.filter((x) => oldMap.has(x.id) && oldMap.get(x.id) !== x.name)
    .map((x) => ({ id: x.id, from: oldMap.get(x.id), to: x.name }));
  return { added, removed, renamed };
}

// ---------------------------------------------------------------- 主流程
loadEnvFile();

const cookie = readCookie();
if (!cookie) {
  console.error(
    '缺少会话 cookie。该页面需要登录，二选一：\n' +
      '  · 设环境变量：TOWER_SESSION_COOKIE="_tower2_session=..."\n' +
      `  · 或写入文件：${cookieFile}（权限 600）\n\n` +
      'cookie 从浏览器开发者工具里取：打开 Tower 页面 → F12 → Network → 任一请求\n' +
      '→ Request Headers → 复制 Cookie 那一整行。',
  );
  process.exit(1);
}

let teamId = process.env.TOWER_TEAM_ID?.trim();
if (!teamId) {
  const { loadConfig } = await import(join(projectRoot, 'dist', 'config.js'));
  const { TowerClient } = await import(join(projectRoot, 'dist', 'tower-client.js'));
  try {
    const teams = await new TowerClient(loadConfig()).get('/teams');
    teamId = teams.data?.[0]?.id;
  } catch (err) {
    console.error(`查团队 id 失败：${err instanceof Error ? err.message : err}`);
    console.error('可以设 TOWER_TEAM_ID 跳过这一步。');
    process.exit(1);
  }
}
if (!teamId) {
  console.error('拿不到团队 id。设 TOWER_TEAM_ID 指定。');
  process.exit(1);
}

const url = `https://tower.im/teams/${teamId}/labels/`;
process.stdout.write(`正在抓取 ${url}\n`);

const res = await fetch(url, {
  headers: { cookie, 'user-agent': 'tower-mcp-labels-sync' },
  redirect: 'manual',
});

if (res.status >= 300 && res.status < 400) {
  const to = res.headers.get('location') ?? '';
  console.error(
    `\n被重定向到 ${to || '(未知)'} —— cookie 已失效或没带上。\n` +
      '请重新从浏览器复制一份新的 Cookie。',
  );
  process.exit(1);
}
if (!res.ok) {
  console.error(`\n抓取失败：HTTP ${res.status}`);
  process.exit(1);
}

const html = await res.text();
const iTeam = html.indexOf('team-label-list');
const iProj = html.indexOf('project-label-list');

if (iTeam < 0) {
  console.error('\n页面里没找到 team-label-list —— 可能 cookie 无效，或页面结构变了。');
  process.exit(1);
}

const globalLabels = extractLabels(iProj > iTeam ? html.slice(iTeam, iProj) : html.slice(iTeam));
const projectLabels = iProj > iTeam ? extractLabels(html.slice(iProj)) : [];

if (globalLabels.length === 0) {
  console.error('\n没解析出任何全局标签 —— 页面结构可能变了。');
  process.exit(1);
}

const previous = existsSync(labelsFile)
  ? JSON.parse(readFileSync(labelsFile, 'utf8'))
  : null;
const isFirstRun = previous === null || (previous.labels?.global ?? []).length === 0;

const next = {
  teamId,
  teamName: previous.teamName ?? null,
  syncedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  source: url,
  labels: {
    global: globalLabels.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    project: projectLabels.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
  },
};

writeFileSync(labelsFile, `${JSON.stringify(next, null, 2)}\n`);

const g = diff(previous?.labels?.global ?? [], next.labels.global);
process.stdout.write(
  `\n已更新 ${labelsFile}\n` +
    `  全局标签 ${next.labels.global.length} 个` +
    (isFirstRun ? '' : `（上次 ${previous?.labels?.global?.length ?? 0} 个）`) +
    '\n' +
    `  项目标签 ${next.labels.project.length} 个\n`,
);

if (isFirstRun) {
  // 首次同步把全部标签都当成「新增」没有意义，只列名字
  process.stdout.write(
    `\n  全局标签：${next.labels.global.map((x) => x.name).join('、')}\n`,
  );
} else {
  if (g.added.length) process.stdout.write(`\n  新增：${g.added.map((x) => `${x.name}(${x.id})`).join('、')}\n`);
  if (g.removed.length) process.stdout.write(`\n  移除：${g.removed.map((x) => `${x.name}(${x.id})`).join('、')}\n`);
  if (g.renamed.length) {
    process.stdout.write(`\n  改名：${g.renamed.map((x) => `${x.id} ${x.from} → ${x.to}`).join('、')}\n`);
  }
  if (!g.added.length && !g.removed.length && !g.renamed.length) {
    process.stdout.write('\n  与上次一致，没有变化。\n');
  }
}
process.stdout.write('\n改动要生效，重启 MCP 客户端即可（服务每次启动都重新读这个文件）。\n');
