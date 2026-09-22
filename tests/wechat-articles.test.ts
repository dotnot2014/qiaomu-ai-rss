import { describe, expect, it } from 'vitest';
import { sameRemoteContent, sameWechatArticle, uniqueRemoteEntries, wechatArticleKey, xiaoyuzhouEpisodeKey } from '../src/wechat-articles';
import type { Entry } from '../src/model';

const base = 'https://mp.weixin.qq.com/s?__biz=MzYzNTA3NTgwNQ%3D%3D&mid=2247484532&idx=1&sn=abc';
const newer: Entry = { id: 'new', sourceId: 'wechat-elsewhere', title: '去他*的「世界模型」', link: base, publishedTs: 1789869600000 };
const older: Entry = { ...newer, id: 'old', link: `${base}&chksm=other`, publishedTs: 1789830908000 };

describe('WeChat article identity', () => {
  it('joins historical entries with different tracking parameters and timestamps', () => {
    expect(wechatArticleKey(base)).toBe(wechatArticleKey(older.link));
    expect(sameWechatArticle(newer, older)).toBe(true);
    expect(uniqueRemoteEntries([older, newer])).toEqual([newer]);
    expect(uniqueRemoteEntries([newer, older], 'old')).toEqual([older]);
  });
  it('keeps distinct articles even when titles match', () => {
    const next = { ...older, id: 'different', link: `${base.replace('idx=1', 'idx=2')}&chksm=other` };
    expect(uniqueRemoteEntries([newer, next])).toHaveLength(2);
    expect(uniqueRemoteEntries([newer, { ...older, id: 'another-source', sourceId: 'wechat-other' }])).toHaveLength(2);
  });
  it('does not treat lookalike or incomplete URLs as WeChat articles', () => {
    expect(wechatArticleKey('https://mp.weixin.qq.com.evil.test/s?__biz=x&mid=1&idx=1')).toBeNull();
    expect(wechatArticleKey('https://mp.weixin.qq.com/s?__biz=x&mid=1')).toBeNull();
    expect(uniqueRemoteEntries([{ ...newer, id: 'a', link: null }, { ...newer, id: 'b', link: null }])).toHaveLength(2);
  });
});

describe('Xiaoyuzhou episode identity', () => {
  const clean: Entry = { id: 'clean', sourceId: 'zhangxiaojun', title: '153. 和曾鸣聊产业史观', link: 'https://www.xiaoyuzhoufm.com/episode/6a97f287f03e74ee6b03ea5b', publishedTs: 1788393600000 };
  const tracked: Entry = { ...clean, id: 'tracked', link: `${clean.link}?utm_source=rss` };
  it('combines the live API duplicates while preserving the selected record', () => {
    expect(xiaoyuzhouEpisodeKey(tracked.link)).toBe(xiaoyuzhouEpisodeKey(clean.link));
    expect(sameRemoteContent(tracked, clean)).toBe(true);
    expect(uniqueRemoteEntries([tracked, clean])).toEqual([tracked]);
    expect(uniqueRemoteEntries([tracked, clean], 'clean')).toEqual([clean]);
  });
  it('keeps other episodes and sources distinct', () => {
    expect(uniqueRemoteEntries([clean, { ...tracked, id: 'other-source', sourceId: 'nexttoken' }])).toHaveLength(2);
    expect(uniqueRemoteEntries([clean, { ...tracked, id: 'other-episode', link: 'https://www.xiaoyuzhoufm.com/episode/another' }])).toHaveLength(2);
    expect(xiaoyuzhouEpisodeKey('https://www.xiaoyuzhoufm.com.evil.test/episode/6a97f287f03e74ee6b03ea5b')).toBeNull();
  });
});
