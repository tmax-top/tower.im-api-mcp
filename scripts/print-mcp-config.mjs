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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const entry = join(projectRoot, 'dist', 'index.js');
const launcher = join(projectRoot, 'bin', 'tower-mcp');
const nodeBin = process.execPath;

const built = existsSync(entry);

function section(title, body) {
  process.stdout.write(`\n${title}\n${'─'.repeat(title.length)}\n${body}\n`);
}

process.stdout.write('tower-mcp MCP 配置\n');
process.stdout.write(`  项目目录 : ${projectRoot}\n`);
process.stdout.write(`  node     : ${nodeBin}  (${process.version})\n`);
process.stdout.write(`  入口文件 : ${entry}${built ? '' : '  ← 还不存在，请先 npm run build'}\n`);

const envBlock = {
  TOWER_CLIENT_ID: '你的应用ID',
  TOWER_CLIENT_SECRET: '你的私钥',
};

section(
  '推荐：用启动器（不含 node 路径，node 换版本也不会失效）',
  JSON.stringify(
    {
      mcpServers: {
        tower: {
          command: [launcher],
          env: envBlock,
          type: 'local',
          enabled: true,
          disabled: false,
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
          command: [nodeBin, entry],
          env: envBlock,
          type: 'local',
          enabled: true,
          disabled: false,
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
    '1. env 里的两个值必须填成你自己的；令牌走 ~/.tower-mcp/token.json，不用写进配置。',
    '2. 项目目录移动后，重新跑一次 npm run print-config 即可。',
    '3. 保存配置后还需要到连接器管理页右上角的「自定义连接器」入口点一次「信任」。',
    '4. 授权还没做的话：export TOWER_CLIENT_ID=... TOWER_CLIENT_SECRET=... && npm run auth',
  ].join('\n'),
);
