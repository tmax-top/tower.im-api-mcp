import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compact, flattenDocument, htmlToText } from '../jsonapi.js';

test('htmlToText：富文本转纯文本', () => {
  assert.equal(htmlToText('<p>第一行</p><p>第二行</p>'), '第一行\n第二行');
  assert.equal(htmlToText('a<br>b'), 'a\nb');
  assert.equal(htmlToText('<ul><li>甲</li><li>乙</li></ul>'), '- 甲\n- 乙');
  assert.equal(htmlToText('纯文本 &amp; 符号'), '纯文本 & 符号');
  assert.equal(htmlToText('<p>&nbsp;</p>'), '');
});

test('htmlToText：非字符串与空值安全', () => {
  assert.equal(htmlToText(null), '');
  assert.equal(htmlToText(undefined), '');
  assert.equal(htmlToText(123), '');
  assert.equal(htmlToText(''), '');
});

test('htmlToText：纯文本里的比较符号不被误删', () => {
  assert.equal(htmlToText('a < b 且 c > d'), 'a < b 且 c > d');
});

test('flattenDocument：relationships 解析成带名字的对象', () => {
  const doc = {
    data: {
      id: 'todo1',
      type: 'todos',
      attributes: { content: '写接口文档', desc: '<p>需要覆盖全部端点</p>' },
      relationships: {
        assignee: { data: { id: 'm1', type: 'members' } },
        todolist: { data: { id: 'l1', type: 'todolists' } },
        comments: { data: [{ id: 'c1', type: 'comments' }] },
        closer: { data: null },
      },
    },
    included: [
      { id: 'm1', type: 'members', attributes: { nickname: '张三', role: 'member' } },
      { id: 'l1', type: 'todolists', attributes: { name: '迭代一', is_default: false } },
      { id: 'c1', type: 'comments', attributes: { content: '<p>收到，今天处理</p>' } },
    ],
  };

  const flat = flattenDocument(doc) as Record<string, any>;

  assert.equal(flat.id, 'todo1');
  assert.equal(flat.content, '写接口文档');
  assert.equal(flat.desc, '需要覆盖全部端点');
  assert.deepEqual(flat.assignee, { id: 'm1', type: 'members', name: '张三', role: 'member' });
  assert.equal(flat.todolist.name, '迭代一');
  // 评论的 content 是富文本，取名字时也要清掉标签
  assert.equal(flat.comments[0].name, '收到，今天处理');
  assert.equal(flat.closer, null);
});

test('flattenDocument：data 为数组时逐条展平并恒定包一层', () => {
  const doc = {
    data: [
      { id: 'p1', type: 'projects', attributes: { name: '项目甲' } },
      { id: 'p2', type: 'projects', attributes: { name: '项目乙' } },
    ],
  };
  const flat = flattenDocument(doc) as {
    items: Array<Record<string, unknown>>;
    has_more: boolean;
    next_page?: number;
  };
  assert.equal(flat.items.length, 2);
  assert.equal(flat.items[0].name, '项目甲');
  assert.equal(flat.items[1].name, '项目乙');
  // 没有 links 时 has_more 恒为 false，结构不随数据变化
  assert.equal(flat.has_more, false);
  assert.equal(flat.next_page, undefined);
});

test('flattenDocument：讨论(topics)的正文会被转成纯文本', () => {
  const doc = {
    data: {
      id: 'topic1',
      type: 'topics',
      attributes: {
        title: '周会纪要',
        content: '<p>本周<b>重点</b>：完成上线<br>下周：复盘</p>',
      },
    },
  };

  const flat = flattenDocument(doc) as Record<string, any>;
  assert.equal(flat.title, '周会纪要');
  assert.equal(flat.content, '本周重点：完成上线\n下周：复盘');
});

test('flattenDocument：讨论作为关系出现时取标题而不是正文', () => {
  // topics 的属性里同时有 title 和 content，取名字必须优先 title，
  // 否则关系摘要里的 name 会变成整篇正文
  const doc = {
    data: {
      id: 'todo1',
      type: 'todos',
      attributes: { content: '整理会议结论' },
      relationships: { topic: { data: { id: 'tp1', type: 'topics' } } },
    },
    included: [
      {
        id: 'tp1',
        type: 'topics',
        attributes: { title: '周会纪要', content: '这是一整篇很长的讨论正文内容……' },
      },
    ],
  };

  const flat = flattenDocument(doc) as Record<string, any>;
  assert.equal(flat.topic.name, '周会纪要');
  assert.ok(!flat.topic.name.includes('很长的讨论正文'), '不应把正文当标题');
});

