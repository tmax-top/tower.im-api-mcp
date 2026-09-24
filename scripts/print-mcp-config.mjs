#!/usr/bin/env node
/**
 * 打印可直接粘贴到 MCP 客户端的配置片段。
 *
 * 两个路径都是自动推导的，不用手写：
 *   node 可执行文件  -> process.execPath（当前正在跑这个脚本的 node）
 *   项目入口         -> 由本脚本自身位置反推项目根目录
 *
 * 用法：npm run print-config
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const entry = join(projectRoot, 'dist', 'index.js');
const launcher = join(projectRoot, 'bin', 'tower-mcp');
const nodeBin = process.execPath;
const envFile = join(homedir(), '.tower-mcp', 'env');

const built = existsSync(entry);
const envFileExists = existsSync(envFile);

function section(title, body) {
  process.stdout.write(`\n${title}\n${'─'.repeat(title.length)}\n${body}\n`);
}

process.stdout.write('tower-mcp MCP 配置\n');
process.stdout.write(`  项目目录 : ${projectRoot}\n`);
process.stdout.write(`  node     : ${nodeBin}  (${process.version})\n`);
process.stdout.write(`  入口文件 : ${entry}${built ? '' : '  ← 还不存在，请先 npm run build'}\n`);
process.stdout.write(`  凭证文件 : ${envFile}${envFileExists ? '' : '  ← 还不存在，请先 npm run auth'}\n`);

section(
  '推荐：用启动器（不含 node 路径，node 换版本也不会失效）',
  JSON.stringify(
    {
      mcpServers: {
        tower: {
          type: 'stdio',
          command: launcher,
          args: [],
        },
      },
    },
    null,
    2,
  ),
);

section(
  '备选：显式指定 node 路径（路径里带版本号时，升级后需要重新生成）',
  JSON.stringify(
    {
      mcpServers: {
        tower: {
          type: 'stdio',
          command: nodeBin,
          args: [entry],
        },
      },
    },
    null,
    2,
  ),
);

section(
  '提示',
  [
    '1. 结构必须是 type:"stdio" + command 字符串 + args 数组。',
    '   把 command 写成数组会导致条目被静默忽略——配置里有，界面上却不显示。',
    '2. 凭证不写进配置，由 bin/tower-mcp 从上面的凭证文件读取，密钥不进入客户端配置。',
    '   还没有的话：export TOWER_CLIENT_ID=... TOWER_CLIENT_SECRET=... && npm run auth',
    '3. 项目目录移动后，重新跑一次 npm run print-config 即可。',
    '4. 改完配置必须重启客户端，再到连接器管理页右上角的「自定义连接器」点一次「信任」。',
  ].join('\n'),
);
