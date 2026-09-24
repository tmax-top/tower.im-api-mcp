import assert from 'node:assert/strict';
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { loadConfig } from '../config.js';
import { TowerApiError, TowerClient } from '../tower-client.js';

const originalFetch = globalThis.fetch;
let seq = 0;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** 每个用例用独立的令牌文件，避免相互污染 */
function makeClient(env: Record<string, string>): TowerClient {
  seq += 1;
  const config = loadConfig({
    ...env,
    TOWER_TOKEN_FILE: join(tmpdir(), `tower-mcp-test-${process.pid}-${seq}.json`),
  } as NodeJS.ProcessEnv);
  return new TowerClient(config);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isTokenEndpoint(url: unknown): boolean {
  return String(url).endsWith('/oauth/token');
}

test('把 JSON:API 的 errors 数组转成可读错误', async () => {
  globalThis.fetch = (async () =>
    jsonResponse(
      { errors: [{ status: '422', title: 'Invalid attribute', detail: 'content 不能为空' }] },
      422,
    )) as typeof fetch;

  const client = makeClient({
    TOWER_ACCESS_TOKEN: 'tok',
    TOWER_CLIENT_ID: 'id',
    TOWER_CLIENT_SECRET: 'sec',
  });

  await assert.rejects(
    () => client.get('/todos/x'),
    (err: unknown) => {
      assert.ok(err instanceof TowerApiError);
      assert.equal(err.status, 422);
      assert.match(err.message, /Invalid attribute: content 不能为空/);
      return true;
    },
  );
});

test('401 时自动刷新令牌并重试一次', async () => {
  const authHeaders: string[] = [];
  let tokenCalls = 0;

  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (isTokenEndpoint(url)) {
      tokenCalls += 1;
      return jsonResponse({ access_token: 'new-token', refresh_token: 'r2', expires_in: 7200 });
    }
    authHeaders.push((init?.headers as Record<string, string>)?.Authorization ?? '');
    if (authHeaders.length === 1) return new Response('{}', { status: 401 });
    return jsonResponse({ data: { id: 't1', type: 'todos', attributes: { content: 'ok' } } });
  }) as typeof fetch;

  const client = makeClient({
    TOWER_ACCESS_TOKEN: 'old-token',
    TOWER_REFRESH_TOKEN: 'r1',
    TOWER_CLIENT_ID: 'id',
    TOWER_CLIENT_SECRET: 'sec',
  });

  const result = (await client.get('/todos/t1')) as { data: { attributes: { content: string } } };

  assert.equal(result.data.attributes.content, 'ok');
  assert.equal(tokenCalls, 1, '应该只刷新一次');
  assert.deepEqual(authHeaders, ['Bearer old-token', 'Bearer new-token']);
});

test('并发刷新只触发一次令牌请求（单飞）', async () => {
  let tokenCalls = 0;

  globalThis.fetch = (async (url: unknown) => {
    if (isTokenEndpoint(url)) {
      tokenCalls += 1;
      // 拉长耗时，制造并发窗口
      await new Promise((r) => setTimeout(r, 20));
      return jsonResponse({ access_token: 'a', refresh_token: 'b', expires_in: 7200 });
    }
    return jsonResponse({});
  }) as typeof fetch;

  const client = makeClient({
    TOWER_REFRESH_TOKEN: 'rt',
    TOWER_CLIENT_ID: 'id',
    TOWER_CLIENT_SECRET: 'sec',
  });

  await Promise.all([client.refresh(), client.refresh(), client.refresh()]);

  assert.equal(tokenCalls, 1, '并发刷新应该只发一次请求');
});

test('刷新请求携带 Bearer 头，并默认使用授权时记录的 redirect_uri', async () => {
  // 预置一份带 redirectUri 的令牌文件，模拟 npm run auth 之后的状态
  const config = loadConfig({
    TOWER_CLIENT_ID: 'id',
    TOWER_CLIENT_SECRET: 'sec',
    TOWER_TOKEN_FILE: join(tmpdir(), `tower-mcp-test-${process.pid}-refresh-hdr.json`),
  } as NodeJS.ProcessEnv);
  writeFileSync(
    config.tokenFile,
    JSON.stringify({
      accessToken: 'old-token',
      refreshToken: 'rt',
      expiresAt: 1, // 已过期，强制走刷新
      redirectUri: 'http://localhost:3000/callback',
    }),
  );

  let capturedHeaders: Record<string, string> = {};
  let capturedBody = '';
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    capturedBody = String(init?.body ?? '');
    return jsonResponse({ access_token: 'new', refresh_token: 'r2', expires_in: 7200 });
  }) as typeof fetch;

  const client = new TowerClient(config);
  await client.refresh();

  // 官方文档要求刷新接口带 Authorization: Bearer <access_token>
  assert.equal(capturedHeaders.Authorization, 'Bearer old-token');
  // 官方文档要求 redirect_uri 与授权时一致；未配置 TOWER_REDIRECT_URI 时应取令牌文件里记录的值
  assert.match(capturedBody, /redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback/);
  assert.match(capturedBody, /grant_type=refresh_token/);
});

