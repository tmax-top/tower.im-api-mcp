/**
 * Tower API 遵循 JSON:API 1.0 规范：
 *   { data: {...}, included: [...], jsonapi: { version: "1.0" } }
 *
 * 资源之间用 relationships 里的 { id, type } 引用互相指向，真正的对象
 * 摊在 included 数组里。这种结构对模型非常不友好——看到 "assignee": {"id":"73d2..."}
 * 完全不知道是谁。
 *
 * 本模块负责把它还原成人类和模型都能直接读的扁平对象：
 *   { id, content, assignee: { id, type, name: "本地开发" } }
 */

export interface JsonApiRef {
  id: string;
  type: string;
}

export interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: JsonApiRef | JsonApiRef[] | null }>;
}

export interface JsonApiDocument {
  data?: JsonApiResource | JsonApiResource[] | null;
  included?: JsonApiResource[];
  errors?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
}

/**
 * 用来给关系对象取一个人类可读名字的候选字段，按优先级排列。
 *
 * 顺序很关键：title 必须排在 content 前面。讨论(topics)的属性里
 * 同时有 title（标题）和 content（正文），若 content 优先，关系摘要里的
 * name 会变成整篇正文，既占上下文又答非所问。
 */
const NAME_KEYS = ['name', 'nickname', 'title', 'subject', 'content', 'filename'] as const;

/** 关系对象上额外保留的少量有用字段，避免输出膨胀 */
const EXTRA_KEYS: Record<string, readonly string[]> = {
  members: ['role'],
  projects: ['is_archived'],
  todolists: ['is_archived', 'is_default'],
  attachments: ['content_type', 'byte_size', 'url'],
  todos: ['is_completed', 'due_at', 'priority'],
};

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/**
 * Tower 的描述字段（todo.desc、comment.content）都是富文本 HTML。
 * 直接塞给模型会浪费大量 token 且难以阅读，这里转成纯文本。
 */
export function htmlToText(input: unknown): string {
  if (typeof input !== 'string' || input === '') return '';
  // 不含标签的纯文本直接返回，避免误伤内容里的 < >
  if (!/<[a-z!/]/i.test(input)) return decodeEntities(input);

  let s = input;
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|blockquote|li|tr)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '- ');
  s = s.replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function decodeEntities(s: string): string {
  return s.replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
}

function refKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function displayName(attributes: Record<string, unknown> | undefined): string | undefined {
  if (!attributes) return undefined;
  for (const key of NAME_KEYS) {
    const value = attributes[key];
    if (typeof value === 'string' && value.length > 0) {
      // comments.content / topics.subject 可能是富文本，取名字时也要清掉标签
      const text = htmlToText(value);
      if (text) return text;
    }
  }
  return undefined;
}

/** 把一条关系引用解析成紧凑摘要对象 */
function resolveRef(ref: JsonApiRef, index: Map<string, JsonApiResource>) {
  const target = index.get(refKey(ref.type, ref.id));
  if (!target) return { id: ref.id, type: ref.type };

  const summary: Record<string, unknown> = { id: target.id, type: target.type };
  const name = displayName(target.attributes);
  if (name !== undefined) summary.name = name;

  for (const key of EXTRA_KEYS[target.type] ?? []) {
    const value = target.attributes?.[key];
    if (value !== undefined && value !== null) summary[key] = value;
  }
  return summary;
}

/** 展平单条资源：attributes 铺到顶层，relationships 解析成嵌套摘要 */
function flattenResource(
  resource: JsonApiResource,
  index: Map<string, JsonApiResource>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { id: resource.id, ...(resource.attributes ?? {}) };

  // 描述类字段转纯文本，保留 xxx_html 原文以免丢失格式信息
  if (typeof out.desc === 'string' && /<[a-z!/]/i.test(out.desc)) {
    out.desc = htmlToText(out.desc);
  }
  // 评论正文与讨论正文都是富文本 HTML，统一转纯文本
  if (
    (resource.type === 'comments' || resource.type === 'topics') &&
    typeof out.content === 'string'
  ) {
    out.content = htmlToText(out.content);
  }

  for (const [relName, rel] of Object.entries(resource.relationships ?? {})) {
    const data = rel?.data;
    if (data === undefined) continue;
    if (data === null) {
      out[relName] = null;
    } else if (Array.isArray(data)) {
      out[relName] = data.map((r) => resolveRef(r, index));
    } else {
      out[relName] = resolveRef(data, index);
    }
  }
  return out;
}

/**
 * 列表类响应的统一外壳。
 *
 * 「恒定包装」是刻意的：模型的工具调用需要稳定的输出契约。
 * 如果按数据决定结构（有下一页才包一层），同一个工具翻到最后一页时
 * 会从对象突变回数组，模型无法预期；不同接口之间也不一致。
 * 现在「列表工具返回 { items, has_more }，单条查询返回对象」是固定契约，
 * 代价只有约 35 字节。
 */
export interface FlattenedList {
  items: unknown[];
  /**
   * 是否还有下一页，由 links.next 推断。
   * 注意：并非所有接口的响应都带 links（官方文档样本本身也不完整），
   * 这类接口恒为 false，翻页请自行递增 page 参数。
   */
  has_more: boolean;
  /** 下一页页码，从 links.next 的 page[number] 解析；仅当 has_more 为 true 时才有 */
  next_page?: number;
}

function extractNextPage(nextUrl: string): number | undefined {
  try {
    const raw = new URL(nextUrl, 'https://tower.im').searchParams.get('page[number]');
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 把一份 JSON:API 文档展平。
 * - data 是数组 -> 恒定返回 { items, has_more, next_page? }
 * - data 是对象 -> 返回对象
 * - 没有 data（例如 204 或纯 meta）-> 原样返回
 */
export function flattenDocument(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') return payload;

  const doc = payload as JsonApiDocument;
  const included = Array.isArray(doc.included) ? doc.included : [];
  const index = new Map<string, JsonApiResource>();
  for (const resource of included) {
    if (resource?.id && resource?.type) index.set(refKey(resource.type, resource.id), resource);
  }

  const data = doc.data;
  if (Array.isArray(data)) {
    const items = data.map((r) => flattenResource(r, index));
    const links = (doc as { links?: Record<string, unknown> }).links;
    const next = typeof links?.next === 'string' && links.next ? links.next : undefined;

    const out: FlattenedList = { items, has_more: next !== undefined };
    if (next) {
      const nextPage = extractNextPage(next);
      if (nextPage !== undefined) out.next_page = nextPage;
    }
    return out;
  }
  if (data && typeof data === 'object') return flattenResource(data, index);
  return payload;
}

/**
 * 收尾清理：递归去掉值为 undefined 的键。
 * 注意：空数组是有语义的（如 comments: [] 表示「确实没有评论」），必须原样保留，
 * 不能为了省 token 把它抹掉——模型需要区分「没有」和「字段不存在」。
 */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => compact(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = compact(v);
    }
    return out as unknown as T;
  }
  return value;
}
