import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guessMimeType } from '../tools/upload.js';

test('guessMimeType：常见扩展名映射', () => {
  assert.equal(guessMimeType('a.png'), 'image/png');
  assert.equal(guessMimeType('B.JPG'), 'image/jpeg');
  assert.equal(guessMimeType('logo.svg'), 'image/svg+xml');
  assert.equal(guessMimeType('报告.pdf'), 'application/pdf');
  assert.equal(guessMimeType('数据.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(guessMimeType('clip.mp4'), 'video/mp4');
  assert.equal(guessMimeType('notes.md'), 'text/markdown');
});

test('guessMimeType：无扩展名与未知扩展名回退到 octet-stream', () => {
  assert.equal(guessMimeType('无扩展名'), 'application/octet-stream');
  assert.equal(guessMimeType('x.unknownext'), 'application/octet-stream');
  // 隐藏文件（.gitignore 之类）按无扩展名处理
  assert.equal(guessMimeType('.gitignore'), 'application/octet-stream');
});
