# tower-mcp

把 [Tower](https://tower.im) 项目管理 API 封装成 [MCP](https://modelcontextprotocol.io) 服务，让 AI 助手能直接读写你的 Tower 团队、项目、任务、讨论、文件和工时。

依据官方接口文档 [docs.tower.im](https://docs.tower.im/) 实现，覆盖文档中全部 12 个模块，共 **54 个工具**。

---

## 特性

| 能力 | 说明 |
| --- | --- |
| 完整覆盖 | 用户 / 团队 / 成员 / 项目 / 清单 / 任务 / 讨论 / 文件 / 工时 / 通知 / 动态 / 资源反查 |
| 令牌自动续期 | Tower 的 `access_token` 仅 2 小时有效。服务用 `refresh_token` 自动续期，并做**单飞控制**避免并发刷新互相踢掉令牌 |
| JSON:API 展平 | Tower 返回 `data` + `included` + `relationships` 的引用式结构，服务会还原成带人名的扁平对象，模型能直接读懂；列表结果恒定包装成 `{ items, has_more, next_page }`，输出结构不随数据变化 |
| 富文本清洗 | 任务描述、评论正文是 HTML，读取时自动转纯文本，省 token 也好读 |
| 文件直传 | 一个工具完成「申请签名 → 上传阿里云 OSS → 挂到项目文件」全流程 |
| 凭证持久化 | 令牌落盘（权限 600），重启服务不用重新授权 |
| 删除二次确认 | 所有删除类工具强制要求 `confirm: true`，且限定为字面量 `true`，模型无法绕过——必须先取得用户明确同意 |

---

## 快速开始

### 最省事：一键安装

**不用先克隆，一条命令搞定：**

```bash
curl -fsSL https://raw.githubusercontent.com/tmax-top/tower.im-api-mcp/master/install.sh | sh
```

它会先把源码拉下来（默认放到 `~/.tower-mcp/src`），然后依次完成：装依赖 → 编译 → 冒烟验证 → 把 `tower` 写进 MCP 配置。过程中会询问你的 `client_id` / `client_secret`，也可以提前用环境变量传入。

**结束时会把填好绝对路径的配置直接打印出来**，需要手动接入的客户端（Claude Desktop / Cursor / Cline 等）复制粘贴即可，不用自己去拼路径：

**已经克隆了源码的话，直接跑：**

```bash
./install.sh
```

两种方式都支持这些参数：

| 命令 | 作用 |
| --- | --- |
| `./install.sh` | 完整安装 |
| `./install.sh --no-register` | 只装依赖和编译，不动 MCP 配置 |
| `./install.sh --uninstall` | 从 MCP 配置里移除 `tower` 条目 |

在线安装时可用 `TOWER_MCP_DIR` 指定源码位置、`TOWER_MCP_BRANCH` 指定分支。重复运行会自动 `git pull` 到最新——但**如果你的克隆里有未提交的改动，它会跳过更新、直接用现有版本**，不会 `reset --hard` 掉你的东西。

可用的环境变量：`TOWER_CLIENT_ID` / `TOWER_CLIENT_SECRET`（凭证）、`TOWER_MCP_CONFIG`（配置文件路径，默认 `~/.workbuddy-ai/mcp.json`，即 WorkBuddy 的配置；**接入 Claude Desktop / Cursor 等其他客户端时把它指到对方配置文件即可**，详见下文「[接入其他 MCP 客户端](#接入其他-mcp-客户端claude-desktop--cursor--cline-等)」）、`TOWER_MCP_SKIP_AUTH=1`（跳过授权提示）、`TOWER_MCP_FORCE_INSTALL=1`（强制重装依赖）。

写配置前会**自动备份**，并且只合并自己的条目——你原有的其他 MCP 服务不受影响。

> node 路径是运行时探测的，不写死，所以运行时升级不会让它失效。凭证存在 `~/.tower-mcp/env`（权限 600），不进 MCP 客户端配置。

### 或者：按下面的步骤手动来

1~5 步是手动流程，想逐步控制时用。

### 1. 创建 Tower 应用，拿到凭证

1. 进入你的 Tower 团队，点击左上角**团队名称**
2. 选择**应用中心** → **Tower API** → **创建新应用**
3. 填写名称和**回调地址**，Scopes 留空
4. 创建成功后记下**应用 ID**（`client_id`）和**私钥**（`client_secret`）

**回调地址填 `urn:ietf:wg:oauth:2.0:oob`。**

Tower **只接受 https 回调地址**——`http://localhost:3000/callback` 这类地址在创建应用时根本填不进去。所以本机开发直接用 OAuth 标准的 **oob（out-of-band）模式**：授权完成后 Tower 把授权码显示在页面上，你复制粘贴回终端即可，**不需要任何本地回调服务**。

只有当你确实持有 https 回调地址时（例如用内网穿透把域名映射到本机端口），才填那个地址，并用 `npm run auth -- --local --redirect-uri <你的地址>`。

> 私钥等同于密码，不要提交到代码仓库，也不要写进任何客户端代码。

### 2. 安装与编译

```bash
cd tower-mcp
npm install
npm run build
```

### 3. 完成 OAuth 授权

```bash
export TOWER_CLIENT_ID=你的应用ID
export TOWER_CLIENT_SECRET=你的私钥

npm run auth
```

浏览器会打开 Tower 授权页，同意后**页面会显示一串授权码**，复制粘贴回终端即可。令牌写入 `~/.tower-mcp/token.json`，之后服务会自动刷新，不用反复授权。

> **遇到 `The redirect uri included is not valid.`？**
>
> 说明本次使用的回调地址不在这个 Tower 应用的登记列表里。注意 Tower **只接受 https**，
> `http://localhost` 一定不行——CLI 会在发起授权前就拦下 http 地址并给出提示，
> 不会让你白跑一趟浏览器。
>
> 用默认的 oob 模式（`npm run auth`，不加任何参数）就不存在这个问题：
> 只要创建应用时回调地址填的是 `urn:ietf:wg:oauth:2.0:oob` 即可。
>
> 另一个坑：Tower 是**登录之后**才校验 `redirect_uri` 的，所以报错只会出现在浏览器页面里，
> CLI 收不到任何回调，只能一直等到 5 分钟超时。看到浏览器报错时按 Ctrl+C 终止即可，不必等。
> 超时后 CLI 也会打印这段排查提示。

账号开了两步验证时会额外要一次验证码，脚本会提示。

### 4. 接入 MCP 客户端

> **用的不是 WorkBuddy？** 跳过本步，直接看下文「[接入其他 MCP 客户端](#接入其他-mcp-客户端claude-desktop--cursor--cline-等)」——那里有 Claude Desktop / Cursor / Cline 的配置文件位置和两种接入方式。

在你的 MCP 配置文件里加入下面这段（把路径换成实际值）：

```json
{
  "mcpServers": {
    "tower": {
      "type": "stdio",
      "command": "/绝对路径/tower-mcp/bin/tower-mcp",
      "args": []
    }
  }
}
```

**结构必须是这样**：`command` 是**字符串**、`args` 是**数组**、`type` 是 `"stdio"`。把 `command` 写成数组（某些 MCP 客户端支持那种写法）会导致条目被**静默忽略**——配置文件里明明有，界面上就是不显示，也不报错。

凭证不写进配置：由 `bin/tower-mcp` 从 `~/.tower-mcp/env` 读取，密钥不进客户端配置。`./install.sh` 会自动生成这个文件。

**路径不用手写。** 跑下面这个命令，会直接打印出可粘贴的配置，里面已经填好你机器上的真实绝对路径：

```bash
npm run print-config
```

它给出两种写法：

| 写法 | `command` | 说明 |
| --- | --- | --- |
| **启动器（推荐）** | `"/绝对路径/tower-mcp/bin/tower-mcp"` | 不含 node。启动器自己按 `PATH` → `~/.local/bin` → `/usr/local/bin` → `/opt/homebrew/bin` 的顺序找 node |
| 显式指定 node | `"/绝对路径/node"` + `args: ["/绝对路径/tower-mcp/dist/index.js"]` | 传统写法。但 node 路径里若带版本号（如 `.../node/versions/22.22.2-3/bin/node`），运行时一升级就失效 |

**为什么推荐启动器**：node 的安装路径经常带版本号，写死会在升级后静默失效——服务不报错，只是连不上，很难排查。启动器还顺带解决了 macOS 上 GUI 启动的进程拿不到用户 shell `PATH` 的问题：它内置了绝对路径兜底，即使 `PATH` 里没有 node 也能起来。

在 WorkBuddy 里的操作路径：侧边栏 **插件** → 右上角 **MCP 服务器** → **配置 MCP**。

改完配置**必须重启 WorkBuddy**（daemon 只在启动时读一次配置，不监听文件变化），重启后还要到连接器管理页右上角的**自定义连接器**入口点一次「信任」，服务才会启用。

### 5. 验证

配好后直接问 AI：「列出我的 Tower 团队」。如果报认证失败，让它调用 `tower_get_auth_state`，会返回当前的令牌状态。

---

## 接入其他 MCP 客户端（Claude Desktop / Cursor / Cline 等）

tower-mcp 是标准的 stdio MCP 服务，任何支持 MCP 的客户端都能接。要搞清楚的只有两件事：**客户端的配置文件在哪**、**改完要重启客户端**。授权和凭证与客户端无关，装一次全部共用。

### 各客户端的配置文件位置

| 客户端 | 配置文件路径 |
| --- | --- |
| WorkBuddy | `~/.workbuddy-ai/mcp.json`（安装脚本的默认目标） |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json`（全局），或项目根目录 `.cursor/mcp.json`（仅该项目生效） |
| Cline（及 Roo Code 等分支） | 插件 UI 里操作（MCP Servers 图标 → Configure）；Cline 的实际文件是 `cline_mcp_settings.json`，各分支命名略有差异 |
| 其他 | 任何含 `mcpServers` 字段的 JSON 配置均适用 |

### 方式一：install.sh 直接注册（推荐）

把 `TOWER_MCP_CONFIG` 指到目标客户端的配置文件再跑安装脚本。脚本会**安全合并**——自动备份原文件，只增删 `tower` 这一个条目，你已有的其他 MCP 服务原样保留：

```bash
# Claude Desktop（macOS）示例：路径带空格，必须加引号
TOWER_MCP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ./install.sh

# Cursor 示例
TOWER_MCP_CONFIG="$HOME/.cursor/mcp.json" ./install.sh

# 已经装过、只想注册到新客户端：直接重跑即可，
# node_modules 已存在时会自动跳过依赖安装，速度很快
TOWER_MCP_CONFIG="$HOME/.cursor/mcp.json" ./install.sh
```

跑完脚本还会**把填好绝对路径的配置打印出来**，方便你再粘给别的客户端——所以即使目标客户端只能手动配置（比如 Cline 要在插件 UI 里填），跑一次 `./install.sh --no-register` 就能拿到现成的片段。

想换个条目名（例如避免和已有服务重名），加 `TOWER_MCP_NAME=tower2`。

> **注意：所有条目共用同一份凭证和令牌**——条目里不带 `env`，启动器一律读 `~/.tower-mcp/env` 和 `~/.tower-mcp/token.json`。所以改条目名**不能**用来接两个不同的 Tower 账号，两个条目连的还是同一个账号。

### 方式二：手动粘贴

跑 `npm run print-config`，它会打印填好你机器上真实绝对路径的配置，粘进客户端配置文件的 `mcpServers` 下即可：

```json
{
  "mcpServers": {
    "tower": {
      "type": "stdio",
      "command": "/绝对路径/tower-mcp/bin/tower-mcp",
      "args": []
    }
  }
}
```

几个注意点：

- `command` 必须是**字符串**、`args` 必须是**数组**。写成数组形式的 `command` 在部分客户端会被静默忽略——配置里有、界面上没有、也不报错，极难排查。
- `type` 是 WorkBuddy 需要的字段（它自己写出的条目就带这个），**别删**；Claude Desktop / Cursor 不认这个字段，留着会被忽略，不影响使用。
- 凭证不写在配置里（`bin/tower-mcp` 自己从 `~/.tower-mcp/env` 读取），所以不需要 `env` 字段。

### 收尾

1. **完全退出并重启客户端**。MCP 配置只在启动时读取一次，热改不生效。
2. 问 AI「列出我的 Tower 团队」验证。报认证失败时让它调用 `tower_get_auth_state` 排查。

> 凭证统一放在 `~/.tower-mcp/env`，所以同一份安装可以同时注册进多个客户端，互不影响。
> OAuth 授权（`npm run auth`）也只跑一次，与用哪个客户端无关。

---

## 配置项

服务从环境变量读取配置。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `TOWER_CLIENT_ID` | 是 | — | 应用 ID |
| `TOWER_CLIENT_SECRET` | 是 | — | 私钥，用于刷新令牌 |
| `TOWER_REFRESH_TOKEN` | 否 | — | 指定刷新令牌。不填则读令牌文件 |
| `TOWER_ACCESS_TOKEN` | 否 | — | 直接指定访问令牌，2 小时过期后需手动更换。优先级高于令牌文件 |
| `TOWER_TOKEN_FILE` | 否 | `~/.tower-mcp/token.json` | 令牌文件路径 |
| `TOWER_BASE_URL` | 否 | `https://tower.im/api/v1` | API 地址 |
| `TOWER_REDIRECT_URI` | 否 | — | 刷新令牌时提交的回调地址。默认使用授权时自动记录在令牌文件里的值；仅当需要覆盖时才配置 |
| `TOWER_ENV_FILE` | 否 | `~/.tower-mcp/env` | 凭证文件路径。`bin/tower-mcp` 启动时读取它（每行 `KEY=VALUE`），已存在的环境变量优先 |

`.env.example` 是配置项的参考清单。凭证推荐放在 `~/.tower-mcp/env`（`./install.sh` 会自动生成，权限 600），这样密钥不用进 MCP 客户端配置；命令行调试可以用 Node 原生的 `--env-file`：

```bash
node --env-file=.env dist/index.js
```

---

## 工具清单

> 所有 `tower_delete_*` 工具都必须传 `confirm: true` 才能调用（传 `false` 会被参数校验拒绝），详见下文「删除的二次确认」。

### 用户与团队

| 工具 | 作用 |
| --- | --- |
| `tower_get_current_user` | 当前账号信息 |
| `tower_list_teams` | 加入的团队列表 |
| `tower_create_team` / `tower_update_team` | 创建团队 / 改名 |
| `tower_get_my_team_member` | 我在团队中的成员信息（拿自己的 member_id） |
| `tower_resolve_team_resource` | 用团队内编号反查资源 |

### 成员

| 工具 | 作用 |
| --- | --- |
| `tower_list_team_members` | 团队成员列表 |
| `tower_get_member` | 成员详情 |
| `tower_list_member_todos` | 某成员被指派 / 创建的任务（可筛完成状态与时间分类） |

### 项目

| 工具 | 作用 |
| --- | --- |
| `tower_list_projects` / `tower_get_project` | 项目列表 / 详情 |
| `tower_create_project` / `tower_update_project` / `tower_delete_project` | 创建 / 更新 / 删除 |
| `tower_list_project_members` | 项目成员 |

### 任务清单

| 工具 | 作用 |
| --- | --- |
| `tower_list_todolists` / `tower_get_todolist` | 清单列表 / 详情 |
| `tower_create_todolist` / `tower_update_todolist` / `tower_delete_todolist` | 创建 / 更新 / 删除 |

### 任务

| 工具 | 作用 |
| --- | --- |
| `tower_list_todos` | 清单下的任务（可选含已完成） |
| `tower_get_todo` | 任务详情 |
| `tower_get_todo_by_team_wide_id` | 按团队内编号查任务 |
| `tower_create_todo` | 创建任务（支持子任务、标签、自定义字段） |
| `tower_update_todo` | 更新任务 |
| `tower_delete_todo` | 删除任务 |
| `tower_complete_todo` / `tower_reopen_todo` | 完成 / 重新打开 |
| `tower_assign_todo` / `tower_unassign_todo` | 指派 / 取消指派负责人 |
| `tower_set_todo_due` | 设置截止时间 |
| `tower_list_todo_comments` / `tower_add_todo_comment` | 评论列表 / 发表评论 |
| `tower_get_todo_cc_members` / `tower_set_todo_cc_members` | 查询 / 更新通知成员 |

### 讨论

`tower_list_topics`、`tower_get_topic`、`tower_create_topic`、`tower_update_topic`、`tower_delete_topic`

### 文件

| 工具 | 作用 |
| --- | --- |
| `tower_list_uploads` / `tower_get_upload` | 项目文件列表 / 详情 |
| `tower_create_upload` / `tower_delete_upload` | 挂载已有附件 / 删除文件 |
| `tower_get_attachment_url` | 附件 id 换可访问 URL |
| `tower_upload_file` | **上传本地文件到项目**（完整直传流程） |

### 工时

`tower_list_project_time_logs`、`tower_list_todo_time_logs`、`tower_add_time_log`、`tower_update_time_log`、`tower_delete_time_log`

### 通知与动态

| 工具 | 作用 |
| --- | --- |
| `tower_list_notifications` | 团队通知列表 |
| `tower_list_events` | 团队动态流（可按成员/项目过滤，适合生成日报周报） |
| `tower_get_auth_state` | 本地诊断授权状态，不发网络请求 |

---

## 实现要点

### JSON:API 展平

Tower 的响应是引用式的：

```json
{
  "data": {
    "attributes": { "content": "修登录 bug" },
    "relationships": { "assignee": { "data": { "id": "73d2b1df", "type": "members" } } }
  },
  "included": [{ "id": "73d2b1df", "type": "members", "attributes": { "nickname": "张三" } }]
}
```

直接给模型看 `"assignee": {"id": "73d2b1df"}` 等于没说。服务会解析成：

```json
{ "content": "修登录 bug", "assignee": { "id": "73d2b1df", "type": "members", "name": "张三", "role": "member" } }
```

### 分页

Tower 列表响应通过 `links.next` 表示还有下一页（不一定有 `meta`）。**列表类工具的返回值恒定是对象**，数据在 `items` 里：

```json
{ "items": [ { "id": "...", "name": "..." } ], "has_more": true, "next_page": 2 }
```

`has_more` 由 `links.next` 推断，`next_page` 从 `links.next` 的 `page[number]` 解析。没有下一页时 `has_more` 为 `false`，且不带 `next_page`。单条查询（`tower_get_*`）仍然直接返回对象。

**为什么恒定包一层，而不是「有下一页才包」**：后者会让同一个工具翻到最后一页时从对象突变回数组，模型无法预期输出结构。而且官方文档的响应样本本身不完整——`todo.md` 文档化了 `page[number]` 参数，但它的样本响应里并没有 `links`，所以运行时到底哪些接口会返回 `links` 是不可预测的。恒定包装让「列表返回对象、单条查询返回对象」成为稳定契约，代价约 35 字节。

需要注意：`has_more` 恒为 `false` 并不代表只有一页，也可能只是该接口的响应不含 `links`。这种情况请自行递增 `page` 参数尝试。

### 令牌刷新

Tower 文档明确说明「重复获取将导致上次获取的 Access Token 失效」，所以刷新必须是排他的：

- 用 `Promise` 单飞锁，并发请求共享同一次刷新
- 刷新请求携带官方要求的 `Authorization: Bearer` 头与 `redirect_uri`（授权时实际使用的回调地址会在授权成功后自动记入令牌文件，刷新时默认复用；也可用 `TOWER_REDIRECT_URI` 覆盖）
- 每次刷新都会下发新的 `refresh_token`，必须覆盖保存
- 提前 60 秒判定过期，避免边界失效
- 遇到 401 自动刷新并重试一次

### 错误处理

工具内部异常会被捕获成 `isError` 结果返回给模型，而不是让服务进程崩掉——模型看到错误信息后可以自行纠正重试。JSON:API 的 `errors` 数组会被拼成可读文字，并按状态码补充排查提示（401 → 查令牌、422 → 查参数等）。

### 删除的二次确认

删除是不可逆的，所以**不能只靠提示词约束**。所有删除类工具（`tower_delete_project` / `tower_delete_todolist` / `tower_delete_todo` / `tower_delete_topic` / `tower_delete_upload` / `tower_delete_time_log`）都带一个**必填**的 `confirm` 参数，类型是 `z.literal(true)`——只接受 `true`，不传或传 `false` 都会在**进入处理函数之前**被参数校验拦下：

```
不传 confirm   -> MCP error -32602: Input validation error:
                  Invalid arguments for tool tower_delete_todo:
                  Invalid literal value, expected true at confirm
confirm=false  -> 同上，同样被拒
confirm=true   -> 通过校验，正常执行
```

**为什么用必填参数，而不是只在工具描述里写「请先确认」**：描述只是建议，模型可能忽略。做成 schema 里的必填字面量才是硬约束——模型必须显式声明 `true` 才能调用，这一步没法「顺手」完成，从而强制它在调用前走完「向用户说明 → 取得明确同意」这个流程。

工具描述和服务的 `INSTRUCTIONS` 里都写明了：用户此前说过要删**不算数**，每次删除都要重新确认；用户未表态时应先询问，不要替用户决定。

> 说明：`tower_reopen_todo` 和 `tower_unassign_todo` 虽然走的是 HTTP `DELETE` 方法，但语义是「重新打开任务」「取消指派」，可逆且不丢数据，因此没有要求二次确认。

---

## 开发

```bash
npm run build        # 编译
npm run watch        # 增量编译
npm test             # 跑测试（40 个用例）
npm run print-config # 打印可直接粘贴的 MCP 配置（自动填好绝对路径）
npm run auth         # OAuth 授权
npm run inspect      # 用官方 MCP Inspector 交互式调试
```

测试覆盖：JSON:API 展平（含列表恒定包装与翻页结构稳定性）、富文本清洗（desc/评论/讨论）、令牌单飞刷新（Bearer 头与 redirect_uri）、401 重试、令牌文件权限收紧、分页参数拼接、MIME 推断、删除工具的二次确认硬约束、授权回调方式决策（Tower 只接受 https）、服务启动与工具注册完整性。

目录结构：

```
install.sh            一键安装：依赖 + 编译 + 验证 + 注册 MCP 配置
bin/
└── tower-mcp         启动器：自行定位 node、读取 ~/.tower-mcp/env 凭证
scripts/
├── print-mcp-config.mjs  生成可粘贴的 MCP 配置（npm run print-config）
└── register-mcp.mjs      安全合并 MCP 配置（会备份，只动自己的条目）
src/
├── index.ts          服务入口（stdio 传输）
├── auth-cli.ts       OAuth 授权助手
├── auth-redirect.ts  授权回调方式决策（oob / 本地回调）
├── config.ts         环境变量解析
├── tower-client.ts   HTTP 客户端 + 令牌管理
├── jsonapi.ts        JSON:API 展平 + HTML 清洗
├── tools/            按域拆分的工具实现
│   ├── index.ts      注册总表
│   ├── helpers.ts    结果渲染、错误包装、删除确认参数
│   └── user/team/member/project/todolist/todo/topic/upload/time-log/activity.ts
└── test/             测试
```

---

## 注意事项与已知限制

- **删除类操作不可逆，且强制二次确认**。所有 `tower_delete_*` 工具都要求传 `confirm: true`（字面量，传 `false` 会被拒），调用前 AI 必须向你说明删除对象并取得同意。详见上文「删除的二次确认」。
- **id 必须来自查询结果**。Tower 的 id 是 32 位十六进制串，无法推测，也不要用网页 URL 里的数字直接当 id（那是 `team_wide_id`，用 `tower_get_todo_by_team_wide_id` 或 `tower_resolve_team_resource` 转换）。
- **自定义字段需要 key**。更新自定义字段要传形如 `select_C4SJPfKe` 的 key，取值可在任务详情的 `custom_field_value.custom_fields` 里看到。工具通过 `custom_fields` 参数透传。
- **评论 @ 人必须用 HTML**。Tower 要求写成 `<a href="/members/{member_id}" data-mention="true">@昵称</a>`，工具描述里已写明。
- **两处按文档推断的请求格式**，官方文档描述较模糊，若调用报 400 请优先怀疑这两处：
  - 创建/更新讨论时 `attfile_guids` 放在请求体顶层
  - 申请直传签名时 `filename` / `byte_size` / `md5` 用 JSON body 提交
- **文件直传依赖阿里云 OSS**。Tower 使用 OSS 客户端直传，上传大文件时受网络影响，超时设为 120 秒。
- **未实现**：官方文档未覆盖的接口（如任务检查项 `todos_check_items` 的独立增删改）没有封装，但读取任务详情时这些数据会一并返回。

---

## 接口对照

实现严格对照官方文档的 12 个模块：`user`、`team`、`member`、`project`、`todolist`、`todo`、`topic`、`upload`、`direct_upload`、`time_log`、`notification`、`event`。

文档源仓库：[mycolorway/tower-api-document](https://github.com/mycolorway/tower-api-document)
