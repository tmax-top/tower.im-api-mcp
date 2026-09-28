import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type LabelEntry, labelsFileHint, loadLabels } from '../labels.js';
import { READ_ONLY, callTool } from './helpers.js';

interface LabelItem {
  id: number;
  name: string;
  count: number | null;
  scope: 'global' | 'project';
}

function toItems(list: LabelEntry[], scope: 'global' | 'project', query?: string): LabelItem[] {
  const q = query?.trim().toLowerCase();
  return list
    .filter((l) => !q || l.name.toLowerCase().includes(q))
    .map((l) => ({ id: l.id, name: l.name, count: l.count, scope }));
}

export function registerLabelTools(server: McpServer): number {
  server.registerTool(
    'tower_list_labels',
    {
      title: '获取标签列表',
      description:
        '列出标签及其数字 id。写任务时 `label_ids` 需要数字 id，而 Tower 的公开 API ' +
        '不提供任何标签接口、任务响应里也只有标签名——所以这份清单是从网页端' +
        '「标签管理」页同步下来的（`npm run labels:sync` 可刷新）。\n' +
        '**只有全局标签（scope=global）能用 API 设置**；项目标签传进 label_ids 会返回 200 ' +
        '但什么也不做，所以不要用。\n' +
        '也可以用标签名直接调 tower_create_todo / tower_update_todo（见那些工具的参数说明）。',
      inputSchema: {
        scope: z
          .enum(['global', 'project', 'all'])
          .optional()
          .describe('查哪一类标签，默认 global（只有全局标签能用于写操作）'),
        query: z.string().optional().describe('按名字过滤，不区分大小写，支持部分匹配'),
      },
      annotations: READ_ONLY,
    },
    ({ scope, query }) =>
      callTool(async () => {
        const file = loadLabels();
        if (!file) {
          throw new Error(labelsFileHint() ?? '标签映射文件无法解析，重新同步一次：npm run labels:sync');
        }

        const want = scope ?? 'global';
        const items: LabelItem[] = [];
        if (want === 'global' || want === 'all') items.push(...toItems(file.labels.global, 'global', query));
        if (want === 'project' || want === 'all') items.push(...toItems(file.labels.project, 'project', query));

        return {
          items,
          has_more: false,
          synced_at: file.syncedAt,
          total: items.length,
        };
      }),
  );

  return 1;
}
