import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TowerClient } from '../tower-client.js';
import { PAGE_DESC, READ_ONLY, SIZE_DESC, callTool, pagination } from './helpers.js';

export function registerMemberTools(server: McpServer, client: TowerClient): number {
  server.registerTool(
    'tower_list_team_members',
    {
      title: '获取团队全部成员',
      description:
        '列出团队成员，返回成员 id、昵称、角色、所属分组。当需要把任务指派给某人、或需要把「张三」这个名字换成 member_id 时用它。',
      inputSchema: {
        team_id: z.string().describe('团队 id'),
        page: z.number().int().positive().optional().describe(PAGE_DESC),
        page_size: z.number().int().positive().optional().describe(SIZE_DESC),
      },
      annotations: READ_ONLY,
    },
    ({ team_id, page, page_size }) =>
      callTool(() => client.get(`/teams/${team_id}/members`, pagination(page, page_size))),
  );

  server.registerTool(
    'tower_get_member',
    {
      title: '获取成员信息',
      description: '按成员 id 获取某个成员的详细信息（昵称、角色、电话、备注、加入时间）。',
      inputSchema: {
        member_id: z.string().describe('成员 id'),
      },
      annotations: READ_ONLY,
    },
    ({ member_id }) => callTool(() => client.get(`/members/${member_id}`)),
  );

  server.registerTool(
    'tower_list_member_todos',
    {
      title: '获取成员的任务',
      description:
        '查询某个成员名下（被指派 / 由他创建）的未完成或已完成任务。常用于回答「我手上还有哪些活」「小王这周做完了什么」。',
      inputSchema: {
        member_id: z.string().describe('成员 id'),
        scope: z
          .enum(['assigned', 'created'])
          .describe('assigned = 指派给他的任务；created = 由他创建的任务'),
        status: z.enum(['uncompleted', 'completed']).describe('uncompleted = 未完成；completed = 已完成'),
        box: z
          .number()
          .int()
          .min(0)
          .max(3)
          .optional()
          .describe('仅 scope=assigned 且 status=uncompleted 时有效：0 新任务 / 1 今天 / 2 接下来 / 3 以后'),
        page: z.number().int().positive().optional().describe(PAGE_DESC),
      },
      annotations: READ_ONLY,
    },
    ({ member_id, scope, status, box, page }) =>
      callTool(() =>
        client.get(`/members/${member_id}/${scope}_${status}_todos`, {
          ...pagination(page),
          ...(box !== undefined ? { box } : {}),
        }),
      ),
  );

  return 3;
}
