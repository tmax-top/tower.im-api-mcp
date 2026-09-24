#!/usr/bin/env node
/**
 * Tower OAuth 授权助手
 *
 * 两种模式：
 *   1. 默认（本地回调）：起一个 http://localhost:<port>/callback 服务，浏览器授权后自动拿到 code。
 *      需要事先把这个回调地址填进 Tower 应用的「回调地址」里。
 *   2. --oob：使用 urn:ietf:wg:oauth:2.0:oob，授权后页面会直接显示 code，手动粘贴回来。
 *      适合不想配回调地址、或用 Postman 之外想快速试一下的场景。
 *
 * 用法：
 *   node dist/auth-cli.js
 *   node dist/auth-cli.js --oob
 *   node dist/auth-cli.js --port 3000 --redirect-uri http://localhost:3000/callback
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from './config.js';
import { TowerClient } from './tower-client.js';

const OOB_REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

interface CliOptions {
  oob: boolean;
  port: number;
  redirectUri?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { oob: false, port: 3000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--oob') options.oob = true;
    else if (arg === '--port') {
      const value = argv[i + 1];
      if (value) {
        options.port = Number.parseInt(value, 10);
        i += 1;
      }
    } else if (arg === '--redirect-uri') {
      const value = argv[i + 1];
      if (value) {
        options.redirectUri = value;
        i += 1;
      }
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return options;
}

function printUsage(): void {
  stdout.write(
    [
      'Tower OAuth 授权助手',
      '',
      '用法：node dist/auth-cli.js [选项]',
      '',
      '选项：',
      '  --oob                    使用 oob 模式（手动粘贴授权码），无需配置回调地址',
      '  --port <端口>             本地回调服务端口，默认 3000',
      '  --redirect-uri <地址>     显式指定回调地址',
      '  -h, --help               显示帮助',
      '',
      '环境变量：TOWER_CLIENT_ID / TOWER_CLIENT_SECRET（未设置时会交互式询问）',
      '',
    ].join('\n'),
  );
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    child.on('error', () => {
      /* 打不开浏览器不影响流程，用户可手动复制链接 */
    });
    child.unref();
  } catch {
    /* 忽略 */
  }
}

/** 起本地回调服务，等待 Tower 把 code 送过来 */
function waitForCallback(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      if (url.pathname !== path) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (code) {
        res.end(
          '<html><meta charset="utf-8"><body style="font-family:system-ui;padding:48px">' +
            '<h2>授权成功</h2><p>已拿到授权码，请回到终端查看结果，本页面可以关闭了。</p></body></html>',
        );
        server.close();
        resolve(code);
      } else {
        res.end(
          '<html><meta charset="utf-8"><body style="font-family:system-ui;padding:48px">' +
            `<h2>授权失败</h2><p>${error ?? '未返回授权码'}</p></body></html>`,
        );
        server.close();
        reject(new Error(`授权被拒绝或失败：${error ?? '未返回 code'}`));
      }
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      stdout.write(`\n已启动本地回调服务：http://localhost:${port}${path}\n`);
    });

    setTimeout(() => {
      server.close();
      reject(new Error('等待授权超时（5 分钟），请重新运行。'));
    }, AUTH_TIMEOUT_MS).unref();
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    stdout.write('=== Tower MCP 授权助手 ===\n\n');

    let clientId = config.clientId;
    let clientSecret = config.clientSecret;

    if (!clientId) {
      clientId = (await rl.question('请输入应用 ID (client_id)：')).trim();
    }
    if (!clientSecret) {
      clientSecret = (await rl.question('请输入私钥 (client_secret)：')).trim();
    }
    if (!clientId || !clientSecret) {
      throw new Error('client_id 与 client_secret 不能为空。');
    }

    // 让后续换令牌时能用到交互式输入的凭证
    process.env.TOWER_CLIENT_ID = clientId;
    process.env.TOWER_CLIENT_SECRET = clientSecret;

    const redirectUri = options.oob
      ? OOB_REDIRECT
      : (options.redirectUri ?? config.redirectUri ?? `http://localhost:${options.port}/callback`);

    const authorizeUrl = new URL(config.authorizeUrl);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');

    stdout.write('\n请在浏览器中完成授权。若浏览器没有自动打开，请手动访问下面的链接：\n\n');
    stdout.write(`${authorizeUrl.toString()}\n\n`);
    openBrowser(authorizeUrl.toString());

    let code: string;
    if (options.oob) {
      code = (await rl.question('授权完成后，请把页面上的授权码粘贴到这里：')).trim();
    } else {
      code = await waitForCallback(options.port, new URL(redirectUri).pathname);
    }

    if (!code) throw new Error('没有拿到授权码。');

    const client = new TowerClient(loadConfig());
    let result = await client.exchangeAuthorizationCode(code, redirectUri);

    // 账号开了两步验证时，Tower 会先返回 otp_required，需要补验证码再来一次
    if (result.error === 'otp_required') {
      stdout.write('\n该账号开启了两步验证，Tower 已向你的手机/邮箱发送验证码。\n');
      const captcha = (await rl.question('请输入收到的验证码：')).trim();
      result = await client.exchangeAuthorizationCode(code, redirectUri, captcha);
    }

    if (!result.access_token) {
      throw new Error(`换取令牌失败：${JSON.stringify(result)}`);
    }

    const expiresIn = result.expires_in ?? 0;
    stdout.write('\n授权成功。\n');
    stdout.write(`  账号：${result.email ?? '(未知)'}\n`);
    stdout.write(`  access_token 有效期：约 ${Math.round(expiresIn / 60)} 分钟（服务会自动刷新）\n`);
    stdout.write(`  令牌已写入：${config.tokenFile}\n\n`);
    stdout.write('接下来把这个路径配给 MCP 服务，或在 MCP 配置里设置 TOWER_TOKEN_FILE 指向它。\n');
  } finally {
    rl.close();
  }
}

main().catch((err: unknown) => {
  const detail = err instanceof Error ? err.message : String(err);
  stdout.write(`\n授权失败：${detail}\n`);
  process.exit(1);
});
