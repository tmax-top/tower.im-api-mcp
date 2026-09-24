#!/bin/sh
#
# tower-mcp 安装脚本
#
# 在线安装（无需先克隆）：
#   curl -fsSL https://raw.githubusercontent.com/tmax-top/tower.im-api-mcp/master/install.sh | sh
#
# 已经克隆了源码：
#   ./install.sh
#
# 完整流程：装依赖 -> 编译 -> 冒烟验证 -> 注册到 MCP 客户端配置（可选授权）。
#
#   ./install.sh                  完整安装
#   ./install.sh --no-register    只装依赖和编译，不改 MCP 配置
#   ./install.sh --uninstall      从 MCP 配置里移除
#   ./install.sh --help
#
# 环境变量：
#   TOWER_CLIENT_ID, TOWER_CLIENT_SECRET   Tower 应用凭证；不设则交互式询问
#   TOWER_MCP_DIR                          在线安装时源码放哪（默认 ~/.tower-mcp/src）
#   TOWER_MCP_REPO                         GitHub 仓库（默认 tmax-top/tower.im-api-mcp）
#   TOWER_MCP_BRANCH                       分支（默认 master）
#   TOWER_MCP_CONFIG                       MCP 配置文件（默认 ~/.workbuddy-ai/mcp.json）
#   TOWER_MCP_NAME                         MCP 条目名（默认 tower）
#   TOWER_TOKEN_FILE                       令牌文件（默认 ~/.tower-mcp/token.json）
#   TOWER_MCP_SKIP_AUTH=1                  跳过授权提示
#   TOWER_MCP_FORCE_INSTALL=1              即使 node_modules 已存在也重装依赖
#
set -eu

REPO="${TOWER_MCP_REPO:-tmax-top/tower.im-api-mcp}"
BRANCH="${TOWER_MCP_BRANCH:-master}"

# REPO 可以写成 owner/repo（走 GitHub），也可以直接给完整地址
# （内网镜像、GitHub Enterprise、file:// 本地测试都靠这个）。
case "$REPO" in
  *://* | git@*)
    CLONE_URL="$REPO"
    TARBALL_URL=""
    ;;
  *)
    CLONE_URL="https://github.com/$REPO.git"
    TARBALL_URL="https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"
    ;;
esac

# 关掉 npm 的进度转圈，否则会往输出里插控制字符，把终端弄得一团糟
npm_config_progress=false
export npm_config_progress

usage() {
  cat <<'EOF'
tower-mcp 安装脚本

在线安装（无需先克隆）：
  curl -fsSL https://raw.githubusercontent.com/tmax-top/tower.im-api-mcp/master/install.sh | sh

已经克隆了源码：
  ./install.sh                  完整安装（依赖 + 编译 + 验证 + 注册到 MCP 配置）
  ./install.sh --no-register    只装依赖和编译，不改 MCP 配置
  ./install.sh --uninstall      从 MCP 配置里移除 tower 条目
  ./install.sh --help

环境变量：
  TOWER_CLIENT_ID, TOWER_CLIENT_SECRET   Tower 应用凭证；不设则交互式询问
  TOWER_MCP_DIR                          在线安装时源码放哪，默认 ~/.tower-mcp/src
  TOWER_MCP_REPO                         GitHub 仓库，默认 tmax-top/tower.im-api-mcp
  TOWER_MCP_BRANCH                       分支，默认 master
  TOWER_MCP_CONFIG                       MCP 配置文件，默认 ~/.workbuddy-ai/mcp.json
  TOWER_MCP_NAME                         MCP 条目名，默认 tower
  TOWER_TOKEN_FILE                       令牌文件，默认 ~/.tower-mcp/token.json
  TOWER_MCP_SKIP_AUTH=1                  跳过授权提示
  TOWER_MCP_FORCE_INSTALL=1              强制重装依赖
EOF
}

die() {
  printf 'tower-mcp: %s\n' "$1" >&2
  exit 1
}

# 中文标签在终端里每字占两列，直接按字符数补空格会错位。
# 用「字符数 + 半个字节差」估算显示宽度：ASCII 每字符 1 列，CJK 每字符 2 列。
item() {
  _label=$1
  _bytes=$(printf '%s' "$_label" | wc -c | tr -d ' ')
  _chars=$(printf '%s' "$_label" | wc -m | tr -d ' ')
  _pad=$((12 - (_chars + (_bytes - _chars) / 2)))
  if [ "$_pad" -lt 1 ]; then
    _pad=1
  fi
  printf '  %s%*s%s\n' "$_label" "$_pad" '' "$2"
}

