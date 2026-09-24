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

export function registerProjectTools(server: McpServer, client: TowerClient): number {
  server.registerTool(
    'tower_list_projects',
    {
      title: '获取团队中所有项目',
      description: '列出指定团队下的全部项目（含已归档标记）。项目 id 是查询任务清单的入口。',
      inputSchema: {
        team_id: z.string().describe('团队 id'),
      },
      annotations: READ_ONLY,
    },
    ({ team_id }) => callTool(() => client.get(`/teams/${team_id}/projects`)),
  );

  server.registerTool(
    'tower_get_project',
    {
      title: '获取项目信息',
      description: '按项目 id 获取项目详情，包括名称、描述、成员、归档状态。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
      },
      annotations: READ_ONLY,
    },
    ({ project_id }) => callTool(() => client.get(`/projects/${project_id}`)),
  );

  server.registerTool(
    'tower_create_project',
    {
      title: '创建项目',
      description: '在指定团队下创建新项目。',
      inputSchema: {
        team_id: z.string().describe('团队 id'),
        name: z.string().describe('项目名称'),
        desc: z.string().optional().describe('项目描述'),
        member_ids: z.array(z.string()).optional().describe('项目成员 id 列表'),
      },
      annotations: WRITE,
    },
    ({ team_id, name, desc, member_ids }) =>
      callTool(() =>
        client.post(`/teams/${team_id}/projects`, {
          project: omitUndefined({ name, desc, member_ids }),
        }),
      ),
  );

  server.registerTool(
    'tower_update_project',
    {
      title: '更新项目信息',
      description: '修改项目的名称、描述或成员。只传需要改的字段即可。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
        name: z.string().optional().describe('新的项目名称'),
        desc: z.string().optional().describe('新的项目描述'),
        member_ids: z.array(z.string()).optional().describe('新的项目成员 id 列表（全量覆盖）'),
      },
      annotations: WRITE,
    },
    ({ project_id, name, desc, member_ids }) =>
      callTool(() =>
        client.patch(`/projects/${project_id}`, {
          project: omitUndefined({ name, desc, member_ids }),
        }),
      ),
  );

  server.registerTool(
    'tower_delete_project',
    {
      title: '删除项目',
      description:
        '删除指定项目，不可逆，且会连同项目下的清单与任务一并删除。' +
        '调用前必须先向用户说明要删除的项目名称与 id，取得明确同意后再传 confirm: true。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
        ...DELETE_CONFIRM,
      },
      annotations: DESTRUCTIVE,
    },
    ({ project_id }) => callTool(() => client.delete(`/projects/${project_id}`)),
  );

  server.registerTool(
    'tower_list_project_members',
    {
      title: '获取项目成员',
      description: '列出某个项目的参与成员，可用于判断任务应该指派给谁。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
        page: z.number().int().positive().optional().describe(PAGE_DESC),
      },
      annotations: READ_ONLY,
    },
    ({ project_id, page }) =>
      callTool(() => client.get(`/projects/${project_id}/members`, pagination(page))),
  );

  return 6;
}
