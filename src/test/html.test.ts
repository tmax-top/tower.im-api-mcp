import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALLOWED_TAGS,
  findStrippedTags,
  htmlProtectionNote,
  protectHtmlField,
  protectUnknownTags,
} from '../html.js';

test('白名单标签原样保留', () => {
  const src = '<p>段落</p><b>粗</b><br><ul><li>项</li></ul><a href="x">链接</a>';
  const { text, escaped } = protectUnknownTags(src);
  assert.equal(text, src);
  assert.deepEqual(escaped, []);
});

test('白名单外的标签被转义成字面量', () => {
  // 这是真实踩过的坑：Tower 会把 <token> 整个删掉
  const { text, escaped } = protectUnknownTags('access_token=<token>&contactId=<MK>');
  assert.equal(text, 'access_token=&lt;token&gt;&contactId=&lt;MK&gt;');
  assert.deepEqual(escaped, ['token', 'MK']);
});

test('Tower 不支持但看着像 HTML 的标签同样被转义', () => {
  // 实测 Tower 会删掉这些，转义反而能保住内容
  for (const tag of ['table', 'tr', 'td', 'video', 'u', 'mark', 'font', 'iframe', 'script']) {
    const { escaped } = protectUnknownTags(`<${tag}>x</${tag}>`);
    assert.ok(escaped.includes(tag), `${tag} 应被转义`);
  }
});

test('闭合标签也处理', () => {
  const { text } = protectUnknownTags('</token>');
  assert.equal(text, '&lt;/token&gt;');
});

test('带属性的未知标签整个转义，属性一并保留', () => {
  const { text } = protectUnknownTags('<custom-tag a="1">x</custom-tag>');
  assert.equal(text, '&lt;custom-tag a="1"&gt;x&lt;/custom-tag&gt;');
});

test('单独出现的尖括号不动（Tower 自己会转义）', () => {
  const src = '值 < 5 且 > 3';
  assert.equal(protectUnknownTags(src).text, src);
});

test('数字开头的尖括号不动', () => {
  const src = '<5>';
  assert.equal(protectUnknownTags(src).text, src);
});

test('已转义的内容不会被二次转义', () => {
  const src = 'access_token=&lt;token&gt;';
  const { text, escaped } = protectUnknownTags(src);
  assert.equal(text, src);
  assert.deepEqual(escaped, []);
});

test('同一标签重复出现只报一次', () => {
  const { escaped } = protectUnknownTags('<token>a</token><token>b</token>');
  assert.deepEqual(escaped, ['token']);
});

test('大小写不敏感：白名单按小写比对', () => {
  assert.deepEqual(protectUnknownTags('<B>粗</B>').escaped, []);
  assert.deepEqual(protectUnknownTags('<Token>x</Token>').escaped, ['Token']);
});

test('findStrippedTags 只检测不修改', () => {
  assert.deepEqual(findStrippedTags('a <token> b'), ['token']);
  assert.deepEqual(findStrippedTags('a <b> b'), []);
});

test('protectHtmlField：undefined 原样返回且无提示', () => {
  const r = protectHtmlField(undefined);
  assert.equal(r.text, undefined);
  assert.equal(r.note, null);
});

test('protectHtmlField：有风险标签时给出提示', () => {
  const r = protectHtmlField('复现：access_token=<token>');
  assert.match(r.text ?? '', /&lt;token&gt;/);
  assert.match(r.note ?? '', /<token>/);
  assert.match(r.note ?? '', /白名单外的标签会被整个删掉/);
});

test('protectHtmlField：没有风险标签时不打扰', () => {
  const r = protectHtmlField('<p>正常内容</p>');
  assert.equal(r.text, '<p>正常内容</p>');
  assert.equal(r.note, null);
});

test('htmlProtectionNote：空列表返回 null', () => {
  assert.equal(htmlProtectionNote([]), null);
});

test('白名单是实测得到的 40 个，不是随手加的', () => {
  // 固定数量，改动白名单时这个测试会提醒你「记得重新实测」
  assert.equal(ALLOWED_TAGS.size, 40);
  for (const t of ['p', 'br', 'b', 'strong', 'i', 'em', 'a', 'img', 'ul', 'li', 'code', 'pre']) {
    assert.ok(ALLOWED_TAGS.has(t), `${t} 应在白名单内`);
  }
  // 这些实测会被 Tower 删掉，绝不能进白名单
  for (const t of ['u', 'table', 'video', 'script', 'font', 'center', 'mark']) {
    assert.ok(!ALLOWED_TAGS.has(t), `${t} 实测会被删，不该在白名单里`);
  }
});
