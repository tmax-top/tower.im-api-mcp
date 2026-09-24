import { compact, flattenDocument } from '../jsonapi.js';

export interface ToolTextResult {
  // MCP 的 CallToolResult 带索引签名，这里必须保留，否则无法赋回 SDK 类型
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** 统一渲染：JSON:API -> 扁平对象 -> 紧凑 JSON 文本 */
function render(payload: unknown): string {
  if (payload === null || payload === undefined) return '操作成功（接口无返回内容）。';
  if (typeof payload === 'string') return payload;
  return JSON.stringify(compact(flattenDocument(payload)), null, 2);
}

/**
 * 所有工具的入口包装：把异常转成 MCP 的 isError 结果，
 * 而不是让整个进程崩掉——模型看到错误信息后还能自己纠正重试。
 */
export async function callTool(fn: () => Promise<unknown>): Promise<ToolTextResult> {
  try {
    return { content: [{ type: 'text', text: render(await fn()) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `调用失败：${message}` }], isError: true };
  }
}

/** 去掉值为 undefined 的键，避免把 undefined 塞进请求体。返回值保留原类型 */
export function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/** 分页参数：Tower 使用 page[number] / page[size] */
export function pagination(page?: number, size?: number): Record<string, string | number | undefined> {
  const q: Record<string, string | number | undefined> = {};
  if (page !== undefined) q['page[number]'] = page;
  if (size !== undefined) q['page[size]'] = size;
  return q;
}

export const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

/** 通用分页参数描述，多个工具复用 */
export const PAGE_DESC = '页码，从 1 开始；不传默认第一页';
export const SIZE_DESC = '每页条数';
