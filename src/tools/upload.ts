import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TowerClient } from '../tower-client.js';
import {
  DELETE_CONFIRM,
  DESTRUCTIVE,
  PAGE_DESC,
  READ_ONLY,
  WRITE,
  callTool,
  omitUndefined,
  pagination,
} from './helpers.js';

interface DirectUploadTicket {
  guid: string;
  directUpload: {
    OSSAccessKeyId: string;
    policy: string;
    Signature: string;
    url: string;
    callback: string;
    key: string;
  };
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  gz: 'application/gzip',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  json: 'application/json',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** 按扩展名推断 MIME 类型。OSS 回调里的 mimeType 取自上传时的 Content-Type，缺省 octet-stream 会让 Tower 无法生成图片预览 */
export function guessMimeType(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return 'application/octet-stream';
  const ext = filename.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function registerUploadTools(server: McpServer, client: TowerClient): number {
  server.registerTool(
    'tower_list_uploads',
    {
      title: '获取项目文件列表',
      description: '列出某个项目「文件」板块下的文件，含文件名、大小、类型和可访问的下载地址。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
        page: z.number().int().positive().optional().describe(PAGE_DESC),
      },
      annotations: READ_ONLY,
    },
    ({ project_id, page }) =>
      callTool(() => client.get(`/projects/${project_id}/uploads`, pagination(page))),
  );

  server.registerTool(
    'tower_get_upload',
    {
      title: '获取文件详情',
      description: '按文件 id 获取文件详情。',
      inputSchema: {
        upload_id: z.string().describe('文件 id'),
      },
      annotations: READ_ONLY,
    },
    ({ upload_id }) => callTool(() => client.get(`/uploads/${upload_id}`)),
  );

  server.registerTool(
    'tower_create_upload',
    {
      title: '创建文件记录',
      description:
        '把一个已上传的附件（attfile_guid）挂到项目的「文件」板块。一般不需要直接调用——用 tower_upload_file 一步到位即可。',
      inputSchema: {
        project_id: z.string().describe('项目 id'),
        attfile_guid: z.string().describe('附件 guid，由直传签名接口返回'),
      },
      annotations: WRITE,
    },
    ({ project_id, attfile_guid }) =>
      callTool(() => client.post(`/projects/${project_id}/uploads`, { attfile_guid })),
  );

  server.registerTool(
    'tower_delete_upload',
    {
      title: '删除文件',
      description:
        '从项目文件列表中删除指定文件，不可逆。' +
        '调用前必须先向用户说明要删除的文件名与 id，取得明确同意后再传 confirm: true。',
      inputSchema: {
        upload_id: z.string().describe('文件 id'),
        ...DELETE_CONFIRM,
      },
      annotations: DESTRUCTIVE,
    },
    ({ upload_id }) => callTool(() => client.delete(`/uploads/${upload_id}`)),
  );

  server.registerTool(
    'tower_get_attachment_url',
    {
      title: '获取附件原始地址',
      description:
        '把附件 id（attfile_id）换成可直接访问的临时 URL。支持指定图片尺寸版本或强制下载。',
      inputSchema: {
        attfile_id: z.string().describe('附件 id'),
        filename: z.string().optional().describe('自定义下载文件名'),
        version: z.enum(['small', 'medium', 'large']).optional().describe('图片尺寸版本'),
        download: z.boolean().optional().describe('设为 true 生成下载链接而非预览链接'),
        content_type: z.string().optional().describe('自定义 Content Type'),
      },
      annotations: READ_ONLY,
    },
    ({ attfile_id, filename, version, download, content_type }) =>
      callTool(() =>
        client.get(`/attfiles/${attfile_id}`, omitUndefined({
          filename,
          version,
          download: download ? 'true' : undefined,
          content_type,
        })),
      ),
  );

  server.registerTool(
    'tower_upload_file',
    {
      title: '上传文件到项目',
      description:
        '把本地磁盘上的一个文件上传到指定项目。会自动完成「申请直传签名 -> 上传到阿里云 OSS -> 挂到项目文件列表」的完整流程，' +
        '成功后返回新文件的 id 与访问地址。file_path 需要是本地绝对路径。',
      inputSchema: {
        team_id: z.string().describe('团队 id'),
        project_id: z.string().describe('项目 id'),
        file_path: z.string().describe('本地文件的绝对路径'),
        name: z.string().optional().describe('在 Tower 中显示的文件名，默认取原文件名'),
      },
      annotations: WRITE,
    },
    ({ team_id, project_id, file_path, name }) =>
      callTool(async () => {
        const absPath = isAbsolute(file_path) ? file_path : resolve(file_path);

        const info = await stat(absPath).catch(() => null);
        if (!info) throw new Error(`文件不存在：${absPath}`);
        if (!info.isFile()) throw new Error(`不是文件：${absPath}`);

        const buffer = await readFile(absPath);
        const filename = name ?? basename(absPath);
        const md5 = createHash('md5').update(buffer).digest('hex');

        // 1) 申请直传签名
        const ticket = (await client.post(`/teams/${team_id}/direct_uploads`, {
          filename,
          byte_size: buffer.length,
          md5,
        })) as DirectUploadTicket;

        if (!ticket?.directUpload?.url) {
          throw new Error(`申请直传签名失败，返回内容：${JSON.stringify(ticket)}`);
        }

        // 2) 以 multipart/form-data 直传阿里云 OSS。
        //    表单字段顺序有讲究：file 必须放在最后。
        //    Blob 必须带 type：OSS 用 part 的 Content-Type 决定对象类型，
        //    缺省会变成 application/octet-stream，Tower 端就没了图片预览。
        const form = new FormData();
        form.append('key', ticket.directUpload.key);
        form.append('policy', ticket.directUpload.policy);
        form.append('OSSAccessKeyId', ticket.directUpload.OSSAccessKeyId);
        form.append('Signature', ticket.directUpload.Signature);
        form.append('callback', ticket.directUpload.callback);
        form.append(
          'file',
          new Blob([new Uint8Array(buffer)], { type: guessMimeType(filename) }),
          filename,
        );

        const ossRes = await fetch(ticket.directUpload.url, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(120_000),
        });
        const ossText = await ossRes.text();
        if (!ossRes.ok) {
          throw new Error(`上传到 OSS 失败（HTTP ${ossRes.status}）：${ossText.slice(0, 500)}`);
        }

        // 3) 挂到项目文件列表
        return client.post(`/projects/${project_id}/uploads`, { attfile_guid: ticket.guid });
      }),
  );

  return 6;
}
