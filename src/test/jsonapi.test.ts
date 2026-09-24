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

test('flattenDocument：data 为数组时逐条展平', () => {
  const doc = {
    data: [
      { id: 'p1', type: 'projects', attributes: { name: '项目甲' } },
      { id: 'p2', type: 'projects', attributes: { name: '项目乙' } },
    ],
  };
  const flat = flattenDocument(doc) as Array<Record<string, unknown>>;
  assert.equal(flat.length, 2);
  assert.equal(flat[0].name, '项目甲');
  assert.equal(flat[1].name, '项目乙');
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
