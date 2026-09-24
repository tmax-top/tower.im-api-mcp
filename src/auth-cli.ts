#!/usr/bin/env node
/**
 * Tower OAuth 授权助手
 *
 * 两种模式：
 *   1. oob（默认）：回调地址用 urn:ietf:wg:oauth:2.0:oob，授权完成后 Tower 把授权码
 *      显示在页面上，手动粘贴回来。不需要本地服务。
 *
 *      之所以把它设为默认：Tower **只接受 https 回调地址**，
 *      `http://localhost:<port>/callback` 这类地址在创建应用时根本填不进去。
 *
 *   2. --local：起一个本地 http 回调服务接收 code。仅在你有 https 回调地址
 *      （例如内网穿透把域名映射到本机端口）时才用得上，需要配合 --redirect-uri。
 *
 * 用法：
 *   node dist/auth-cli.js                                    # oob，最常用
 *   node dist/auth-cli.js --local --redirect-uri https://你的域名/callback
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { OOB_REDIRECT, assertRedirectUriAcceptable, resolveRedirect } from './auth-redirect.js';
import { loadConfig } from './config.js';
import { TowerClient } from './tower-client.js';

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

interface CliOptions {
  /**
   * 是否启用本地回调服务。
   *
   * 默认关闭：Tower **只接受 https 回调地址**，`http://localhost:3000/callback`
   * 这类地址在应用设置里就填不进去，授权页会报
   * "The redirect uri included is not valid."。所以默认走 oob（不需要回调地址）。
   */
  local: boolean;
  port: number;
  redirectUri?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { local: false, port: 3000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--local') options.local = true;
    // --oob 就是默认行为，接受这个标志只是为了让显式写法的命令继续可用
    else if (arg === '--oob') options.local = false;
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
      '重要：Tower 只接受 https 回调地址（http 填不进去，会报',
      '  "The redirect uri included is not valid."），所以默认走 oob 模式，',
      '不需要配置任何回调地址。',
      '',
      '  oob 模式（默认）  回调地址填 urn:ietf:wg:oauth:2.0:oob',
      '                    授权完成后页面直接显示授权码，手动粘贴回来',
      '  本地回调（--local）需要有 https 回调地址（如内网穿透映射到本机端口），',
      '                    该地址必须原样登记在 Tower 应用的「回调地址」里',
      '',
      '选项：',
      '  --local                  启用本地回调服务（默认不用，走 oob）',
      '  --port <端口>             本地回调服务端口，默认 3000（配合 --local）',
      '  --redirect-uri <地址>     显式指定回调地址（必须 https）',
      '  --oob                    显式使用 oob 模式（就是默认行为）',
      '  -h, --help               显示帮助',
      '',
      '环境变量：TOWER_CLIENT_ID / TOWER_CLIENT_SECRET（未设置时会交互式询问）',
      '          TOWER_REDIRECT_URI（可选，等价于 --redirect-uri）',
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
function waitForCallback(port: number, path: string, redirectUri: string): Promise<string> {
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
      // 回调地址不匹配时，Tower 会在用户登录后直接把错误渲染在浏览器里，
      // 根本不会跳回本地服务，于是这里只能干等到超时——所以超时最常见的成因就是它。
      reject(
        new Error(
          '等待授权超时（5 分钟）。\n\n' +
            '最常见的原因是回调地址不匹配。Tower 是在你**登录之后**才校验 redirect_uri 的：\n' +
            '若它不在该应用的「回调地址」列表里，授权页会直接显示\n' +
            '  The redirect uri included is not valid.\n' +
            '而不会跳回本地服务，这里就只能一直等到超时。\n\n' +
            `本次使用的回调地址是：\n  ${redirectUri}\n\n` +
            '请检查 Tower 应用设置里的「回调地址」，确认存在完全一致的值——\n' +
            '注意协议（Tower 只接受 https）、域名端口、以及结尾有没有斜杠，都要一模一样。\n\n' +
            '想省掉回调配置的话，直接用 oob 模式重跑（这是默认行为，不需要任何回调地址）：\n' +
            '  npm run auth',
        ),
      );
    }, AUTH_TIMEOUT_MS).unref();
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    stdout.write('=== Tower MCP 授权助手 ===\n\n');

    // 先决定回调方式并校验，再问凭证。
    // 这样配置有问题时立刻报错，不用等用户输完 client_id / secret 才发现。
    const { redirectUri, useLocalServer } = resolveRedirect(
      { local: options.local, redirectUri: options.redirectUri },
      config.redirectUri,
    );
    assertRedirectUriAcceptable(redirectUri);

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

    const authorizeUrl = new URL(config.authorizeUrl);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');

    stdout.write('\n请在浏览器中完成授权。若浏览器没有自动打开，请手动访问下面的链接：\n\n');
    stdout.write(`${authorizeUrl.toString()}\n\n`);
    stdout.write(`本次使用的回调地址：${redirectUri}\n`);
    if (useLocalServer) {
      stdout.write('  这个值必须已原样登记在 Tower 应用的「回调地址」里，且能回连到本机端口。\n');
      stdout.write('  若浏览器页面报 "The redirect uri included is not valid."，就是没登记上。\n\n');
    } else {
      stdout.write('  oob 模式：授权完成后页面会显示一串授权码，复制回来粘贴即可。\n\n');
    }

    openBrowser(authorizeUrl.toString());

    let code: string;
    if (useLocalServer) {
      stdout.write('（等待回调中……若浏览器页面已经报错，可按 Ctrl+C 终止，改好配置后重跑。）\n');
      code = await waitForCallback(options.port, new URL(redirectUri).pathname, redirectUri);
    } else {
      code = (await rl.question('授权完成后，请把页面上的授权码粘贴到这里：')).trim();
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
