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
import { labelsFileHint } from './labels.js';
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
- **⚠️ desc / 评论 / 讨论正文是 HTML，Tower 只认一份固定白名单，白名单外的标签会被
  整个删掉（不是转义）**——包括 <token>、<MK> 这类占位符，以及 <table>、<u>、<mark>。
  本服务会在发送前把这些标签自动转义成字面量，并在结果里说明转义了什么，所以写
  <token> 是安全的。**但不要依赖它**：写 HTML 时请只用白名单标签
  （p br hr div span h1-h6 b strong i em big tt small sub sup del ins ul ol li dl dt dd
  blockquote pre code samp kbd var a img address abbr acronym cite）。
  这条对导入 QA 报告尤其重要——复现步骤里的尖括号占位符最容易这样丢。
- **删除类工具必须二次确认**：所有 tower_delete_* 工具都带一个必填的 confirm 参数，
  且只接受 true。调用前必须先在对话中向用户说明要删除的对象（名称 + id），
  得到用户明确同意后再传 confirm: true。
  用户此前说过要删不算数，每次删除都要重新确认；用户未表态时应先询问，不要替用户决定。
- **标签**：Tower 的 API 没有标签接口，标签名与数字 id 的对应关系存在本地映射文件里
  （由 tower_list_labels 读取）。给任务打标签时 **label_ids 可以直接写标签名**
  （如 label_ids: ["H5"]），比记数字 id 可靠——Tower 对无效 id 是静默忽略的。
  只有**全局标签**能用；项目标签传进去不会生效，本服务会直接报错拦下。
  如果本地还没有映射文件，任何带标签的操作都会附带一段同步指引，按它执行一次即可。
- **当前操作人**：安装时可能选定了某位成员作为「当前操作人」（client_id 往往是管理员的，
  而使用者是团队成员）。此时 tower_create_todo 不传 assignee_id 会默认指派给他，
  tower_list_member_todos 不传 member_id 会默认查他。想知道是谁、或没选定，
  调用 tower_get_auth_state 看 operator 字段。注意：API 的认证身份仍是 client_id 的账号，
  任务的 creator 由令牌决定、改不了；操作人能影响的是 assignee 这类显式接受成员 id 的字段。
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

  // 启动时检查标签映射。缺了不影响启动（标签只是任务的一个可选字段），
  // 但要在日志里说清楚，免得用户「打了标签没报错却也没生效」时找不到原因。
  const labelsHint = labelsFileHint();
  if (labelsHint) {
    process.stderr.write(`[${SERVER_NAME}] ${labelsHint}\n`);
  }
}

main().catch((err: unknown) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[${SERVER_NAME}] 启动失败：${detail}\n`);
  process.exit(1);
});
