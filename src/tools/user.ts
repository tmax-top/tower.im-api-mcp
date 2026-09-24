import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TowerClient } from '../tower-client.js';
import { READ_ONLY, callTool } from './helpers.js';

export function registerUserTools(server: McpServer, client: TowerClient): number {
  server.registerTool(
    'tower_get_current_user',
    {
      title: '获取当前账号信息',
      description:
        '获取当前 Tower 授权账号的信息（昵称、邮箱、头像、id）。当不确定当前用的是哪个账号、或需要确认授权是否正常时先调用它。',
      annotations: READ_ONLY,
    },
    () => callTool(() => client.get('/user')),
  );

  return 1;
}
