#!/usr/bin/env node
/**
 * tower-mcp —— Tower (tower.im) 的 MCP 服务器
 *
 * 通过 stdio 与 MCP 客户端通信。注意：stdio 传输下 stdout 被协议独占，
 * 任何调试输出都必须写 stderr，否则会破坏协议帧导致客户端报解析错误。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { registerAllTools } from './tools/index.js';
import { TowerClient } from './tower-client.js';

const SERVER_NAME = 'tower-mcp';
const SERVER_VERSION = '1.0.0';

const INSTRUCTIONS = `Tower 项目管理工具集。Tower 的资源层级是：团队(team) -> 项目(project) -> 任务清单(todolist) -> 任务(todo)。

调用顺序建议：
1. 不确定团队 id 时，先调用 tower_list_teams。
2. 查项目用 tower_list_projects，查清单用 tower_list_todolists，查任务用 tower_list_todos。
3. 需要把「张三」这类人名换成 id 时，调用 tower_list_team_members。

注意事项：
- 所有 id 都是 32 位十六进制字符串，不要自己编造，必须从上一个查询结果里取。
- 创建任务必须知道 todolist_id，所以通常要先走 团队 -> 项目 -> 清单 这条链路。
- **列表类工具的返回值恒定是对象 { items: [...], has_more: bool, next_page?: number }**，
  数据在 items 里；单条查询（get_*）才直接返回对象。结构不会随数据变化。
- 翻页：has_more 为 true 时可用 next_page 作为 page 参数继续往后翻。
  has_more 恒为 false 的接口表示响应里没有分页线索，此时自行递增 page 参数尝试。
- 任务描述(desc)、讨论正文、评论支持 HTML；读取时会被自动转成纯文本。
- **删除类工具必须二次确认**：所有 tower_delete_* 工具都带一个必填的 confirm 参数，
  且只接受 true。调用前必须先在对话中向用户说明要删除的对象（名称 + id），
  得到用户明确同意后再传 confirm: true。
  用户此前说过要删不算数，每次删除都要重新确认；用户未表态时应先询问，不要替用户决定。
- 遇到 401 认证失败时，调用 tower_get_auth_state 查看授权状态。`;

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new TowerClient(config);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  const toolCount = registerAllTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    `[${SERVER_NAME}] v${SERVER_VERSION} 已启动，注册 ${toolCount} 个工具；` +
      `API 地址 ${config.baseUrl}\n`,
  );
}

main().catch((err: unknown) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[${SERVER_NAME}] 启动失败：${detail}\n`);
  process.exit(1);
});
