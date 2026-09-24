import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TowerClient } from '../tower-client.js';
import { DESTRUCTIVE, READ_ONLY, WRITE, callTool, omitUndefined } from './helpers.js';

export function registerTopicTools(server: McpServer, client: TowerClient): number {
  server.registerTool(
    'tower_list_topics',
    {
      title: '获取项目讨论列表',
      description: '列出某个项目下的讨论（Tower 里的「讨论」板块，用于沉淀会议纪要、方案等长文本）。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
      },
      annotations: READ_ONLY,
    },
    ({ project_id }) => callTool(() => client.get(`/projects/${project_id}/topics`)),
  );

  server.registerTool(
    'tower_get_topic',
    {
      title: '获取讨论详情',
      description: '按讨论 id 获取完整内容，含正文、创建人、回复。',
      inputSchema: {
        topic_id: z.string().describe('讨论 id'),
      },
      annotations: READ_ONLY,
    },
    ({ topic_id }) => callTool(() => client.get(`/topics/${topic_id}`)),
  );

  server.registerTool(
    'tower_create_topic',
    {
      title: '创建讨论',
      description: '在指定项目下发一条讨论。正文支持 HTML。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
        subject: z.string().describe('讨论标题'),
        content: z.string().describe('讨论正文，支持 HTML'),
        attfile_guids: z.array(z.string()).optional().describe('已上传附件的 guid 列表'),
      },
      annotations: WRITE,
    },
    ({ project_id, subject, content, attfile_guids }) =>
      callTool(() =>
        client.post(
          `/projects/${project_id}/topics`,
          omitUndefined({ message: { subject, content }, attfile_guids }),
        ),
      ),
  );

  server.registerTool(
    'tower_update_topic',
    {
      title: '更新讨论',
      description:
        '修改讨论的标题或正文。附件规则：不传 attfile_guids 表示不动附件，传空数组表示删除全部附件。',
      inputSchema: {
        topic_id: z.string().describe('讨论 id'),
        subject: z.string().optional().describe('新的讨论标题'),
        content: z.string().optional().describe('新的讨论正文，支持 HTML'),
        attfile_guids: z.array(z.string()).optional().describe('附件 guid 列表；不传=不变，空数组=清空'),
      },
      annotations: WRITE,
    },
    ({ topic_id, subject, content, attfile_guids }) =>
      callTool(() =>
        client.patch(
          `/topics/${topic_id}`,
          omitUndefined({ message: omitUndefined({ subject, content }), attfile_guids }),
        ),
      ),
  );

  server.registerTool(
    'tower_delete_topic',
    {
      title: '删除讨论',
      description: '删除指定讨论。不可逆，删除前请与用户确认。',
      inputSchema: {
        topic_id: z.string().describe('讨论 id'),
      },
      annotations: DESTRUCTIVE,
    },
    ({ topic_id }) => callTool(() => client.delete(`/topics/${topic_id}`)),
  );

  return 5;
}