# ---------------------------------------------------------------- 参数
MODE=install
REGISTER=1
for arg in "$@"; do
  case "$arg" in
    --uninstall) MODE=uninstall ;;
    --no-register) REGISTER=0 ;;
    --help | -h)
      usage
      exit 0
      ;;
    *) die "未知参数 $arg（用 --help 查看用法）" ;;
  esac
done

# ---------------------------------------------------------------- 定位源码
# 通过 curl | sh 运行时 $0 是解释器名（sh/bash/...），拿不到脚本所在目录，
# 这时就把仓库拉下来。已经克隆过的话 $0 是脚本路径，直接原地安装。
SELF_DIR=""
case "${0##*/}" in
  sh | bash | dash | zsh | ksh | -sh | -bash) ;;
  *) SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || echo "") ;;
esac

# 同步或拉取源码。
# 不碰用户自己的目录：只在「工作区干净、且没有本地未推送提交」的克隆上做更新，
# 否则直接用现有版本，绝不 reset --hard 掉别人的改动。
ensure_source() {
  mkdir -p "$(dirname -- "$SOURCE_DIR")"

  if [ -d "$SOURCE_DIR/.git" ]; then
    git -C "$SOURCE_DIR" fetch --depth 1 origin "$BRANCH" >/dev/null 2>&1 || true
    # package-lock.json 由 npm install 自己改写，不算「本地改动」，排除掉；
    # 否则装过一次依赖之后就再也不会自动更新了。
    _dirty=$(git -C "$SOURCE_DIR" status --porcelain --untracked-files=no -- . \
      ':(exclude)package-lock.json' 2>/dev/null || echo x)
    _ahead=$(git -C "$SOURCE_DIR" log --oneline "origin/$BRANCH..HEAD" 2>/dev/null || echo x)
    if [ -z "$_dirty" ] && [ -z "$_ahead" ]; then
      if git -C "$SOURCE_DIR" reset --hard "origin/$BRANCH" >/dev/null 2>&1; then
        item '已同步' "origin/$BRANCH"
        return 0
      fi
    fi
    item '用现有版本' '源码目录有本地改动，不自动更新'
    return 0
  fi

  if [ -f "$SOURCE_DIR/install.sh" ]; then
    item '用现有版本' "$SOURCE_DIR"
    return 0
  fi

  if command -v git >/dev/null 2>&1; then
    # 失败时把 git 自己的报错打出来，否则「克隆失败」这四个字帮不上任何忙
    if ! _clone_out=$(git clone --depth 1 --branch "$BRANCH" "$CLONE_URL" "$SOURCE_DIR" 2>&1); then
      printf '%s\n' "$_clone_out" | sed 's/^/    /' >&2
      die "克隆失败：$CLONE_URL（分支 $BRANCH）"
    fi
    item '已克隆' "$CLONE_URL ($BRANCH)"
    return 0
  fi

  command -v curl >/dev/null 2>&1 || die "需要 git 或 curl 其中之一，但都没找到"
  [ -n "$TARBALL_URL" ] || die "没有 git，且 TOWER_MCP_REPO 不是 owner/repo 形式，无法下载源码"
  _tmp=$(mktemp -d)
  curl -fsSL "$TARBALL_URL" -o "$_tmp/pkg.tar.gz" ||
    die "下载失败：$TARBALL_URL"
  mkdir -p "$SOURCE_DIR"
  tar -xzf "$_tmp/pkg.tar.gz" -C "$SOURCE_DIR" --strip-components=1 || die "解压失败"
  rm -rf "$_tmp"
  item '已下载' "$REPO ($BRANCH)"
}

if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/package.json" ]; then
  PROJECT_DIR="$SELF_DIR"
else
  SOURCE_DIR="${TOWER_MCP_DIR:-$HOME/.tower-mcp/src}"

  printf '==> tower-mcp 在线安装\n'
  item '仓库' "$CLONE_URL"
  item '分支' "$BRANCH"
  item '源码目录' "$SOURCE_DIR"

  printf '\n==> 获取源码\n'
  ensure_source

  [ -f "$SOURCE_DIR/install.sh" ] || die "源码目录里没有 install.sh：$SOURCE_DIR"

  # 通过管道执行时 stdin 被脚本本身占用，交互式提问会读不到输入。
  # 有终端的话把 stdin 接回终端，后面的凭证询问和授权提示才能正常工作。
  if [ -r /dev/tty ]; then
    exec sh "$SOURCE_DIR/install.sh" "$@" </dev/tty
  fi
  exec sh "$SOURCE_DIR/install.sh" "$@"
fi