test('显式配置的 TOWER_REDIRECT_URI 优先于令牌文件里记录的值', async () => {
  const config = loadConfig({
    TOWER_CLIENT_ID: 'id',
    TOWER_CLIENT_SECRET: 'sec',
    TOWER_REDIRECT_URI: 'https://www.example.com/oauth2/callback',
    TOWER_TOKEN_FILE: join(tmpdir(), `tower-mcp-test-${process.pid}-refresh-override.json`),
  } as NodeJS.ProcessEnv);
  writeFileSync(
    config.tokenFile,
    JSON.stringify({ refreshToken: 'rt', redirectUri: 'http://localhost:3000/callback' }),
  );

  let capturedBody = '';
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    capturedBody = String(init?.body ?? '');
    return jsonResponse({ access_token: 'new', refresh_token: 'r2', expires_in: 7200 });
  }) as typeof fetch;

  await new TowerClient(config).refresh();

  assert.match(capturedBody, /redirect_uri=https%3A%2F%2Fwww.example.com%2Foauth2%2Fcallback/);
  assert.ok(!capturedBody.includes('localhost'), '不应携带令牌文件里的旧回调地址');
});

test('授权换令牌成功后会把本次使用的 redirect_uri 持久化', async () => {
  const config = loadConfig({
    TOWER_CLIENT_ID: 'id',
    TOWER_CLIENT_SECRET: 'sec',
    TOWER_TOKEN_FILE: join(tmpdir(), `tower-mcp-test-${process.pid}-exchange.json`),
  } as NodeJS.ProcessEnv);

  // 预先创建一个权限宽松的令牌文件，验证保存时会被强制收紧到 0600
  writeFileSync(config.tokenFile, '{}', { mode: 0o666 });
  chmodSync(config.tokenFile, 0o666);

  globalThis.fetch = (async () =>
    jsonResponse({ access_token: 'at', refresh_token: 'r1', expires_in: 7200 })) as typeof fetch;

  const client = new TowerClient(config);
  await client.exchangeAuthorizationCode('auth-code', 'http://localhost:3000/callback');

  const stored = JSON.parse(readFileSync(config.tokenFile, 'utf8')) as Record<string, unknown>;
  assert.equal(stored.redirectUri, 'http://localhost:3000/callback');
  assert.equal(stored.accessToken, 'at');
  // 令牌文件必须始终仅所有者可读写
  assert.equal(statSync(config.tokenFile).mode & 0o777, 0o600);
});

test('只配了 refresh_token 时，首次请求会先换取 access_token', async () => {
  const authHeaders: string[] = [];
  let tokenCalls = 0;

  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (isTokenEndpoint(url)) {
      tokenCalls += 1;
      return jsonResponse({ access_token: 'fresh', refresh_token: 'r2', expires_in: 7200 });
    }
    authHeaders.push((init?.headers as Record<string, string>)?.Authorization ?? '');
    return jsonResponse({ data: { id: 'u1', type: 'users', attributes: { nickname: '我' } } });
  }) as typeof fetch;

  const client = makeClient({
    TOWER_REFRESH_TOKEN: 'rt',
    TOWER_CLIENT_ID: 'id',
    TOWER_CLIENT_SECRET: 'sec',
  });

  await client.get('/user');

  assert.equal(tokenCalls, 1);
  assert.deepEqual(authHeaders, ['Bearer fresh']);
});

test('缺少全部凭证时给出可操作的报错', async () => {
  const client = makeClient({});
  await assert.rejects(() => client.get('/user'), /TOWER_CLIENT_ID|TOWER_ACCESS_TOKEN/);
});

test('204 无内容返回 null 而不是解析失败', async () => {
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  const client = makeClient({ TOWER_ACCESS_TOKEN: 'tok' });
  assert.equal(await client.delete('/todos/t1'), null);
});

test('查询参数按 page[number] 形式拼接', async () => {
  let captured = '';
  globalThis.fetch = (async (url: unknown) => {
    captured = String(url);
    return jsonResponse({ data: [] });
  }) as typeof fetch;

  const client = makeClient({ TOWER_ACCESS_TOKEN: 'tok' });
  await client.get('/todolists/l1/todos', { 'page[number]': 2, completed_todo: true });

  assert.match(captured, /page%5Bnumber%5D=2/);
  assert.match(captured, /completed_todo=true/);
});

test('undefined 的查询参数会被跳过', async () => {
  let captured = '';
  globalThis.fetch = (async (url: unknown) => {
    captured = String(url);
    return jsonResponse({ data: [] });
  }) as typeof fetch;

  const client = makeClient({ TOWER_ACCESS_TOKEN: 'tok' });
  await client.get('/teams/1/events', { limit: 20, by_member: undefined });

  assert.match(captured, /limit=20/);
  assert.ok(!captured.includes('by_member'), 'undefined 参数不应出现在 URL 里');
});
