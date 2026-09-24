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

/** 必须做二次确认的删除类工具。新增删除工具时要一并加进来 */
const DELETE_TOOLS = [
  'tower_delete_project',
  'tower_delete_todolist',
  'tower_delete_todo',
  'tower_delete_topic',
  'tower_delete_upload',
  'tower_delete_time_log',
];

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

type ToolResult = {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
};

/** 构造一份干净的 env：指向临时令牌文件，不碰用户真实凭证 */
function buildEnv(tag: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.TOWER_TOKEN_FILE = join(tmpdir(), `tower-mcp-${tag}-${process.pid}.json`);
  delete env.TOWER_ACCESS_TOKEN;
  delete env.TOWER_REFRESH_TOKEN;
  return env;
}

/**
 * 启动一个连到本地服务的客户端。
 * @param useLauncher true 时通过 bin/tower-mcp 启动器拉起（用于验证启动器可用）
 */
async function connectClient(tag: string, useLauncher = false): Promise<Client> {
  const transport = useLauncher
    ? new StdioClientTransport({
        command: join(here, '..', '..', 'bin', 'tower-mcp'),
        env: buildEnv(tag),
      })
    : new StdioClientTransport({
        command: process.execPath,
        args: [join(here, '..', 'index.js')],
        env: buildEnv(tag),
      });

  const client = new Client({ name: `tower-mcp-${tag}`, version: '1.0.0' });
  await client.connect(transport);
  return client;
}

/** 不同 SDK 版本对失败的处理不一致：可能抛异常，也可能返回 isError 结果。统一成后者 */
async function callToolSafe(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    return (await client.callTool({ name, arguments: args })) as ToolResult;
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: (err as Error)?.message ?? String(err) }],
    };
  }
}

function textOf(result: ToolResult): string {
  return (result.content ?? []).map((c) => c.text ?? '').join('\n');
}

test('服务能通过 stdio 启动并暴露全部工具', async () => {
  const client = await connectClient('smoke');
  try {
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
    for (const name of DELETE_TOOLS) {
      assert.ok(names.has(name), `缺少删除工具 ${name}`);
    }

    // 每个工具都必须有可读描述和对象型 inputSchema，否则模型无法正确调用
    for (const tool of tools) {
      assert.ok(tool.description && tool.description.length >= 8, `${tool.name} 描述过短`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} 的 inputSchema 不是 object`);
    }

    // 调用一个纯本地、不依赖网络与凭证的工具
    const result = await client.callTool({ name: 'tower_get_auth_state', arguments: {} });
    const text = textOf(result as ToolResult);
    assert.match(text, /baseUrl/);
    assert.match(text, /tower\.im/);
  } finally {
    await client.close();
  }
});

test('所有删除类工具都把 confirm 声明为必填且只接受 true', async () => {
  const client = await connectClient('schema');
  try {
    const { tools } = await client.listTools();

    for (const name of DELETE_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `找不到工具 ${name}`);

      const schema = tool.inputSchema as {
        properties?: Record<string, { const?: unknown; type?: string }>;
        required?: string[];
      };

      assert.ok(
        schema.required?.includes('confirm'),
        `${name} 的 confirm 必须是必填参数，否则模型可以绕过二次确认`,
      );
      assert.equal(
        schema.properties?.confirm?.const,
        true,
        `${name} 的 confirm 必须限定为字面量 true（不能是普通 boolean）`,
      );
      // 描述里要写清何时才能传 true，模型据此决定是否先征求用户同意
      assert.match(
        tool.description ?? '',
        /同意|确认/,
        `${name} 的描述里应说明需要用户确认`,
      );
    }
  } finally {
    await client.close();
  }
});

test('缺少 confirm 时删除会被参数校验拦下，不会走到真正的删除请求', async () => {
  const client = await connectClient('confirm');
  try {
    // 1) 完全不传 confirm
    const missing = await callToolSafe(client, 'tower_delete_todo', { todo_id: 'abc' });
    assert.equal(missing.isError, true, '不传 confirm 必须失败');
    assert.match(
      textOf(missing),
      /confirm/i,
      '报错必须指向 confirm 参数（说明是校验拦下的），而不是认证或网络错误',
    );

    // 2) 显式传 false —— z.literal(true) 应当拒绝
    const falsy = await callToolSafe(client, 'tower_delete_todo', {
      todo_id: 'abc',
      confirm: false,
    });
    assert.equal(falsy.isError, true, 'confirm=false 必须失败');
    assert.match(textOf(falsy), /confirm/i);

    // 3) 对照：传了 confirm: true 就应当通过校验，转而因缺少凭证而失败。
    //    这条对照很关键——它证明「拦下前两种情况」的确实是 confirm 校验，
    //    而不是碰巧因为别的原因失败。
    const allowed = await callToolSafe(client, 'tower_delete_todo', {
      todo_id: 'abc',
      confirm: true,
    });
    assert.equal(allowed.isError, true, '无凭证时应当失败');
    assert.match(
      textOf(allowed),
      /凭证|TOWER_/,
      'confirm: true 应当通过参数校验，之后才因缺少凭证失败',
    );
  } finally {
    await client.close();
  }
});

test('非删除工具不应带 confirm 参数', async () => {
  const client = await connectClient('noconfirm');
  try {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      if (DELETE_TOOLS.includes(tool.name)) continue;
      const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      assert.ok(
        !('confirm' in props),
        `${tool.name} 不是删除工具，不该要求 confirm`,
      );
    }
  } finally {
    await client.close();
  }
});

test('调用不存在的工具会报错而不是崩溃', async () => {
  const client = await connectClient('missing');
  try {
    const result = await callToolSafe(client, 'tower_not_exist', {});
    assert.equal(result.isError, true, '调用不存在的工具应当报错而不是静默成功');
  } finally {
    await client.close();
  }
});

test('启动器 bin/tower-mcp 能自行定位 node 并拉起服务', async () => {
  // 启动器是为了让 MCP 配置里不必写死 node 路径（运行时路径常带版本号，升级即失效）。
  // 它是 shell 脚本，最容易悄悄坏掉，所以这里真的把它当 MCP 服务拉起来验证一遍。
  const client = await connectClient('launcher', true);
  try {
    const { tools } = await client.listTools();
    assert.equal(
      tools.length,
      EXPECTED_TOOL_COUNT,
      `通过启动器启动时工具数应为 ${EXPECTED_TOOL_COUNT}，实际 ${tools.length}`,
    );

    const result = await client.callTool({ name: 'tower_get_auth_state', arguments: {} });
    assert.match(textOf(result as ToolResult), /baseUrl/);
  } finally {
    await client.close();
  }
});