[ -f "$PROJECT_DIR/package.json" ] || die "请把 install.sh 放在 tower-mcp 项目根目录下运行"

# ---------------------------------------------------------------- 定位 node
# 不写死路径：运行时安装位置常带版本号，一升级就失效。
# macOS 上从 GUI 启动的进程拿不到用户 shell 的 PATH，所以必须有绝对路径兜底。
NODE=""
for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  "$HOME/.local/bin/node" \
  /usr/local/bin/node \
  /opt/homebrew/bin/node \
  /usr/bin/node
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE="$candidate"
    break
  fi
done
[ -n "$NODE" ] || die "未找到 node，请先安装 Node.js 18+"

NODE_VERSION=$("$NODE" -v 2>/dev/null || echo unknown)
NODE_MAJOR=$(printf '%s' "$NODE_VERSION" | sed 's/^v//; s/\..*$//')
case "$NODE_MAJOR" in
  '' | *[!0-9]*) die "无法识别 node 版本：$NODE_VERSION" ;;
esac
[ "$NODE_MAJOR" -ge 18 ] || die "需要 Node.js 18+，当前是 $NODE_VERSION"

# npm 优先取 node 同目录下的，版本必然匹配；不行再从 PATH 找
NPM="$(dirname "$NODE")/npm"
if [ ! -x "$NPM" ]; then
  NPM="$(command -v npm 2>/dev/null || true)"
fi
[ -n "$NPM" ] && [ -x "$NPM" ] || die "未找到 npm（应与 node 一同安装）"

# ---------------------------------------------------------------- 卸载
if [ "$MODE" = uninstall ]; then
  printf '==> 从 MCP 配置中移除 tower-mcp\n'
  "$NODE" "$PROJECT_DIR/scripts/register-mcp.mjs" unregister
  printf '\n完成。\n'
  printf '  node_modules 与 dist 已保留；要彻底删除直接移除目录：\n'
  printf '    %s\n' "$PROJECT_DIR"
  exit 0
fi

printf '==> tower-mcp 安装\n'
item '项目目录' "$PROJECT_DIR"
item 'node' "$NODE ($NODE_VERSION)"
item 'npm' "$NPM"

# ---------------------------------------------------------------- 1/4 依赖
printf '\n==> 1/4 安装依赖\n'
if [ -d "$PROJECT_DIR/node_modules" ] && [ "${TOWER_MCP_FORCE_INSTALL:-0}" != "1" ]; then
  item '跳过' 'node_modules 已存在（要强制重装设 TOWER_MCP_FORCE_INSTALL=1）'
else
  # 成功时保持安静，失败时把完整输出打出来
  if ! INSTALL_LOG=$(cd "$PROJECT_DIR" && "$NPM" install --no-audit --no-fund 2>&1); then
    printf '%s\n' "$INSTALL_LOG"
    die "npm install 失败"
  fi
  item '完成' '依赖已安装'
fi

# ---------------------------------------------------------------- 2/4 编译
printf '\n==> 2/4 编译\n'
if ! BUILD_LOG=$(cd "$PROJECT_DIR" && "$NPM" run build 2>&1); then
  printf '%s\n' "$BUILD_LOG"
  die "编译失败"
fi
[ -f "$PROJECT_DIR/dist/index.js" ] || die "编译后没有生成 dist/index.js"
item '完成' 'dist/index.js'

# ---------------------------------------------------------------- 3/4 验证
printf '\n==> 3/4 冒烟验证\n'
SMOKE_TOKEN="${TMPDIR:-/tmp}/tower-mcp-install-smoke.json"
SMOKE_OUT=$(TOWER_TOKEN_FILE="$SMOKE_TOKEN" "$PROJECT_DIR/bin/tower-mcp" </dev/null 2>&1 || true)
rm -f "$SMOKE_TOKEN"

case "$SMOKE_OUT" in
  *已启动*)
    TOOL_COUNT=$(printf '%s' "$SMOKE_OUT" | sed -n 's/.*注册 \([0-9][0-9]*\) 个工具.*/\1/p')
    if [ -n "$TOOL_COUNT" ]; then
      item '通过' "注册 $TOOL_COUNT 个工具"
    else
      item '通过' '服务可正常启动'
    fi
    ;;
  *)
    printf '%s\n' "$SMOKE_OUT" >&2
    die "服务启动失败，请看上面的输出"
    ;;
esac

# ---------------------------------------------------------------- 4/4 注册
CLIENT_ID="${TOWER_CLIENT_ID:-}"
CLIENT_SECRET="${TOWER_CLIENT_SECRET:-}"

