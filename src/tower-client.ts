import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig, type TowerConfig } from './config.js';

export class TowerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'TowerApiError';
  }
}

interface StoredToken {
  accessToken?: string;
  refreshToken?: string;
  /** 毫秒时间戳 */
  expiresAt?: number;
  email?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  email?: string;
  error?: string;
  error_description?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;
/** 提前 60 秒认为令牌过期，避免边界上刚好失效 */
const EXPIRY_SKEW_MS = 60_000;

function describeError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.errors) && b.errors.length > 0) {
      const parts = b.errors.map((raw) => {
        const e = raw as Record<string, unknown>;
        const title = typeof e.title === 'string' ? e.title : undefined;
        const detail = typeof e.detail === 'string' ? e.detail : undefined;
        return [title, detail].filter(Boolean).join(': ') || JSON.stringify(e);
      });
      if (parts.length) return parts.join('; ');
    }
    if (typeof b.error === 'string') {
      const desc = typeof b.error_description === 'string' ? b.error_description : '';
      return desc ? `${b.error}: ${desc}` : b.error;
    }
    if (typeof b.message === 'string') return b.message;
  }

  const hint: Record<number, string> = {
    401: '认证失败——access_token 可能已过期或无效，请检查 TOWER_REFRESH_TOKEN 配置',
    403: '没有权限访问该资源',
    404: '资源不存在，或 id 不正确',
    422: '请求参数不合法，请检查字段名与取值',
    429: '触发频率限制，请稍后重试',
  };
  return hint[status] ?? `HTTP ${status}`;
}

export class TowerClient {
  private config: TowerConfig;
  private token: StoredToken = {};
  /** 刷新令牌的单飞锁：并发请求只触发一次刷新 */
  private refreshing: Promise<void> | null = null;

  constructor(config: TowerConfig = loadConfig()) {
    this.config = config;
    this.token = this.loadToken();
  }

  getConfig(): Readonly<TowerConfig> {
    return this.config;
  }

  /** 用于诊断，不含敏感值 */
  describeAuthState(): Record<string, unknown> {
    return {
      baseUrl: this.config.baseUrl,
      tokenFile: this.config.tokenFile,
      hasClientId: Boolean(this.config.clientId),
      hasClientSecret: Boolean(this.config.clientSecret),
      hasAccessToken: Boolean(this.token.accessToken),
      hasRefreshToken: Boolean(this.token.refreshToken),
      expiresAt: this.token.expiresAt ? new Date(this.token.expiresAt).toISOString() : null,
      account: this.token.email ?? null,
    };
  }

  private loadToken(): StoredToken {
    const fromEnv: StoredToken = {
      accessToken: this.config.accessToken,
      refreshToken: this.config.refreshToken,
    };

    let fromFile: StoredToken = {};
    try {
      const raw = readFileSync(this.config.tokenFile, 'utf8');
      const parsed = JSON.parse(raw) as StoredToken;
      if (parsed && typeof parsed === 'object') fromFile = parsed;
    } catch {
      // 文件不存在或损坏都按「没有」处理
    }

    // 环境变量优先级高于文件：便于临时切换账号
    return {
      accessToken: fromEnv.accessToken ?? fromFile.accessToken,
      refreshToken: fromEnv.refreshToken ?? fromFile.refreshToken,
      expiresAt: fromEnv.accessToken ? undefined : fromFile.expiresAt,
      email: fromFile.email,
    };
  }

