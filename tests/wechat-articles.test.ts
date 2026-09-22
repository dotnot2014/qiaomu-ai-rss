import { describe, expect, it } from 'vitest';
import { sameWechatArticle, uniqueWechatEntries, wechatArticleKey } from '../src/wechat-articles';
import type { Entry } from '../src/model';

const base = 'https://mp.weixin.qq.com/s?__biz=MzYzNTA3NTgwNQ%3D%3D&mid=2247484532&idx=1&sn=abc';
const newer: Entry = { id: 'new', sourceId: 'wechat-elsewhere', title: '去他*的「世界模型」', link: base, publishedTs: 1789869600000 };
const older: Entry = { ...newer, id: 'old', link: `${base}&chksm=other`, publishedTs: 1789830908000 };

describe('WeChat article identity', () => {
  it('joins historical entries with different tracking parameters and timestamps', () => {
    expect(wechatArticleKey(base)).toBe(wechatArticleKey(older.link));
    expect(sameWechatArticle(newer, older)).toBe(true);
    expect(uniqueWechatEntries([older, newer])).toEqual([newer]);
    expect(uniqueWechatEntries([newer, older], 'old')).toEqual([older]);
  });
  it('keeps distinct articles even when titles match', () => {
    const next = { ...older, id: 'different', link: `${base.replace('idx=1', 'idx=2')}&chksm=other` };
    expect(uniqueWechatEntries([newer, next])).toHaveLength(2);
    expect(uniqueWechatEntries([newer, { ...older, id: 'another-source', sourceId: 'wechat-other' }])).toHaveLength(2);
  });
  it('does not treat lookalike or incomplete URLs as WeChat articles', () => {
    expect(wechatArticleKey('https://mp.weixin.qq.com.evil.test/s?__biz=x&mid=1&idx=1')).toBeNull();
    expect(wechatArticleKey('https://mp.weixin.qq.com/s?__biz=x&mid=1')).toBeNull();
    expect(uniqueWechatEntries([{ ...newer, id: 'a', link: null }, { ...newer, id: 'b', link: null }])).toHaveLength(2);
  });
});
