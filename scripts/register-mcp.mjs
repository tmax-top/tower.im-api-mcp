#!/usr/bin/env node
/**
 * 把 tower-mcp 注册到（或从）MCP 客户端配置里。
 *
 * 为什么用 node 而不是在 shell 里拼 JSON：配置文件里有用户自己的其他 MCP 条目，
 * 必须**安全合并**，绝不能整体覆盖。而且改之前会先备份。
 *
 * 用法：
 *   node scripts/register-mcp.mjs register      # 写入/更新 tower 条目
 *   node scripts/register-mcp.mjs unregister    # 移除 tower 条目
 *   node scripts/register-mcp.mjs status        # 查看当前条目
 *
 * 环境变量：
 *   TOWER_MCP_CONFIG                         配置文件路径（默认 ~/.workbuddy-ai/mcp.json）
 *   TOWER_MCP_NAME                           条目名（默认 tower）
 *   TOWER_CLIENT_ID / TOWER_CLIENT_SECRET    写入凭证文件（不是配置的 env 字段）
 *   TOWER_ENV_FILE                           凭证文件路径（默认 ~/.tower-mcp/env）
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const launcher = join(projectRoot, 'bin', 'tower-mcp');

function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

const configPath = expandHome(process.env.TOWER_MCP_CONFIG ?? '~/.workbuddy-ai/mcp.json');
const envFilePath = expandHome(process.env.TOWER_ENV_FILE ?? '~/.tower-mcp/env');
const entryName = process.env.TOWER_MCP_NAME ?? 'tower';

function item(label, value) {
  process.stdout.write(`  ${label.padEnd(8)} ${value}\n`);
}

function readConfig() {
  if (!existsSync(configPath)) return { mcpServers: {} };

  const raw = readFileSync(configPath, 'utf8').trim();
  if (!raw) return { mcpServers: {} };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`配置文件不是合法 JSON，已中止以免损坏它：${configPath}\n  ${err.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`配置文件顶层不是 JSON 对象：${configPath}`);
  }
  if (typeof parsed.mcpServers !== 'object' || parsed.mcpServers === null) {
    parsed.mcpServers = {};
  }
  return parsed;
}

function writeConfig(config) {
  mkdirSync(dirname(configPath), { recursive: true });

  if (existsSync(configPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${configPath}.bak-${stamp}`;
    copyFileSync(configPath, backup);
    item('备份', backup);
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * 生成 MCP 条目。
 *
 * **必须用这种结构**：`command` 是字符串、`args` 是数组、`type` 是 "stdio"。
 * WorkBuddy 只认它自己写出的这种格式；把 `command` 写成数组（某些 MCP 客户端
 * 支持那种写法）会导致条目被**静默忽略**——配置里明明有，界面上就是不显示。
 * 已实测：只有这种格式的条目才会出现。
 *
 * 凭证不走配置里的 env 字段，而是由 bin/tower-mcp 从凭证文件读取。
 */
function buildEntry() {
  return {
    type: 'stdio',
    command: launcher,
    args: [],
  };
}

/** 把凭证写进独立文件（权限 600），供启动器读取 */
function writeEnvFile(clientId, clientSecret) {
  if (!clientId && !clientSecret) return false;

  mkdirSync(dirname(envFilePath), { recursive: true });
  const lines = [
    '# tower-mcp 凭证。由 scripts/register-mcp.mjs 写入，bin/tower-mcp 读取。',
    '# 权限 600，不要提交到代码仓库。',
  ];
  if (clientId) lines.push(`TOWER_CLIENT_ID=${clientId}`);
  if (clientSecret) lines.push(`TOWER_CLIENT_SECRET=${clientSecret}`);
  writeFileSync(envFilePath, `${lines.join('\n')}\n`);
  chmodSync(envFilePath, 0o600);
  return true;
}

function register() {
  const config = readConfig();
  const existed = Object.prototype.hasOwnProperty.call(config.mcpServers, entryName);

  config.mcpServers[entryName] = buildEntry();
  writeConfig(config);

  item(existed ? '已更新' : '已写入', `${configPath}  ->  mcpServers.${entryName}`);
  item('启动命令', launcher);

  const clientId = process.env.TOWER_CLIENT_ID?.trim();
  const clientSecret = process.env.TOWER_CLIENT_SECRET?.trim();

  if (writeEnvFile(clientId, clientSecret)) {
    item('凭证文件', envFilePath);
  } else {
    process.stdout.write(
      '\n  注意：没有提供 TOWER_CLIENT_ID / TOWER_CLIENT_SECRET，也没找到已有凭证文件。\n' +
        '  服务仍能用令牌文件启动，但 access_token 2 小时后过期就没法自动刷新了。\n' +
        '  补上凭证：TOWER_CLIENT_ID=... TOWER_CLIENT_SECRET=... ./install.sh\n',
    );
  }
}

function unregister() {
  const config = readConfig();
  if (!Object.prototype.hasOwnProperty.call(config.mcpServers, entryName)) {
    item('跳过', `配置里没有 ${entryName} 条目`);
    return;
  }
  delete config.mcpServers[entryName];
  writeConfig(config);
  item('已移除', `${configPath}  ->  mcpServers.${entryName}`);
}

function status() {
  item('配置文件', configPath);
  if (!existsSync(configPath)) {
    item('状态', '文件不存在');
    return;
  }
  const config = readConfig();
  const entry = config.mcpServers[entryName];
  if (!entry) {
    item('状态', `没有 ${entryName} 条目`);
    return;
  }
  item('条目', JSON.stringify(entry, null, 2).split('\n').join('\n           '));
}

const command = process.argv[2] ?? 'register';

try {
  switch (command) {
    case 'register':
      register();
      break;
    case 'unregister':
      unregister();
      break;
    case 'status':
      status();
      break;
    default:
      process.stderr.write(`未知命令：${command}（可用：register / unregister / status）\n`);
      process.exit(2);
  }
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
