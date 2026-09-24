import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TowerClient } from '../tower-client.js';
import { READ_ONLY, WRITE, callTool } from './helpers.js';

export function registerTeamTools(server: McpServer, client: TowerClient): number {
  server.registerTool(
    'tower_list_teams',
    {
      title: '获取团队列表',
      description:
        '获取当前账号加入的所有 Tower 团队。返回的团队 id 是后续绝大多数接口的必要参数，因此这通常是第一个应该调用的工具。',
      annotations: READ_ONLY,
    },
    () => callTool(() => client.get('/teams')),
  );

  server.registerTool(
    'tower_create_team',
    {
      title: '创建团队',
      description: '创建一个新的 Tower 团队。',
      inputSchema: {
        name: z.string().describe('团队名称'),
      },
      annotations: WRITE,
    },
    ({ name }) => callTool(() => client.post('/teams', { team: { name } })),
  );

  server.registerTool(
    'tower_update_team',
    {
      title: '更改团队名称',
      description: '修改指定团队的名称。新名称会立即对团队内所有成员生效。',
      inputSchema: {
        team_id: z.string().describe('团队 id'),
        name: z.string().describe('新的团队名称'),
      },
      annotations: WRITE,
    },
    ({ team_id, name }) => callTool(() => client.patch(`/teams/${team_id}`, { team: { name } })),
  );

  server.registerTool(
    'tower_get_my_team_member',
    {
      title: '获取当前账号在团队中的信息',
      description:
        '获取当前账号在指定团队中的成员信息（成员 id、昵称、角色、分组）。当需要「我自己」的成员 id（例如把自己设为任务负责人）时用它。',
      inputSchema: {
        team_id: z.string().describe('团队 id'),
      },
      annotations: READ_ONLY,
    },
    ({ team_id }) => callTool(() => client.get(`/teams/${team_id}/member`)),
  );

  server.registerTool(
    'tower_resolve_team_resource',
    {
      title: '按团队资源 ID 查询资源',
      description:
        '根据「团队内资源编号」(team_wide_id) 反查资源。任务详情里的 team_wide_id 是团队内连续编号，适合人类口头引用（如「4116 号任务」），此接口把它解析成真实的资源 id 和类型。',
      inputSchema: {
        team_id: z.string().describe('团队 id，例如 630122'),
        resource_id: z.string().describe('团队内资源编号 team_wide_id，例如 123'),
      },
      annotations: READ_ONLY,
    },
    ({ team_id, resource_id }) =>
      callTool(() => client.get(`/teams/${team_id}/resources/${resource_id}`)),
  );

  return 5;
}
