import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TowerClient } from '../tower-client.js';
import { registerActivityTools } from './activity.js';
import { registerMemberTools } from './member.js';
import { registerProjectTools } from './project.js';
import { registerTeamTools } from './team.js';
import { registerTimeLogTools } from './time-log.js';
import { registerTodoTools } from './todo.js';
import { registerTodolistTools } from './todolist.js';
import { registerTopicTools } from './topic.js';
import { registerUploadTools } from './upload.js';
import { registerUserTools } from './user.js';

type Registrar = (server: McpServer, client: TowerClient) => number;

const REGISTRARS: Registrar[] = [
  registerUserTools,
  registerTeamTools,
  registerMemberTools,
  registerProjectTools,
  registerTodolistTools,
  registerTodoTools,
  registerTopicTools,
  registerUploadTools,
  registerTimeLogTools,
  registerActivityTools,
];

export function registerAllTools(server: McpServer, client: TowerClient): number {
  return REGISTRARS.reduce((total, register) => total + register(server, client), 0);
}