test('flattenDocument：数组带 links.next 时包装成分页提示', () => {
  const doc = {
    data: [{ id: 'n1', type: 'notifications', attributes: { message: '待办提醒' } }],
    links: {
      self: 'https://tower.im/api/v1/teams/t/notifications?page%5Bnumber%5D=1&page%5Bsize%5D=25',
      next: 'https://tower.im/api/v1/teams/t/notifications?page%5Bnumber%5D=2&page%5Bsize%5D=25',
      last: 'https://tower.im/api/v1/teams/t/notifications?page%5Bnumber%5D=3&page%5Bsize%5D=25',
    },
  };

  const flat = flattenDocument(doc) as Record<string, any>;
  assert.equal(flat.has_more, true);
  assert.equal(flat.next_page, 2);
  assert.equal(flat.items.length, 1);
  assert.equal(flat.items[0].id, 'n1');
});

test('flattenDocument：数组没有 links.next 时仍包一层，has_more 为 false', () => {
  const doc = {
    data: [{ id: 'p1', type: 'projects', attributes: { name: '项目甲' } }],
    links: { self: 'https://x', first: 'https://x', last: 'https://x' },
  };

  const flat = flattenDocument(doc) as Record<string, any>;
  assert.ok(!Array.isArray(flat), '列表结果必须是对象，不能退回数组');
  assert.equal(flat.has_more, false);
  assert.equal(flat.next_page, undefined);
  assert.equal(flat.items[0].id, 'p1');
});

test('flattenDocument：翻到最后一页时结构不发生突变', () => {
  // 这是「恒定包装」要解决的回归点：若按数据决定结构，
  // 最后一页会从对象突变回数组，模型无法预期。
  const page = (n: number, hasNext: boolean) => ({
    data: [{ id: 'tp' + n, type: 'topics', attributes: { title: '讨论' + n } }],
    links: {
      self: 'https://tower.im/api/v1/projects/p/topics?page%5Bnumber%5D=' + n,
      next: hasNext
        ? 'https://tower.im/api/v1/projects/p/topics?page%5Bnumber%5D=' + (n + 1)
        : null,
    },
  });

  const shapes: string[] = [];
  const more: boolean[] = [];
  for (const [n, hasNext] of [
    [1, true],
    [2, true],
    [3, false],
  ] as Array<[number, boolean]>) {
    const flat = flattenDocument(page(n, hasNext)) as Record<string, any>;
    shapes.push(Array.isArray(flat) ? 'array' : 'object');
    more.push(flat.has_more);
    assert.equal(flat.items.length, 1, '每页都应能取到 items');
  }

  assert.deepEqual(shapes, ['object', 'object', 'object'], '三页结构必须完全一致');
  assert.deepEqual(more, [true, true, false], 'has_more 应逐页反映是否还有下一页');
});

test('flattenDocument：included 缺失时保留原始 id 引用而不是崩溃', () => {
  const doc = {
    data: {
      id: 'todo1',
      type: 'todos',
      attributes: { content: '任务' },
      relationships: { assignee: { data: { id: 'unknown', type: 'members' } } },
    },
  };
  const flat = flattenDocument(doc) as Record<string, any>;
  assert.deepEqual(flat.assignee, { id: 'unknown', type: 'members' });
});

test('flattenDocument：没有 data 的文档原样返回', () => {
  assert.deepEqual(flattenDocument({ meta: { total: 3 } }), { meta: { total: 3 } });
  assert.equal(flattenDocument(null), null);
});

test('compact：去掉 undefined，保留空数组、false 和 0', () => {
  const input = { a: 1, b: [], c: undefined, d: false, e: 0, f: { g: [], h: 'x' } };
  // 空数组有语义（如 comments: [] 表示没有评论），必须保留
  assert.deepEqual(compact(input), { a: 1, b: [], d: false, e: 0, f: { g: [], h: 'x' } });
});
