import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TowerClient } from '../tower-client.js';
import { READ_ONLY, callTool, pagination } from './helpers.js';

export function registerActivityTools(server: McpServer, client: TowerClient): number {
  server.registerTool(
    'tower_list_notifications',
    {
      title: '获取通知列表',
      description:
        '获取当前账号在指定团队收到的通知（被指派、被 @、任务变动等）。适合回答「我最近有什么待处理的消息」。',
      inputSchema: {
        team_id: z.string().describe('团队 id'),
        page: z.number().int().positive().optional().describe('页码，从 1 开始'),
        page_size: z.number().int().positive().optional().describe('每页条数，默认 25'),
      },
      annotations: READ_ONLY,
    },
    ({ team_id, page, page_size }) =>
      callTool(() => client.get(`/teams/${team_id}/notifications`, pagination(page, page_size))),
  );

  server.registerTool(
    'tower_list_events',
    {
      title: '获取团队动态',
      description:
        '获取团队的操作动态流（谁在什么时候改了哪个任务）。支持按成员或项目过滤，也可用 last_item_id 增量拉取。' +
        '适合生成日报/周报、复盘团队活动。',
      inputSchema: {
        team_id: z.string().describe('团队 id'),
        limit: z.number().int().positive().max(200).optional().describe('获取条数，默认 20'),
        by_member: z.string().optional().describe('只看指定成员产生的动态，传成员 id'),
        by_project: z.string().optional().describe('只看指定项目产生的动态，传项目 id'),
        last_item_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe('上次拉取到的最后一条动态 id，用于翻页/增量拉取'),
      },
      annotations: READ_ONLY,
    },
    ({ team_id, limit, by_member, by_project, last_item_id }) =>
      callTool(() =>
        // client 会自动跳过 undefined 的查询参数
        client.get(`/teams/${team_id}/events`, {
          limit,
          by_member,
          by_project,
          last_item_id,
        }),
      ),
  );

  server.registerTool(
    'tower_get_auth_state',
    {
      title: '查看授权状态',
      description:
        '查看当前 Tower 授权的本地状态：用的是哪个账号、access_token 是否还有效、刷新令牌是否配置齐全。' +
        '当其他接口报 401 认证失败时，先用它排查。此工具不发起网络请求。',
      annotations: READ_ONLY,
    },
    () => callTool(async () => client.describeAuthState()),
  );

  return 3;
}
