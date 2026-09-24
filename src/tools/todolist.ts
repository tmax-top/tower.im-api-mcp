import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TowerClient } from '../tower-client.js';
import { DESTRUCTIVE, READ_ONLY, WRITE, callTool, omitUndefined } from './helpers.js';

export function registerTodolistTools(server: McpServer, client: TowerClient): number {
  server.registerTool(
    'tower_list_todolists',
    {
      title: '获取项目下所有任务清单',
      description:
        '列出某个项目下的全部任务清单（Tower 里叫「清单」，是任务的容器）。创建任务前需要先拿到清单 id。注意每个项目都会有一个 is_default=true 的「清单外任务」清单。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
      },
      annotations: READ_ONLY,
    },
    ({ project_id }) => callTool(() => client.get(`/projects/${project_id}/todolists`)),
  );

  server.registerTool(
    'tower_get_todolist',
    {
      title: '获取任务清单信息',
      description: '按清单 id 获取清单详情。',
      inputSchema: {
        todolist_id: z.string().describe('清单 id'),
      },
      annotations: READ_ONLY,
    },
    ({ todolist_id }) => callTool(() => client.get(`/todolists/${todolist_id}`)),
  );

  server.registerTool(
    'tower_create_todolist',
    {
      title: '创建任务清单',
      description: '在指定项目下创建新的任务清单。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
        name: z.string().describe('清单名称'),
        desc: z.string().optional().describe('清单描述'),
      },
      annotations: WRITE,
    },
    ({ project_id, name, desc }) =>
      callTool(() =>
        client.post(`/projects/${project_id}/todolists`, {
          todolist: omitUndefined({ name, desc }),
        }),
      ),
  );

  server.registerTool(
    'tower_update_todolist',
    {
      title: '更新任务清单',
      description: '修改清单的名称或描述。',
      inputSchema: {
        todolist_id: z.string().describe('清单 id'),
        name: z.string().optional().describe('新的清单名称'),
        desc: z.string().optional().describe('新的清单描述'),
      },
      annotations: WRITE,
    },
    ({ todolist_id, name, desc }) =>
      callTool(() =>
        client.patch(`/todolists/${todolist_id}`, { todolist: omitUndefined({ name, desc }) }),
      ),
  );

  server.registerTool(
    'tower_delete_todolist',
    {
      title: '删除任务清单',
      description: '删除指定清单（连同其中的任务）。不可逆，删除前请与用户确认。',
      inputSchema: {
        todolist_id: z.string().describe('清单 id'),
      },
      annotations: DESTRUCTIVE,
    },
    ({ todolist_id }) => callTool(() => client.delete(`/todolists/${todolist_id}`)),
  );

  return 5;
}
