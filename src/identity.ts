/**
 * 「当前操作人」。
 *
 * 背景：安装时填的 `client_id` / `client_secret` 往往是**管理员**的 OAuth 应用凭证，
 * 而实际使用这套 MCP 的是团队成员（比如测试人员）。所以安装时可以选定一名成员作为
 * 「当前操作人」，之后与「人」相关的操作默认都以他为对象：
 *
 *   - `tower_create_todo` 不传 `assignee_id` 时，默认指派给他
 *   - `tower_list_member_todos` 不传 `member_id` 时，默认查他的任务
 *
 * **没有选定时一切照旧**——所有操作仍以 client_id 对应的管理员账号进行。
 *
 * 注意：这只是「默认值」。API 的认证身份仍然是 client_id 那个账号，
 * 任务的 creator 由令牌决定，改不了。这里能影响的是 assignee 这类**显式接受
 * 成员 id 的字段**。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SelectedBy {
  /** 系统用户名（os.userInfo） */
  systemUser?: string;
  /** 主机名 */
  host?: string;
  /** 安装时的 Tower 账号（即 client_id 对应的账号） */
  towerAccount?: string;
}

export interface Identity {
  memberId: string;
  memberName: string | null;
  memberEmail: string | null;
  /** 选定时间（ISO 8601） */
  selectedAt: string;
  /** 选定这台机器上这套 MCP 的人与位置，便于排查「这是谁配的」 */
  selectedBy?: SelectedBy;
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export function identityFilePath(): string {
  return expandHome(process.env.TOWER_IDENTITY_FILE ?? '~/.tower-mcp/identity.json');
}

/**
 * 读取当前操作人。
 *
 * 优先级：`TOWER_MEMBER_ID` 环境变量 > 身份文件。
 * 环境变量优先是为了让同一个 client_id 能按 MCP 条目区分身份
 * （在条目里写 env 即可，一台机器接多个测试人员）。
 */
export function loadIdentity(): Identity | null {
  const fromEnv = process.env.TOWER_MEMBER_ID?.trim();

  if (fromEnv) {
    const file = readIdentityFile();
    // 环境变量指定的正好是文件里那个，就把名字也带上
    if (file && file.memberId === fromEnv) return file;
    return {
      memberId: fromEnv,
      memberName: null,
      memberEmail: null,
      selectedAt: file?.selectedAt ?? '',
      selectedBy: file?.selectedBy,
    };
  }

  return readIdentityFile();
}

function readIdentityFile(): Identity | null {
  const path = identityFilePath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Identity;
    return typeof parsed?.memberId === 'string' && parsed.memberId ? parsed : null;
  } catch {
    return null;
  }
}

/** 当前操作人的成员 id；没选定则为 null */
export function currentMemberId(): string | null {
  return loadIdentity()?.memberId ?? null;
}

/** 给模型看的一句话描述，用在工具描述与 instructions 里 */
export function describeOperator(): string {
  const id = loadIdentity();
  if (!id) {
    return '当前没有指定操作人，一切按 client_id 对应的账号处理（未选定操作人时这是正常的）。';
  }
  const who = id.memberName ? `${id.memberName}${id.memberEmail ? ` <${id.memberEmail}>` : ''}` : id.memberId;
  return `当前操作人是 ${who}（member_id: ${id.memberId}）。`;
}

/** 工具描述里附的「默认值」说明，只在选定后才提，免得没选定时描述变长 */
export function operatorDefaultNote(field: string): string {
  const id = loadIdentity();
  if (!id) return '';
  const who = id.memberName ?? id.memberId;
  return `；不传则默认为当前操作人「${who}」`;
}

/** 没有身份文件时的可操作提示 */
export function identityHint(): string | null {
  if (loadIdentity()) return null;
  return (
    '当前没有指定操作人（这是可选的）。如果这套 MCP 的使用者不是 client_id 对应的账号' +
    '（例如 client_id 是管理员的、使用者是测试人员），可以选定一名成员作为当前操作人：\n' +
    '  npm run select-member\n' +
    '选定后，新建任务不传 assignee_id 时会默认指派给他，查成员任务不传 member_id 时也默认查他。'
  );
}
