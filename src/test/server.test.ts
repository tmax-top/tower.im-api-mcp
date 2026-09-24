import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));

/** 期望注册的工具总数——改动工具集时同步更新，作为回归基线 */
const EXPECTED_TOOL_COUNT = 54;

const CRITICAL_TOOLS = [
  'tower_get_current_user',
  'tower_list_teams',
  'tower_list_team_members',
  'tower_list_projects',
  'tower_list_todolists',
  'tower_list_todos',
  'tower_create_todo',
  'tower_complete_todo',
  'tower_add_todo_comment',
  'tower_upload_file',
  'tower_get_auth_state',
];

test('服务能通过 stdio 启动并暴露全部工具', async () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  // 指向临时令牌文件，避免动到用户真实的凭证
  env.TOWER_TOKEN_FILE = join(tmpdir(), `tower-mcp-smoke-${process.pid}.json`);
  delete env.TOWER_ACCESS_TOKEN;
  delete env.TOWER_REFRESH_TOKEN;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(here, '..', 'index.js')],
    env,
  });

  const client = new Client({ name: 'tower-mcp-smoke', version: '1.0.0' });

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();

    assert.equal(
      tools.length,
      EXPECTED_TOOL_COUNT,
      `工具数量应为 ${EXPECTED_TOOL_COUNT}，实际 ${tools.length}`,
    );

    const names = new Set(tools.map((t) => t.name));
    for (const name of CRITICAL_TOOLS) {
      assert.ok(names.has(name), `缺少关键工具 ${name}`);
    }

    // 每个工具都必须有可读描述和对象型 inputSchema，否则模型无法正确调用
    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length >= 8, `${tool.name} 描述过短`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} 的 inputSchema 不是 object`);
    }

    // 调用一个纯本地、不依赖网络与凭证的工具
    const result = await client.callTool({ name: 'tower_get_auth_state', arguments: {} });
    const first = (result.content as Array<{ type: string; text: string }>)[0];
    assert.equal(first.type, 'text');
    assert.match(first.text, /baseUrl/);
    assert.match(first.text, /tower\.im/);
  } finally {
    await client.close();
  }
});

test('调用不存在的工具会报错而不是崩溃', async () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.TOWER_TOKEN_FILE = join(tmpdir(), `tower-mcp-smoke-missing-${process.pid}.json`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(here, '..', 'index.js')],
    env,
  });
  const client = new Client({ name: 'tower-mcp-smoke-2', version: '1.0.0' });

  try {
    await client.connect(transport);

    // 不同 SDK 版本对未知工具的处理不一致：可能抛异常，也可能返回 isError 结果。
    // 两者都算「正确报错」，只要不是静默成功。
    let threw = false;
    let result: { isError?: boolean } | undefined;
    try {
      result = (await client.callTool({ name: 'tower_not_exist', arguments: {} })) as {
        isError?: boolean;
      };
    } catch {
      threw = true;
    }
    assert.ok(threw || result?.isError === true, '调用不存在的工具应当报错而不是静默成功');
  } finally {
    await client.close();
  }
});
