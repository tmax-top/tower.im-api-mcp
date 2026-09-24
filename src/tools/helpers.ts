import { z } from 'zod';
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

/**
 * 删除类工具的**强制二次确认**参数。
 *
 * 用 `z.literal(true)` 而不是 `z.boolean()`：只接受 `true`，传 `false` 会直接校验失败。
 * 这样模型没法「顺手」填个 false 蒙混过去，必须显式声明 true 才能调用，
 * 从而强制它在调用前走完「向用户说明 -> 取得明确同意」这一步。
 *
 * 注意：光靠工具描述里写「请先确认」是不够的——那只是建议，模型可能忽略。
 * 做成必填参数才是硬性约束。
 */
export const DELETE_CONFIRM = {
  confirm: z
    .literal(true)
    .describe(
      '删除确认，必须传 true。调用前必须先向用户说明要删除的对象（名称与 id），' +
        '并取得用户在对话中的明确同意；未取得同意时不要调用本工具。' +
        '用户此前说过要删不算数，每次删除都要重新确认。',
    ),
} as const;

/** 通用分页参数描述，多个工具复用 */
export const PAGE_DESC = '页码，从 1 开始；不传默认第一页';
export const SIZE_DESC = '每页条数';