printf '\n==> 4/4 注册到 MCP 配置\n'
if [ "$REGISTER" -eq 0 ]; then
  item '跳过' '指定了 --no-register'
  printf '\n  手动生成配置：npm run print-config\n'
else
  if [ -z "$CLIENT_ID" ] && [ -t 0 ]; then
    printf '  Tower 应用 ID (client_id)：'
    read -r CLIENT_ID || true
  fi
  if [ -z "$CLIENT_SECRET" ] && [ -t 0 ]; then
    printf '  Tower 私钥 (client_secret)：'
    read -r CLIENT_SECRET || true
  fi

  TOWER_CLIENT_ID="$CLIENT_ID" TOWER_CLIENT_SECRET="$CLIENT_SECRET" \
    "$NODE" "$PROJECT_DIR/scripts/register-mcp.mjs" register
fi

# ---------------------------------------------------------------- 授权
TOKEN_FILE="${TOWER_TOKEN_FILE:-$HOME/.tower-mcp/token.json}"
ENV_FILE_PATH="${TOWER_ENV_FILE:-$HOME/.tower-mcp/env}"

printf '\n==> OAuth 授权\n'
if [ -f "$TOKEN_FILE" ]; then
  item '跳过' "已存在令牌文件 $TOKEN_FILE"
elif [ "${TOWER_MCP_SKIP_AUTH:-0}" = "1" ] || [ ! -t 0 ]; then
  item '待办' '运行 npm run auth 完成授权'
else
  printf '  现在完成 OAuth 授权吗？[Y/n] '
  read -r ANSWER || true
  case "$ANSWER" in
    n | N | no | NO | No)
      item '待办' '稍后运行 npm run auth 完成授权'
      ;;
    *)
      printf '\n'
      (cd "$PROJECT_DIR" && TOWER_CLIENT_ID="$CLIENT_ID" TOWER_CLIENT_SECRET="$CLIENT_SECRET" "$NPM" run auth) ||
        die "授权失败"
      ;;
  esac
fi

# ---------------------------------------------------------------- 完成
CONFIG_PATH="${TOWER_MCP_CONFIG:-$HOME/.workbuddy-ai/mcp.json}"

printf '\n完成。\n\n'
item '服务入口' "$PROJECT_DIR/bin/tower-mcp"
item '令牌文件' "$TOKEN_FILE"
if [ "$REGISTER" -eq 1 ]; then
  item 'MCP 配置' "$CONFIG_PATH"
else
  item 'MCP 配置' '未自动写入（指定了 --no-register）'
fi

# ---------------------------------------------------------------- 可粘贴的配置
# 绝对路径直接打印出来，需要手动接的客户端（Claude Desktop / Cursor / Cline 等）
# 复制粘贴即可，不用自己去拼路径。
printf '\n==> 其他客户端用的配置\n\n'
if [ "$REGISTER" -eq 1 ]; then
  printf '  已自动写入上面那个 MCP 配置文件。\n'
  printf '  接入其他客户端时，把下面这段粘进它们的配置文件（mcpServers 下）即可：\n\n'
else
  printf '  把下面这段粘进你的 MCP 客户端配置文件（mcpServers 下）即可：\n\n'
fi

"$NODE" "$PROJECT_DIR/scripts/print-mcp-config.mjs" --json-only | sed 's/^/  /'

printf '\n  凭证由启动器自己从 %s 读取，所以配置里不用写 env。\n' "$ENV_FILE_PATH"
if [ "$ENV_FILE_PATH" != "$HOME/.tower-mcp/env" ]; then
  printf '\n  注意：你用了非默认的凭证路径。客户端拉起服务时不会自动带上 TOWER_ENV_FILE，\n'
  printf '        需要在上面那段配置里补一个 env 字段：\n'
  printf '          "env": { "TOWER_ENV_FILE": "%s" }\n' "$ENV_FILE_PATH"
fi
printf '\n  各客户端的配置文件位置见 README 的「接入其他 MCP 客户端」一节。\n'

# ---------------------------------------------------------------- 下一步
printf '\n下一步：\n'
case "$CONFIG_PATH" in
  *workbuddy*)
    printf '  1. 到 WorkBuddy 连接器管理页右上角的「自定义连接器」入口点一次「信任」，服务才会启用。\n'
    ;;
  *)
    printf '  1. 完全退出并重启客户端——MCP 配置只在启动时读取一次，热改不生效。\n'
    ;;
esac
printf '  2. 然后问 AI：「列出我的 Tower 团队」。\n'
printf '  3. 完整配置（含备选写法）随时可用：npm run print-config\n'
