import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface TowerConfig {
  /** 例如 https://tower.im/api/v1 */
  baseUrl: string;
  /** 例如 https://tower.im */
  origin: string;
  /** 例如 https://tower.im/oauth/token */
  tokenUrl: string;
  /** 例如 https://tower.im/oauth/authorize */
  authorizeUrl: string;
  clientId?: string;
  clientSecret?: string;
  /** OAuth 回调地址，刷新令牌时 Tower 要求与申请时一致 */
  redirectUri?: string;
  accessToken?: string;
  refreshToken?: string;
  /** 令牌落盘位置 */
  tokenFile: string;
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TowerConfig {
  const baseUrl = (env.TOWER_BASE_URL ?? 'https://tower.im/api/v1').replace(/\/+$/, '');

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    throw new Error(`TOWER_BASE_URL 不是合法 URL: ${baseUrl}`);
  }

  const tokenFileRaw = env.TOWER_TOKEN_FILE ?? '~/.tower-mcp/token.json';
  const tokenFile = isAbsolute(tokenFileRaw)
    ? tokenFileRaw
    : resolve(expandHome(tokenFileRaw));

  return {
    baseUrl,
    origin,
    tokenUrl: `${origin}/oauth/token`,
    authorizeUrl: `${origin}/oauth/authorize`,
    clientId: env.TOWER_CLIENT_ID?.trim() || undefined,
    clientSecret: env.TOWER_CLIENT_SECRET?.trim() || undefined,
    redirectUri: env.TOWER_REDIRECT_URI?.trim() || undefined,
    accessToken: env.TOWER_ACCESS_TOKEN?.trim() || undefined,
    refreshToken: env.TOWER_REFRESH_TOKEN?.trim() || undefined,
    tokenFile,
  };
}
