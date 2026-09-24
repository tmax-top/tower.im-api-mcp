import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OOB_REDIRECT, assertRedirectUriAcceptable, resolveRedirect } from '../auth-redirect.js';

test('默认走 oob，不需要任何回调地址', () => {
  const r = resolveRedirect({ local: false });
  assert.equal(r.redirectUri, OOB_REDIRECT);
  assert.equal(r.useLocalServer, false);
});

test('显式指定 https 回调地址时启用本地回调服务', () => {
  const r = resolveRedirect({ local: false, redirectUri: 'https://example.com/callback' });
  assert.equal(r.redirectUri, 'https://example.com/callback');
  assert.equal(r.useLocalServer, true);
});

test('显式指定 oob URN 时不启用本地服务', () => {
  const r = resolveRedirect({ local: false, redirectUri: OOB_REDIRECT });
  assert.equal(r.useLocalServer, false);
});

test('命令行指定的回调地址优先于环境变量', () => {
  const r = resolveRedirect(
    { local: false, redirectUri: 'https://cli.example.com/cb' },
    'https://env.example.com/cb',
  );
  assert.equal(r.redirectUri, 'https://cli.example.com/cb');
});

test('只配了环境变量时也能用', () => {
  const r = resolveRedirect({ local: false }, 'https://env.example.com/cb');
  assert.equal(r.redirectUri, 'https://env.example.com/cb');
  assert.equal(r.useLocalServer, true);
});

test('--local 但没给回调地址时应报错并指明怎么改', () => {
  assert.throws(() => resolveRedirect({ local: true }), /--redirect-uri/);
});

test('http 回调地址被提前拦下（Tower 只接受 https）', () => {
  // 不拦的话用户要走到浏览器、登录之后才看到
  // "The redirect uri included is not valid."，CLI 只能干等到超时
  assert.throws(
    () => assertRedirectUriAcceptable('http://localhost:3000/callback'),
    /不接受 http/,
  );
});

test('https 与 oob 回调地址放行', () => {
  assert.doesNotThrow(() => assertRedirectUriAcceptable('https://example.com/callback'));
  assert.doesNotThrow(() => assertRedirectUriAcceptable('https://localhost:3000/callback'));
  assert.doesNotThrow(() => assertRedirectUriAcceptable(OOB_REDIRECT));
});
