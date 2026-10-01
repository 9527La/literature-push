import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { listDailyNews, getDailyNews, parseDailyNewsMeta, DailyNewsError } from './daily-news.js';

const SAMPLE_MD = `# 电力能源每日资讯 2026-09-29

## 概览

### 政策文件
- 政策甲（某机构）\`#1\`
- 政策乙（某机构）\`#2\`

### 重点新闻
- 新闻丙（某来源）\`#3\`

---

## 政策甲 \`#1\`

**某机构** 发布了政策甲。

\`\`\`
https://example.com/a
\`\`\`

* * *

## 新闻丙 \`#3\`

**某来源** 报道了新闻丙。

\`\`\`
https://example.com/c
\`\`\`

* * *

**提示**：内容由 AI 辅助创作。
`;

function makeWorkdir() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'literature-daily-news-'));
  mkdirSync(path.join(dataDir, 'daily-news'), { recursive: true });
  return dataDir;
}

test('listDailyNews parses meta and sorts dates descending', () => {
  const dataDir = makeWorkdir();
  try {
    writeFileSync(path.join(dataDir, 'daily-news', '2026-09-29.md'), SAMPLE_MD, 'utf8');
    writeFileSync(
      path.join(dataDir, 'daily-news', '2026-09-28.md'),
      '# 电力能源每日资讯 2026-09-28\n\n## 概览\n\n### 政策文件\n- 只有政策丁（某机构）`#1`\n',
      'utf8'
    );
    const result = listDailyNews(dataDir);
    assert.equal(result.total, 2);
    assert.deepEqual(result.items.map((item) => item.date), ['2026-09-29', '2026-09-28']);
    const latest = result.items[0];
    assert.equal(latest.title, '电力能源每日资讯 2026-09-29');
    assert.deepEqual(latest.groups, [
      { name: '政策文件', count: 2 },
      { name: '重点新闻', count: 1 }
    ]);
    assert.equal(latest.total, 3);
    assert.equal(result.items[1].groups[0].count, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('listDailyNews ignores non-whitelist filenames and unreadable entries', () => {
  const dataDir = makeWorkdir();
  try {
    writeFileSync(path.join(dataDir, 'daily-news', '2026-09-29.md'), SAMPLE_MD, 'utf8');
    writeFileSync(path.join(dataDir, 'daily-news', 'notes.md'), 'junk', 'utf8');
    writeFileSync(path.join(dataDir, 'daily-news', '2026-9-9.md'), 'junk', 'utf8');
    writeFileSync(path.join(dataDir, 'daily-news', '../../etc-passwd.md'), 'junk', 'utf8');
    const result = listDailyNews(dataDir);
    assert.equal(result.total, 1);
    assert.equal(result.items[0].date, '2026-09-29');
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('listDailyNews returns empty list when directory is missing or empty', () => {
  const missing = mkdtempSync(path.join(tmpdir(), 'literature-daily-news-missing-'));
  try {
    assert.deepEqual(listDailyNews(missing), { items: [], total: 0 });
    const empty = makeWorkdir();
    try {
      assert.deepEqual(listDailyNews(empty), { items: [], total: 0 });
    } finally {
      rmSync(empty, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  } finally {
    rmSync(missing, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('getDailyNews returns date, meta and full markdown', () => {
  const dataDir = makeWorkdir();
  try {
    writeFileSync(path.join(dataDir, 'daily-news', '2026-09-29.md'), SAMPLE_MD, 'utf8');
    const detail = getDailyNews(dataDir, '2026-09-29');
    assert.equal(detail.date, '2026-09-29');
    assert.equal(detail.title, '电力能源每日资讯 2026-09-29');
    assert.equal(detail.total, 3);
    assert.equal(detail.markdown, SAMPLE_MD);
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('getDailyNews rejects invalid dates with 400 (path traversal safe)', () => {
  const dataDir = makeWorkdir();
  try {
    for (const bad of ['../../etc', '2026-9-9', 'abc', '', undefined, '2026-09-29.md']) {
      assert.throws(() => getDailyNews(dataDir, bad), (error) => {
        assert.ok(error instanceof DailyNewsError);
        assert.equal(error.statusCode, 400);
        return true;
      });
    }
    assert.throws(() => getDailyNews(dataDir, '2026-09-28'), (error) => {
      assert.ok(error instanceof DailyNewsError);
      assert.equal(error.statusCode, 404);
      return true;
    });
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('parseDailyNewsMeta handles empty group and missing title', () => {
  const meta = parseDailyNewsMeta('## 概览\n\n### 政策文件\n今日无新发布政策文件\n');
  assert.equal(meta.title, null);
  assert.deepEqual(meta.groups, [{ name: '政策文件', count: 0 }]);
  assert.equal(meta.total, 0);
  assert.deepEqual(parseDailyNewsMeta(''), { title: null, groups: [], total: 0 });
});
