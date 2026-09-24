import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TowerClient } from '../tower-client.js';
import {
  DESTRUCTIVE,
  PAGE_DESC,
  READ_ONLY,
  WRITE,
  callTool,
  omitUndefined,
  pagination,
} from './helpers.js';

const PRIORITY = z.enum(['highest', 'higher', 'normal', 'lower']);

const CUSTOM_FIELDS_DESC =
  '自定义字段。key 形如 select_C4SJPfKe / member_GrB9U8fJ / string_YyDEkeKe / number_xxx / date_xxx / hyperlink_xxx，' +
  '可在任务详情返回的 custom_field_value.custom_fields 里看到每个字段的 key 与可选取值。';

const DUE_DESC = '截止时间，推荐格式 2026-09-30 或 2026-09-30T18:00（不需要带时区）';

export function registerTodoTools(server: McpServer, client: TowerClient): number {
  server.registerTool(
    'tower_list_todos',
    {
      title: '获取清单下的任务',
      description:
        '列出某个任务清单下的任务。默认只返回未完成任务，把 completed_todo 设为 true 才会带上已完成任务。' +
        '返回里包含任务 id、标题、负责人、截止时间、优先级、标签。',
      inputSchema: {
        todolist_id: z.string().describe('任务清单 id'),
        completed_todo: z.boolean().optional().describe('是否包含已完成任务，默认 false'),
        page: z.number().int().positive().optional().describe(PAGE_DESC),
      },
      annotations: READ_ONLY,
    },
    ({ todolist_id, completed_todo, page }) =>
      callTool(() =>
        client.get(`/todolists/${todolist_id}/todos`, {
          ...pagination(page),
          ...(completed_todo !== undefined ? { completed_todo } : {}),
        }),
      ),
  );

  server.registerTool(
    'tower_get_todo',
    {
      title: '获取任务详情',
      description:
        '按任务 id 获取完整详情：标题、描述、优先级、起止时间、标签、所属清单与项目、创建人/负责人/完成人、' +
        '子任务、评论、附件、自定义字段。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
      },
      annotations: READ_ONLY,
    },
    ({ todo_id }) => callTool(() => client.get(`/todos/${todo_id}`)),
  );

  server.registerTool(
    'tower_get_todo_by_team_wide_id',
    {
      title: '按团队内编号获取任务',
      description:
        '用团队内连续编号（team_wide_id，例如「4116 号任务」）查询任务，适合用户口头引用任务编号的场景。',
      inputSchema: {
        team_id: z.string().describe('团队 id'),
        team_wide_id: z.union([z.string(), z.number()]).describe('团队内任务编号 team_wide_id'),
      },
      annotations: READ_ONLY,
    },
    ({ team_id, team_wide_id }) =>
      callTool(() => client.get(`/teams/${team_id}/todos/${team_wide_id}`)),
  );

  server.registerTool(
    'tower_create_todo',
    {
      title: '创建任务',
      description:
        '在指定清单下创建任务。assignee_id、due_at、start_at 都可以留空。传 parent_id 可创建子任务。',
      inputSchema: {
        todolist_id: z.string().describe('任务清单 id'),
        content: z.string().describe('任务标题'),
        desc: z.string().optional().describe('任务描述，支持 HTML 或纯文本'),
        assignee_id: z.string().optional().describe('负责人成员 id，可在 tower_list_team_members 里获取'),
        due_at: z.string().optional().describe(DUE_DESC),
        start_at: z.string().optional().describe('开始时间，格式同 due_at'),
        priority: PRIORITY.optional().describe('优先级，默认 normal'),
        parent_id: z.string().optional().describe('父任务 id，用于创建子任务'),
        label_ids: z.array(z.number()).optional().describe('标签 id 列表'),
        attfile_guids: z.array(z.string()).optional().describe('已上传附件的 guid 列表'),
        custom_fields: z.record(z.any()).optional().describe(CUSTOM_FIELDS_DESC),
      },
      annotations: WRITE,
    },
    ({ todolist_id, custom_fields, ...rest }) =>
      callTool(() =>
        client.post(`/todolists/${todolist_id}/todos`, {
          todo: omitUndefined({ ...rest, ...(custom_fields ?? {}) }),
        }),
      ),
  );

  server.registerTool(
    'tower_update_todo',
    {
      title: '更新任务',
      description:
        '修改任务的标题、描述、负责人、起止时间、优先级、标签或自定义字段。只传需要修改的字段。' +
        '完成/重开任务请用 tower_complete_todo / tower_reopen_todo。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
        content: z.string().optional().describe('新的任务标题'),
        desc: z.string().optional().describe('新的任务描述，支持 HTML'),
        assignee_id: z.string().optional().describe('新的负责人成员 id；传空字符串表示取消指派'),
        due_at: z.string().optional().describe(DUE_DESC),
        start_at: z.string().optional().describe('开始时间'),
        priority: PRIORITY.optional().describe('优先级'),
        label_ids: z.array(z.number()).optional().describe('标签 id 列表'),
        attfile_guids: z.array(z.string()).optional().describe('附件 guid 列表'),
        custom_fields: z.record(z.any()).optional().describe(CUSTOM_FIELDS_DESC),
      },
      annotations: WRITE,
    },
    ({ todo_id, custom_fields, ...rest }) =>
      callTool(() =>
        client.patch(`/todos/${todo_id}`, {
          todo: omitUndefined({ ...rest, ...(custom_fields ?? {}) }),
        }),
      ),
  );

  server.registerTool(
    'tower_delete_todo',
    {
      title: '删除任务',
      description: '删除指定任务。不可逆，删除前请与用户确认。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
      },
      annotations: DESTRUCTIVE,
    },
    ({ todo_id }) => callTool(() => client.delete(`/todos/${todo_id}`)),
  );

  server.registerTool(
    'tower_complete_todo',
    {
      title: '完成任务',
      description: '把任务标记为已完成，同时记录完成时间和完成人。取消完成请用 tower_reopen_todo。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
      },
      annotations: WRITE,
    },
    ({ todo_id }) => callTool(() => client.post(`/todos/${todo_id}/completion`)),
  );

  server.registerTool(
    'tower_reopen_todo',
    {
      title: '重新打开任务',
      description: '把已完成的任务重新打开（取消完成状态）。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
      },
      annotations: WRITE,
    },
    ({ todo_id }) => callTool(() => client.delete(`/todos/${todo_id}/completion`)),
  );

  server.registerTool(
    'tower_assign_todo',
    {
      title: '指派任务负责人',
      description: '把任务指派给某个成员。需要先通过 tower_list_team_members 拿到 member_id。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
        assignee_id: z.string().describe('负责人成员 id'),
      },
      annotations: WRITE,
    },
    ({ todo_id, assignee_id }) =>
      callTool(() =>
        client.patch(`/todos/${todo_id}/assignment`, {
          todos_assignment: { assignee_id },
        }),
      ),
  );

  server.registerTool(
    'tower_unassign_todo',
    {
      title: '移除任务负责人',
      description: '取消任务的负责人指派。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
      },
      annotations: WRITE,
    },
    ({ todo_id }) => callTool(() => client.delete(`/todos/${todo_id}/assignment`)),
  );

  server.registerTool(
    'tower_set_todo_due',
    {
      title: '更新任务到期日',
      description: '单独设置任务的截止时间。日期不需要带时区。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
        due_at: z.string().describe(DUE_DESC),
      },
      annotations: WRITE,
    },
    ({ todo_id, due_at }) =>
      callTool(() => client.patch(`/todos/${todo_id}/due`, { todos_due: { due_at } })),
  );

  server.registerTool(
    'tower_list_todo_comments',
    {
      title: '获取任务评论',
      description: '获取某个任务下的评论列表（按时间顺序）。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
        page: z.number().int().positive().optional().describe(PAGE_DESC),
      },
      annotations: READ_ONLY,
    },
    ({ todo_id, page }) =>
      callTool(() => client.get(`/todos/${todo_id}/comments`, pagination(page))),
  );

  server.registerTool(
    'tower_add_todo_comment',
    {
      title: '发表任务评论',
      description:
        '在任务下发表评论。content 支持 HTML。' +
        '如需 @ 某人，必须写成 <a href="/members/{member_id}" data-mention="true">@昵称</a> 这种形式，' +
        '其中 member_id 通过 tower_list_team_members 获取。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
        content: z.string().describe('评论内容，支持 HTML'),
      },
      annotations: WRITE,
    },
    ({ todo_id, content }) =>
      callTool(() => client.post(`/todos/${todo_id}/comments`, { comment: { content } })),
  );

  server.registerTool(
    'tower_get_todo_cc_members',
    {
      title: '查询任务通知成员',
      description: '获取任务的「通知成员」列表——任务变动时会被通知的人。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
      },
      annotations: READ_ONLY,
    },
    ({ todo_id }) => callTool(() => client.get(`/todos/${todo_id}/cc_members`)),
  );

  server.registerTool(
    'tower_set_todo_cc_members',
    {
      title: '更新任务通知成员',
      description: '全量设置任务的「通知成员」列表，传空数组表示清空。',
      inputSchema: {
        todo_id: z.string().describe('任务 id'),
        member_ids: z.array(z.string()).describe('成员 id 列表（全量覆盖）'),
      },
      annotations: WRITE,
    },
    ({ todo_id, member_ids }) =>
      callTool(() => client.patch(`/todos/${todo_id}/cc_members`, { guids: member_ids })),
  );

  return 15;
}
