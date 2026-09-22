import { describe, expect, it } from 'vitest';
import { discoveryFeeds, featuredXiaoyuzhouPodcasts, filterDiscovery, independentBlogs, podcastRecommendations, prependFeaturedPodcasts, qiaomuChannelDivider, readerChannelSources, wechatFeeds, xiaoyuzhouPodcasts } from '../src/discovery';
import { initialState, safeUrl, withServiceOrigin } from '../src/model';

describe('local discovery catalog', () => {
  it('bundles unique safe feed URLs and blog home pages', () => {
    const entries = [...discoveryFeeds, ...independentBlogs, ...wechatFeeds];
    expect(new Set(entries.map(feed => feed.id)).size).toBe(entries.length);
    for (const feed of entries) {
      expect(safeUrl(feed.url)).not.toBeNull();
      if (feed.site) expect(safeUrl(feed.site)).not.toBeNull();
    }
    expect(new Set(independentBlogs.map(feed => feed.url)).size).toBe(independentBlogs.length);
    expect(entries.some(feed => feed.url === 'https://blog.qiaomu.ai/feed.xml')).toBe(false);
  });
  it('keeps nine direct featured feeds separate from RSSHub routes', () => {
    expect(discoveryFeeds).toHaveLength(9);
    expect(discoveryFeeds.every(feed => !!feed.url)).toBe(true);
    expect(filterDiscovery('阮一峰 技术', 'AI 与技术').map(feed => feed.id)).toEqual(['ruanyifeng']);
    expect(filterDiscovery('no-matches-here', '全部')).toEqual([]);
  });
  it('separates large blog catalog and ignores hidden curated filters', () => {
    expect(independentBlogs.length).toBeGreaterThan(1000);
    expect(filterDiscovery('', '人文与生活', 'blogs')).toHaveLength(independentBlogs.length);
    const blogs = filterDiscovery('diygod', '全部', 'blogs', '开源');
    expect(blogs.length).toBeGreaterThan(0);
    expect(blogs.every(feed => feed.tags?.includes('开源'))).toBe(true);
    expect(filterDiscovery('', '全部')).toHaveLength(discoveryFeeds.length);
  });
  it('offers eight opt-in WeChat feeds without adding them to featured defaults', () => {
    expect(wechatFeeds).toHaveLength(8);
    expect(filterDiscovery('', '全部')).toHaveLength(discoveryFeeds.length);
    expect(filterDiscovery('', '全部', 'wechat')).toHaveLength(8);
    expect(filterDiscovery('卡兹克', '全部', 'wechat').map(feed => feed.url))
      .toEqual(['https://rss.t5t6.com/weread/MP_WXS_3223096120.xml']);
  });
  it('uses distinct introductions for curated accounts and shows', () => {
    expect(new Set(wechatFeeds.map(feed => feed.description)).size).toBe(wechatFeeds.length);
    expect(podcastRecommendations).toHaveLength(10);
    expect(new Set(podcastRecommendations.map(show => show.description)).size).toBe(podcastRecommendations.length);
  });
  it('offers enabled Xiaoyuzhou sources returned by the Reader service', () => {
    const sources = initialState({ sources: [
      { id: 'latetalk', name: '晚点聊 LateTalk', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/61933ace1b4320461e91fd55', enabled: true },
      { id: 'disabled', name: '停用节目', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/123', enabled: false },
      { id: 'other', name: '其他节目', category: 'podcast', siteUrl: 'https://example.com/podcast/123', enabled: true },
    ] }).sources;
    expect(xiaoyuzhouPodcasts(sources).map(source => source.id)).toEqual(['latetalk']);
  });
  it('pins one latest episode from each selected Xiaoyuzhou show in the default feed', () => {
    const sources = initialState({ sources: [
      { id: '42zhangjing', name: '42章经', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/42', enabled: true },
      { id: 'nexttoken', name: 'Next Token', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/next', enabled: true },
      { id: 'zhangxiaojun', name: '张小珺', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/zhang', enabled: true },
      { id: 'latetalk', name: '晚点聊', category: 'podcast', siteUrl: 'https://www.xiaoyuzhoufm.com/podcast/late', enabled: false },
    ] }).sources;
    expect(featuredXiaoyuzhouPodcasts(sources).map(source => source.id)).toEqual(['zhangxiaojun', 'nexttoken', '42zhangjing']);
    const entry = (id: string, sourceId: string) => ({ id, sourceId, title: id });
    expect(prependFeaturedPodcasts([entry('news', 'news'), entry('zhang-1', 'zhangxiaojun')], [entry('zhang-1', 'zhangxiaojun'), entry('next-1', 'nexttoken')]).map(item => item.id))
      .toEqual(['zhang-1', 'next-1', 'news']);
  });
  it('shows selected Xiaoyuzhou shows as Qiaomu channels before subscription', () => {
    const source = (id: string, category: string, siteUrl?: string, enabled = true) => ({ id, name: id, category, siteUrl, enabled });
    const xy = (id: string) => source(id, 'podcast', `https://www.xiaoyuzhoufm.com/podcast/${id}`);
    const sources = [source('news', 'news'), xy('zhangxiaojun'), xy('nexttoken'), xy('42zhangjing'), xy('latetalk'), xy('bannatie'),
      source('wechat-bestblogs-2d790e38f8af54c5af77fa5fed687a7c66d34c22', 'article', 'https://mp.weixin.qq.com/'),
      source('lexfridman', 'podcast', 'https://lexfridman.com'), source('allin', 'podcast', 'https://youtube.com', false)];
    expect(readerChannelSources(sources).map(item => item.id)).toEqual(['news', 'zhangxiaojun', 'nexttoken', '42zhangjing', 'latetalk', 'bannatie']);
    expect(readerChannelSources(sources).map(item => item.id)).not.toContain('lexfridman');
    expect(readerChannelSources(sources).map(item => item.id)).not.toContain('allin');
  });
  it('adds visual dividers from source locations without changing source identity', () => {
    const source = (id: string, category: string, siteUrl: string) => ({ id, name: id, category, siteUrl });
    expect(qiaomuChannelDivider(source('wechat-qiaomu', 'article', 'https://mp.weixin.qq.com/'))).toBe('微信公众号');
    expect(qiaomuChannelDivider(source('zhangxiaojun', 'podcast', 'https://www.xiaoyuzhoufm.com/podcast/abc'))).toBe('小宇宙');
    expect(qiaomuChannelDivider(source('video', 'podcast', 'https://www.youtube.com/@example'))).toBe('YouTube');
    expect(qiaomuChannelDivider(source('bensbites', 'article', 'https://www.bensbites.com'))).toBe('Newsletter');
    expect(qiaomuChannelDivider(source('producthunt', 'news', 'https://www.producthunt.com'))).toBe('资讯');
    expect(qiaomuChannelDivider(source('qiaomu-blog', 'article', 'https://blog.qiaomu.ai'))).toBe('博客与网站');
  });
  it('migrates settings and preserves existing feed URLs across instance and Qiaomu changes', () => {
    const state = initialState({ settings: { folder: 'Notes' }, subscriptions: [{ id: 'test', url: 'https://old.example/36kr/newsflashes', name: 'News' }] });
    const next = withServiceOrigin(state, 'https://qiaomu.example');
    expect(next.subscriptions[0].url).toBe('https://old.example/36kr/newsflashes');
    expect(initialState({ settings: {} }).settings.lastSource).toBe('');
  });
});

it('preserves channel reading checkpoints across saved-state parsing', () => {
  const checkpoint = { entries: [], bundle: null, mode: 'original', filter: 'unread', query: '文章', unread: ['a'], cursor: 'page-2', hasMore: true, listTop: 620, readerTop: 1420, articlePending: false };
  const state = initialState({ channelStates: { channel: checkpoint } });
  expect(initialState(JSON.parse(JSON.stringify(state))).channelStates.channel).toEqual(checkpoint);
  expect(initialState({ channelStates: { invalid: { listTop: -1 } } }).channelStates).toEqual({});
});
