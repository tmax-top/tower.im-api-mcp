/**
 * 标签映射的读取与解析。
 *
 * 背景：Tower 的公开 API **不提供任何标签接口**，任务响应里也只有标签名、没有 id。
 * 而写任务用的 `label_ids` 需要的是**百万级的数字 id**。所以 id 只能从网页端
 * 「标签管理」页抓取（见 scripts/sync-labels.mjs），落到本地文件后由这里读取。
 *
 * 另一个坑：`label_ids` 只认**全局标签**（team labels），项目标签传进去会返回
 * HTTP 200 但什么都不发生——静默失败。所以这里严格校验，名字对不上就直接报错，
 * 把静默失败挡在发请求之前。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LabelEntry {
  id: number;
  name: string;
  count: number | null;
}

export interface LabelsFile {
  teamId: string;
  teamName: string | null;
  syncedAt: string;
  source: string;
  labels: {
    global: LabelEntry[];
    project: LabelEntry[];
  };
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export function labelsFilePath(): string {
  return expandHome(process.env.TOWER_LABELS_FILE ?? '~/.tower-mcp/labels.json');
}

/** 项目根目录（dist/labels.js 的上一级）——提示里要给出可直接复制的命令 */
function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * 本地还没有标签映射文件时，返回一段可直接照做的指引；文件存在则返回 null。
 *
 * 这个检查会在两处用到：服务启动时打到 stderr，以及任何带标签的操作被调用时
 * 附在结果里——避免用户「打标签没报错但也没生效」却不知道要先同步。
 */
export function labelsFileHint(): string | null {
  if (existsSync(labelsFilePath())) return null;
  return (
    `⚠️ 还没有标签映射文件：${labelsFilePath()}\n` +
    'Tower 的公开 API 不提供标签接口，标签名和数字 id 的对应关系只能从网页端同步一次。\n' +
    '请让用户在项目目录执行：\n' +
    `  cd "${projectRoot()}" && npm run labels:sync\n` +
    '（需要先从浏览器复制一份会话 cookie，README 的「标签」一节有详细步骤）'
  );
}

/** 读取映射文件；不存在或损坏时返回 null（调用方给出可操作的提示） */
export function loadLabels(): LabelsFile | null {
  const path = labelsFilePath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as LabelsFile;
    if (!Array.isArray(parsed?.labels?.global)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function globalLabels(): LabelEntry[] {
  return loadLabels()?.labels.global ?? [];
}

/** 按名字模糊查找全局标签，用于给出「你是不是想找」的提示 */
export function searchGlobalLabels(query: string, limit = 8): LabelEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = globalLabels();
  const exactPrefix = all.filter((l) => l.name.toLowerCase().startsWith(q));
  const contains = all.filter(
    (l) => !l.name.toLowerCase().startsWith(q) && l.name.toLowerCase().includes(q),
  );
  return [...exactPrefix, ...contains].slice(0, limit);
}

function describeAvailable(): string {
  const hint = labelsFileHint();
  if (hint) return hint;
  const all = globalLabels();
  return `可用的全局标签（${all.length} 个）：${all.map((l) => l.name).join('、')}`;
}

/**
 * 把「数字 id 或标签名」的混合数组解析成数字 id 数组。
 *
 * 名字只在**全局标签**里找——项目标签 API 设不了，找到了也不能用，
 * 所以对项目标签单独给出明确报错，而不是让它静默失败。
 *
 * @throws 名字对不上时抛错，并列出候选
 */
export function resolveLabelRefs(refs: readonly (number | string)[]): number[] {
  const file = loadLabels();
  const globals = file?.labels.global ?? [];
  const byName = new Map(globals.map((l) => [l.name.toLowerCase(), l.id]));
  const byId = new Map(globals.map((l) => [l.id, l]));
  const projectNames = new Set((file?.labels.project ?? []).map((l) => l.name.toLowerCase()));

  const out: number[] = [];
  for (const ref of refs) {
    if (typeof ref === 'number') {
      // 数字直接放行：可能是本地映射里没有、但确实存在的标签。
      // 传错的话 Tower 会静默忽略，所以这里只提示、不拦截。
      out.push(ref);
      continue;
    }

    const key = ref.trim().toLowerCase();
    const id = byName.get(key);
    if (id !== undefined) {
      out.push(id);
      continue;
    }

    if (projectNames.has(key)) {
      throw new Error(
        `「${ref}」是**项目标签**，不能通过 API 设置——Tower 对项目标签会返回 200 ` +
          '但什么都不做（静默失败）。只能用全局标签。\n' + describeAvailable(),
      );
    }

    const similar = searchGlobalLabels(ref);
    throw new Error(
      `找不到名为「${ref}」的全局标签。\n` +
        (similar.length ? `你是不是想找：${similar.map((l) => l.name).join('、')}\n` : '') +
        describeAvailable(),
    );
  }

  // 去重，保持顺序
  return [...new Set(out)];
}

/** 把 id 数组还原成名字，便于在结果里显示 */
export function labelNamesOf(ids: readonly number[]): string[] {
  const byId = new Map(globalLabels().map((l) => [l.id, l.name]));
  return ids.map((id) => byId.get(id) ?? `#${id}`);
}
