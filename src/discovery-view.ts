import { addSearchClear } from './search-clear';
import { Component, ItemView, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { searchPodcasts, searchWechat, type CatalogFeed, type PodcastSearchResult } from './source-catalog';
import { blogCatalogSource, blogTags, categories, discoveryFeeds, filterDiscovery, independentBlogs, podcastRecommendations, wechatFeeds, type DiscoveryCollection } from './discovery';

export const DISCOVERY_VIEW_TYPE = 'qiaomu-ai-rss-discovery';
export class DiscoveryPanel extends Component {
  private cards!: HTMLElement;
  private count!: HTMLElement;
  private wechatTab!: HTMLButtonElement;
  private query = '';
  private category = '全部';
  private collection: DiscoveryCollection = 'featured';
  private tag = '';
  private limit = 60;
  private more!: HTMLButtonElement;
  private pending = new Set<string>();
  private errors = new Map<string, string>();
  private closed = false;
  private onlineFeeds: CatalogFeed[] = [];
  private wechatCatalogTotal: number | null = null;
  private wechatLoaded = false;
  private onlinePodcasts: PodcastSearchResult[] = [];
  private onlineMessage = '';
  private searchSerial = 0;
  private podcastSourceSerial = 0;
  private searchTimer?: number;
  constructor(private contentEl: HTMLElement, private plugin: QiaomuRssPlugin, private embedded = false) { super(); }
  onload() {
    this.closed = false; this.contentEl.empty(); this.contentEl.addClass('qrs-discovery');
    const page = this.contentEl.createDiv('qrs-discovery-page');
    const header = page.createDiv('qrs-discovery-header'); header.toggleClass('qrs-hidden', this.embedded);
    const intro = header.createDiv();
    intro.createEl('h1', { text: '发现值得读的内容' });
    intro.createEl('p', { text: '从一个好订阅开始，把阅读留给自己。' });
    const actions = header.createDiv('qrs-discovery-actions');
    actions.createEl('button', { text: '管理订阅' }).onclick = () => this.plugin.manageSubscriptions();
    actions.createEl('button', { text: '开始阅读', cls: 'mod-cta' }).onclick = () => { void this.plugin.readSubscriptions(); };
    const collections = page.createDiv({ cls: 'qrs-discovery-collections' });
    const featured = collections.createEl('button', { text: `精选订阅 · ${discoveryFeeds.length}`, attr: { 'aria-pressed': String(this.collection === 'featured') } });
    const blogs = collections.createEl('button', { text: `独立博客 · ${independentBlogs.length}`, attr: { 'aria-pressed': String(this.collection === 'blogs') } });
    const wechat = collections.createEl('button', { text: '微信公众号', attr: { 'aria-pressed': String(this.collection === 'wechat') } });
    this.wechatTab = wechat;
    const podcast = collections.createEl('button', { text: `海外播客 · 精选 ${podcastRecommendations.length}`, attr: { 'aria-pressed': String(this.collection === 'podcast') } });
    const standard = page.createEl('p', { cls: 'qrs-discovery-standard', text: '精选标准：长期原创、持续更新、RSS 全文、个人辨识度。目前 9 个，宁缺毋滥。' });
    const attribution = page.createDiv('qrs-discovery-attribution');
    attribution.createSpan({ text: '目录来自 ' });
    attribution.createEl('a', { text: '中文独立博客列表', href: blogCatalogSource, attr: { target: '_blank', rel: 'noopener noreferrer' } });
    attribution.createSpan({ text: '，由 Tim Qian 与社区维护（MIT）。收录不代表持续可用，添加时会验证。' });
    const fieldId = crypto.randomUUID(); page.createEl('label', { cls: 'qrs-visually-hidden', text: '搜索订阅目录', attr: { for: `qrs-discovery-search-${fieldId}` } });
    const search = page.createEl('input', { type: 'search', cls: 'qrs-discovery-search', placeholder: '搜索名称、主题或语言…', attr: { id: `qrs-discovery-search-${fieldId}` } });
    addSearchClear(search);
    search.value = this.query; search.oninput = () => { this.query = search.value; this.limit = 60; this.refresh(); this.scheduleSearch(); };
    const filters = page.createDiv({ cls: 'qrs-discovery-filters' });
    for (const category of categories) {
      const button = filters.createEl('button', { text: category, attr: { 'aria-pressed': String(this.category === category) } });
      button.onclick = () => {
        this.category = category; this.limit = 60;
        for (const item of filters.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
        this.refresh();
      };
    }
    page.createEl('label', { cls: 'qrs-visually-hidden', text: '博客主题', attr: { for: `qrs-discovery-tags-${fieldId}` } });
    const tags = page.createEl('select', { cls: 'qrs-discovery-tags dropdown', attr: { id: `qrs-discovery-tags-${fieldId}` } });
    tags.createEl('option', { value: '', text: '全部主题' });
    for (const tag of blogTags) tags.createEl('option', { value: tag, text: tag });
    tags.value = this.tag; tags.onchange = () => { this.tag = tags.value; this.limit = 60; this.refresh(); };
    const provider = page.createDiv('qrs-discovery-provider');
    this.count = provider.createSpan({ cls: 'qrs-discovery-count', attr: { role: 'status' } });
    this.cards = page.createDiv('qrs-discovery-grid');
    this.more = page.createEl('button', { text: '显示更多博客', cls: 'qrs-discovery-more' });
    this.more.onclick = () => { this.limit += 60; this.refresh(); };
    const switchCollection = (collection: DiscoveryCollection) => {
      if (this.collection !== collection) { this.query = ''; search.value = ''; }
      if (collection !== 'podcast') this.podcastSourceSerial++;
      this.collection = collection; this.limit = 60;
      featured.setAttribute('aria-pressed', String(collection === 'featured')); blogs.setAttribute('aria-pressed', String(collection === 'blogs')); wechat.setAttribute('aria-pressed', String(collection === 'wechat')); podcast.setAttribute('aria-pressed', String(collection === 'podcast'));
      filters.toggleClass('qrs-hidden', collection !== 'featured'); standard.toggleClass('qrs-hidden', collection !== 'featured');
      for (const el of [tags, attribution]) el.toggleClass('qrs-hidden', collection !== 'blogs');
      search.placeholder = collection === 'blogs' ? '搜索博客、作者、网址或主题…' : collection === 'wechat' ? '搜索公众号目录…' : collection === 'podcast' ? '搜索更多海外播客…' : '搜索精选作者或主题…';
      this.refresh(); this.scheduleSearch();
      if (collection === 'podcast') void this.loadPodcastSources();
    };
    featured.onclick = () => switchCollection('featured'); blogs.onclick = () => switchCollection('blogs'); wechat.onclick = () => switchCollection('wechat'); podcast.onclick = () => switchCollection('podcast'); switchCollection(this.collection);
    this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => this.refresh()));
  }
  onunload() { this.closed = true; this.searchSerial++; this.podcastSourceSerial++; window.clearTimeout(this.searchTimer); }
  private scheduleSearch() {
    window.clearTimeout(this.searchTimer);
    const serial = ++this.searchSerial;
    const collection = this.collection, query = this.query.trim();
    this.onlineFeeds = [];
    this.onlinePodcasts = [];
    if (collection === 'wechat') this.wechatLoaded = false;
    if (collection !== 'wechat' && collection !== 'podcast') { this.onlineMessage = ''; this.refresh(); return; }
    if (collection === 'podcast' && !query) { this.onlineMessage = ''; this.refresh(); return; }
    this.onlineMessage = '搜索中…'; this.refresh();
    this.searchTimer = window.setTimeout(() => {
      void (collection === 'wechat' ? searchWechat(this.plugin.state.settings.baseUrl, query) : searchPodcasts(this.plugin.state.settings.baseUrl, query))
        .then(result => {
          if (serial !== this.searchSerial || this.closed) return;
          if (collection === 'wechat') {
            const catalog = result as Awaited<ReturnType<typeof searchWechat>>;
            this.onlineFeeds = catalog.feeds;
            this.wechatCatalogTotal = catalog.total;
            this.wechatLoaded = true;
            this.wechatTab.setText(`微信公众号 · ${catalog.total}`);
          } else this.onlinePodcasts = result as PodcastSearchResult[];
          this.onlineMessage = ''; this.refresh();
        })
        .catch(() => { if (serial !== this.searchSerial || this.closed) return; this.onlineMessage = collection === 'wechat' ? '在线目录暂不可用，仍可使用精选公众号。' : '在线搜索暂不可用，仍可订阅下方推荐播客。'; this.refresh(); });
    }, query ? 350 : 0);
  }
  private async loadPodcastSources() {
    const serial = ++this.podcastSourceSerial;
    this.onlineMessage = '正在检查可用播客…'; this.refresh();
    try {
      const result = await this.plugin.api().sources();
      if (this.closed || serial !== this.podcastSourceSerial) return;
      this.plugin.state.sources = result.sources;
      this.onlineMessage = '';
      this.refresh();
    } catch { if (!this.closed && serial === this.podcastSourceSerial) { this.onlineMessage = '暂时无法确认播客频道状态，请稍后重试。'; this.refresh(); } }
  }
  refresh() {
    if (this.closed || !this.cards) return;
    // Preserve keyboard focus when a pending card finishes or another view updates.
    const active = this.contentEl.ownerDocument.activeElement;
    const focusedId = active instanceof HTMLElement && this.cards.contains(active) ? active.closest<HTMLElement>('[data-feed]')?.dataset.feed : undefined;
    this.cards.empty();
    if (this.collection === 'podcast') { this.renderPodcasts(); return; }
    const local = filterDiscovery(this.query, this.collection === 'featured' ? this.category : '全部', this.collection, this.tag);
    const feeds = this.collection === 'wechat' && this.wechatLoaded ? this.onlineFeeds : local;
    const total = this.collection === 'blogs' ? independentBlogs.length : this.collection === 'wechat' ? this.wechatLoaded ? this.wechatCatalogTotal ?? feeds.length : wechatFeeds.length : discoveryFeeds.length;
    this.count.setText(this.onlineMessage || `${feeds.length} / ${total} 个${this.collection === 'wechat' ? '公众号' : this.collection === 'blogs' ? '博客' : '订阅源'}`);
    this.more.toggleClass('qrs-hidden', feeds.length <= this.limit);
    this.more.setText(`显示更多（还剩 ${Math.max(0, feeds.length - this.limit)} 个）`);
    if (!feeds.length) this.cards.createDiv({ cls: 'qrs-empty', text: '没有找到匹配内容，试试其他关键词或分类。' });
    for (const feed of feeds.slice(0, this.limit)) {
      const url = feed.url;
      const subscribed = this.plugin.state.subscriptions.some(item => item.url === url ||
        (this.collection === 'wechat' && wechatFeeds.some(legacy => legacy.name === feed.name && legacy.url === item.url)));
      const card = this.cards.createEl('article', { cls: 'qrs-discovery-card', attr: { 'data-feed': feed.id, tabindex: '-1' } });
      const heading = card.createDiv('qrs-discovery-card-heading');
      setIcon(heading.createSpan('qrs-discovery-icon'), 'icon' in feed ? feed.icon : 'rss');
      heading.createEl('h2', { text: feed.name });
      if ('category' in feed && this.collection !== 'wechat') card.createDiv({ cls: 'qrs-discovery-meta', text: `${feed.category} · ${feed.language}` });
      const description = 'description' in feed ? feed.description : wechatFeeds.find(item => item.name === feed.name)?.description;
      if (description) card.createEl('p', { cls: 'qrs-discovery-description', text: description });
      const footer = card.createDiv('qrs-discovery-card-footer');
      if (this.collection !== 'wechat') {
        footer.addClass('qrs-discovery-card-footer-with-link');
        const site = 'site' in feed && feed.site ? feed.site : url;
        footer.createEl('a', { text: new URL(site).hostname, href: site, attr: { target: '_blank', rel: 'noopener noreferrer' } });
      }
      const button = footer.createEl('button', { text: subscribed ? '已订阅' : this.pending.has(feed.id) ? '添加中…' : this.errors.has(feed.id) ? '重试' : '订阅' });
      button.disabled = subscribed || this.pending.has(feed.id);
      button.onclick = () => {
        if (this.pending.has(feed.id)) return;
        this.pending.add(feed.id); this.errors.delete(feed.id); this.refresh();
        void this.plugin.subscriptions.add(url, 'group' in feed ? feed.group : feed.category, this.contentEl.ownerDocument).then(async subscription => {
          await this.plugin.activateSubscription(subscription.id);
          new Notice(`已订阅 ${feed.name}`);
        }).catch((error: unknown) => {
          this.errors.set(feed.id, error instanceof Error ? error.message : '添加失败，请重试。');
        }).finally(() => { this.pending.delete(feed.id); this.refresh(); this.plugin.refreshDiscovery(); });
      };
      const error = this.errors.get(feed.id);
      if (error && !subscribed) card.createDiv({ cls: 'qrs-subscription-error', text: error, attr: { role: 'status' } });
    }
    if (focusedId) {
      const card = this.cards.querySelector<HTMLElement>(`[data-feed="${focusedId}"]`);
      (card?.querySelector<HTMLElement>('button:not(:disabled)') ?? card)?.focus({ preventScroll: true });
    }
  }
  private renderPodcasts() {
    const query = this.query.trim().toLocaleLowerCase();
    const recommended = podcastRecommendations.filter(show => `${show.name} ${show.nameZh}`.toLocaleLowerCase().includes(query));
    const shows: { slug: string; name: string; nameZh: string; sourceId: string; description?: string }[] = [...recommended, ...this.onlinePodcasts.filter(show => !podcastRecommendations.some(item => item.slug === show.slug)).map(show => ({ ...show, nameZh: '', sourceId: `podscribe-${show.slug}` }))];
    this.count.setText(this.onlineMessage || (query ? `${shows.length} 个搜索结果` : `精选 ${shows.length} 个播客 · 搜索可添加更多`));
    this.more.addClass('qrs-hidden');
    if (!shows.length) this.cards.createDiv({ cls: 'qrs-empty', text: '没有找到匹配的播客，试试更短的关键词。' });
    for (const show of shows) {
      const available = show.sourceId.startsWith('podscribe-') || this.plugin.state.sources.some(source => source.id === show.sourceId && source.enabled !== false);
      const followed = this.plugin.state.settings.followedPodcasts.includes(show.sourceId);
      const card = this.cards.createEl('article', { cls: 'qrs-discovery-card', attr: { 'data-feed': show.sourceId } });
      const heading = card.createDiv('qrs-discovery-card-heading');
      setIcon(heading.createSpan('qrs-discovery-icon'), 'mic'); heading.createEl('h2', { text: show.name });
      if (show.nameZh) card.createDiv({ cls: 'qrs-discovery-meta', text: show.nameZh });
      if (show.description) card.createEl('p', { cls: 'qrs-discovery-description', text: show.description });
      const footer = card.createDiv('qrs-discovery-card-footer');
      const button = footer.createEl('button', { text: followed ? '阅读' : available ? '订阅' : '尚未开放' });
      button.disabled = !available || this.pending.has(show.sourceId);
      button.onclick = () => {
        if (!available || this.pending.has(show.sourceId)) return;
        this.pending.add(show.sourceId); this.refresh();
        void this.plugin.followPodcast(show.sourceId, show.name).catch(error => {
          this.errors.set(show.sourceId, error instanceof Error ? error.message : '订阅失败，请重试。');
        }).finally(() => { this.pending.delete(show.sourceId); this.refresh(); });
      };
      if (followed) {
        const remove = footer.createEl('button');
        setIcon(remove, 'x');
        remove.createSpan({ cls: 'qrs-visually-hidden', text: `取消订阅 ${show.name}` });
        remove.onclick = () => { void this.plugin.unfollowPodcast(show.sourceId).catch(error => {
          this.errors.set(show.sourceId, error instanceof Error ? error.message : '取消订阅失败，请重试。'); this.refresh();
        }); };
      }
      const error = this.errors.get(show.sourceId);
      if (error) card.createDiv({ cls: 'qrs-subscription-error', text: error, attr: { role: 'status' } });
    }
  }
}

/** Restores existing workspace tabs; new exploration opens inside subscription management. */
export class DiscoveryView extends ItemView {
  private panel?: DiscoveryPanel;
  constructor(leaf: WorkspaceLeaf, private plugin: QiaomuRssPlugin) { super(leaf); }
  getViewType() { return DISCOVERY_VIEW_TYPE; }
  getDisplayText() { return '探索订阅'; }
  getIcon() { return 'compass'; }
  onOpen(): Promise<void> { this.panel = new DiscoveryPanel(this.contentEl, this.plugin); this.addChild(this.panel); return Promise.resolve(); }
  refresh() { this.panel?.refresh(); }
}
