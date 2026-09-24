/**
 * 授权回调方式的决策逻辑。
 *
 * 单独拆出来是为了能测——这块逻辑踩过坑：Tower **只接受 https 回调地址**，
 * 一开始默认用了 `http://localhost:3000/callback`，结果授权页直接报
 * "The redirect uri included is not valid."。
 */

/** OAuth 标准的 out-of-band 回调地址：授权完成后由页面显示授权码，不需要回调服务 */
export const OOB_REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';

export interface RedirectOptions {
  /** 是否显式要求启用本地回调服务 */
  local: boolean;
  /** 显式指定的回调地址（命令行 --redirect-uri） */
  redirectUri?: string;
}

export interface ResolvedRedirect {
  redirectUri: string;
  /** true 表示要起本地回调服务接收 code；false 表示走 oob 手动粘贴 */
  useLocalServer: boolean;
}

/**
 * 决定本次授权用哪种回调方式。
 *
 * 优先级：显式指定（命令行 > 环境变量）> oob（默认）。
 *
 * 默认选 oob 是因为 Tower 只接受 https 回调地址，`http://localhost` 这类地址
 * 在创建应用时根本填不进去，所以本机开发只能用 oob。
 *
 * @param envRedirectUri TOWER_REDIRECT_URI 的值
 * @throws 当要求本地回调却没给回调地址时
 */
export function resolveRedirect(
  options: RedirectOptions,
  envRedirectUri?: string,
): ResolvedRedirect {
  const explicit = options.redirectUri ?? envRedirectUri;

  if (explicit) {
    // 显式指定了 oob URN 就等于走 oob，不需要本地服务
    return { redirectUri: explicit, useLocalServer: explicit !== OOB_REDIRECT };
  }

  if (options.local) {
    throw new Error(
      '--local 需要配合 --redirect-uri 使用。\n' +
        'Tower 不接受 http 回调地址，本机回调必须通过 https 地址接入（例如内网穿透）。\n' +
        '若只是想完成授权，直接运行 npm run auth 走 oob 模式即可。',
    );
  }

  return { redirectUri: OOB_REDIRECT, useLocalServer: false };
}

/**
 * Tower 只接受 https 回调地址，http 提前拦下来。
 *
 * 不拦的话，用户要一路走到浏览器里、登录之后才会看到
 * "The redirect uri included is not valid."，而 CLI 那边只能干等到超时，很难排查。
 */
export function assertRedirectUriAcceptable(uri: string): void {
  if (!uri.startsWith('http://')) return;
  throw new Error(
    'Tower 不接受 http 回调地址，只接受 https（或 oob URN）。\n' +
      `当前配置：${uri}\n\n` +
      '直接走 oob 模式即可，不需要任何回调地址和本地服务：\n' +
      '  npm run auth\n\n' +
      '若你有 https 回调地址（例如用内网穿透映射到本机端口），可以这样用：\n' +
      '  npm run auth -- --local --redirect-uri https://你的域名/callback',
  );
}