  private saveToken(): void {
    try {
      mkdirSync(dirname(this.config.tokenFile), { recursive: true });
      writeFileSync(
        this.config.tokenFile,
        JSON.stringify(
          {
            accessToken: this.token.accessToken,
            refreshToken: this.token.refreshToken,
            expiresAt: this.token.expiresAt,
            email: this.token.email,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch (err) {
      // 写不进去不影响本次运行，只是下次要重新授权
      process.stderr.write(`[tower-mcp] 令牌写入失败: ${(err as Error).message}\n`);
    }
  }

  private async ensureAccessToken(): Promise<string> {
    const { accessToken, expiresAt, refreshToken } = this.token;

    if (accessToken && (!expiresAt || Date.now() < expiresAt - EXPIRY_SKEW_MS)) {
      return accessToken;
    }

    if (refreshToken && this.config.clientId && this.config.clientSecret) {
      await this.refresh();
      if (this.token.accessToken) return this.token.accessToken;
    }

    if (accessToken) {
      // 没有刷新能力（缺 client 凭证），只能拿旧令牌试一把
      return accessToken;
    }

    throw new Error(
      'Tower 未配置有效凭证。请设置 TOWER_CLIENT_ID / TOWER_CLIENT_SECRET 并运行 `npm run auth` 完成授权，' +
        '或直接提供 TOWER_ACCESS_TOKEN。',
    );
  }

  /** 单飞刷新：并发调用共享同一个 Promise */
  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const { clientId, clientSecret, tokenUrl, redirectUri } = this.config;
    const refreshToken = this.token.refreshToken;

    if (!refreshToken) throw new Error('缺少 refresh_token，无法刷新，请重新执行 `npm run auth`。');
    if (!clientId || !clientSecret) {
      throw new Error('缺少 TOWER_CLIENT_ID 或 TOWER_CLIENT_SECRET，无法刷新令牌。');
    }

    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (redirectUri) form.set('redirect_uri', redirectUri);

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await res.text();
    let body: TokenResponse = {};
    try {
      body = text ? (JSON.parse(text) as TokenResponse) : {};
    } catch {
      body = {};
    }

    if (!res.ok || body.error) {
      throw new TowerApiError(`刷新 access_token 失败——${describeError(res.status, body)}`, res.status, body);
    }
    if (!body.access_token) {
      throw new TowerApiError('刷新响应里没有 access_token', res.status, body);
    }

    this.applyTokenResponse(body);
  }

  private applyTokenResponse(body: TokenResponse): void {
    this.token = {
      accessToken: body.access_token,
      // Tower 每次刷新都会下发新的 refresh_token，必须存下来
      refreshToken: body.refresh_token ?? this.token.refreshToken,
      expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined,
      email: body.email ?? this.token.email,
    };
    this.saveToken();
  }

  /** 把授权码换成令牌（供 auth-cli 使用） */
  async exchangeAuthorizationCode(code: string, redirectUri: string, captcha?: string): Promise<TokenResponse> {
    const { clientId, clientSecret, tokenUrl } = this.config;
    if (!clientId || !clientSecret) throw new Error('缺少 TOWER_CLIENT_ID 或 TOWER_CLIENT_SECRET。');

    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    if (captcha) form.set('captcha', captcha);

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await res.text();
    let body: TokenResponse = {};
    try {
      body = text ? (JSON.parse(text) as TokenResponse) : {};
    } catch {
      body = {};
    }

    if (body.error === 'otp_required') return body;
    if (!res.ok || body.error) {
      throw new TowerApiError(`换取令牌失败——${describeError(res.status, body)}`, res.status, body);
    }
    if (body.access_token) this.applyTokenResponse(body);
    return body;
  }

  /**
   * 发起一次 API 请求。
   * @param path 相对于 baseUrl 的路径，如 `/teams/123/projects`
   * @param query 查询参数，key 支持 `page[number]` 这种带方括号的写法
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options: {
      query?: Record<string, string | number | boolean | undefined | null>;
      body?: unknown;
      /** 401 时是否自动刷新重试 */
      retryOnUnauthorized?: boolean;
    } = {},
  ): Promise<T> {
    const { query, body, retryOnUnauthorized = true } = options;

    const url = new URL(this.config.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.append(key, String(value));
    }

    const token = await this.ensureAccessToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.api+json, application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 401 && retryOnUnauthorized && this.token.refreshToken) {
      await this.refresh();
      return this.request<T>(method, path, { ...options, retryOnUnauthorized: false });
    }

    if (res.status === 204) return null as T;

    const text = await res.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!res.ok) {
      throw new TowerApiError(describeError(res.status, payload), res.status, payload);
    }
    return payload as T;
  }

  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined | null>) {
    return this.request<T>('GET', path, { query });
  }

  post<T = unknown>(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined | null>) {
    return this.request<T>('POST', path, { body, query });
  }

  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, { body });
  }

  delete<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('DELETE', path, { body });
  }
}

/** 构造 JSON:API 风格的分页查询参数 */
export function pageQuery(
  page?: number,
  size?: number,
): Record<string, string | number | undefined> {
  const q: Record<string, string | number | undefined> = {};
  if (page !== undefined) q['page[number]'] = page;
  if (size !== undefined) q['page[size]'] = size;
  return q;
}
