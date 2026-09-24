import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TowerClient } from '../tower-client.js';
import {
  DELETE_CONFIRM,
  DESTRUCTIVE,
  PAGE_DESC,
  READ_ONLY,
  WRITE,
  callTool,
  omitUndefined,
  pagination,
} from './helpers.js';

const TIME_DESC = '时间点，格式 2026-09-30T14:00';

export function registerTimeLogTools(server: McpServer, client: TowerClient): number {
  server.registerTool(
    'tower_list_project_time_logs',
    {
      title: '获取项目下所有工时',
      description: '列出某个项目下登记的全部工时记录，用于统计人力投入。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
        page: z.number().int().positive().optional().describe(PAGE_DESC),
      },
      annotations: READ_ONLY,
    },
    ({ project_id, page }) =>
      callTool(() => client.get(`/projects/${project_id}/time_logs`, pagination(page))),
  );

  server.registerTool(
    'tower_list_todo_time_logs',
    {
      title: '获取任务下所有工时',
      description: '列出某个任务下登记的工时记录。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
        page: z.number().int().positive().optional().describe(PAGE_DESC),
      },
      annotations: READ_ONLY,
    },
    ({ todo_id, page }) =>
      callTool(() => client.get(`/todos/${todo_id}/time_logs`, pagination(page))),
  );

  server.registerTool(
    'tower_add_time_log',
    {
      title: '添加工时',
      description: '给某个任务登记一条工时记录。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
        starts_at: z.string().describe(`开始时间，${TIME_DESC}`),
        ends_at: z.string().describe(`结束时间，${TIME_DESC}`),
        creator_id: z.string().optional().describe('工时归属成员 id，默认当前账号'),
        desc: z.string().optional().describe('工时说明'),
      },
      annotations: WRITE,
    },
    ({ todo_id, ...rest }) =>
      callTool(() => client.post(`/todos/${todo_id}/time_logs`, { time_log: omitUndefined(rest) })),
  );

  server.registerTool(
    'tower_update_time_log',
    {
      title: '更新工时信息',
      description: '修改一条工时记录的起止时间、归属人或说明。',
      inputSchema: {
        time_log_id: z.string().describe('工时记录 id'),
        starts_at: z.string().optional().describe(`开始时间，${TIME_DESC}`),
        ends_at: z.string().optional().describe(`结束时间，${TIME_DESC}`),
        creator_id: z.string().optional().describe('工时归属成员 id'),
        desc: z.string().optional().describe('工时说明'),
      },
      annotations: WRITE,
    },
    ({ time_log_id, ...rest }) =>
      callTool(() => client.patch(`/time_logs/${time_log_id}`, { time_log: omitUndefined(rest) })),
  );

  server.registerTool(
    'tower_delete_time_log',
    {
      title: '删除工时',
      description:
        '删除一条工时记录，不可逆。' +
        '调用前必须先向用户说明要删除的工时记录 id 与归属人，取得明确同意后再传 confirm: true。',
      inputSchema: {
        time_log_id: z.string().describe('工时记录 id'),
        ...DELETE_CONFIRM,
      },
      annotations: DESTRUCTIVE,
    },
    ({ time_log_id }) => callTool(() => client.delete(`/time_logs/${time_log_id}`)),
  );

  return 5;
}
