const API_BASE = "https://music-api.gdstudio.xyz/api.php";
const DEFAULT_COVER = "data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.12)' stroke-width='1.5'%3e%3ccircle cx='12' cy='12' r='10'/%3e%3ccircle cx='12' cy='12' r='3'/%3e%3c/svg%3e";
const QUALITY_MAP = { 'flac': 'SQ 无损', '320': 'HQ 320K', '192': 'LQ 192K', '128': 'LQ 128K' };
const SOURCE_DISPLAY_MAP = { 'netease': '网易云', 'tencent': 'QQ音乐', 'kugou': '酷狗', 'kuwo': '酷我', 'tidal': 'Tidal' };

const MODE_ICONS = {
    list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
    random: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>`,
    single: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="14.5" font-size="7.5" font-weight="900" fill="currentColor" stroke="none" text-anchor="middle">1</text></svg>`
};

const APPLE_MUSIC_ICON = `
<svg viewBox="0 0 24 24" class="apple-music-icon">
    <path d="M17 4v10.5
             a3.5 3.5 0 1 1-2-3.16V7.3
             l-6 1.3v7.9
             a3.5 3.5 0 1 1-2-3.16V6.9
             L17 4z"
          fill="currentColor"/>
</svg>`;

const SYSTEM_SVG_ICONS = {
    play: `<svg viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z"/></svg>`,
    add: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
    delete: `<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
    search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`
};

const AppState = {
    _data: {
        isAuthed: localStorage.getItem('CM_FLAT_AUTH') === 'true',
        playlist: [],
        allowedSources: ['netease', 'tidal'],
        searchResult: [],
        currentTrackIndex: -1,
        currentTrack: null,
        playMode: 'list',
        quality: localStorage.getItem('CM_PREFERRED_QUALITY') || 'flac',
        isPlaying: false,
        displayView: 'artwork',
        sheetOpen: false,
        sheetTab: 'search',
        currentTime: 0,
        duration: 0,
        parsedLyrics: [],
        searchPage: 1,
        hasMore: false,
        lastDirection: 'next'
    },
    init() {
        return new Proxy(this._data, {
            set(target, key, value) {
                const old = target[key];
                target[key] = value;
                if(old !== value) AppStore.onStateMutation(key, value);
                return true;
            }
        });
    }
};
const store = AppState.init();

const AppStore = {
    transitionToken: 0,
    toastTimer: null, wipeConfirm: false, wipeTimer: null, lastLyricIdx: -1, audio: null,
    
    // 建立一个轻量节点的缓存池
    domCache: {},

    async startup() {
        this.audio = document.getElementById('coreAudioEngine');
        
        // 提前将高频使用的进度条、歌词DOM缓存到内存中，避免在播放时频繁检索ID
        this.domCache = {
            scrubberFill: document.getElementById('scrubberFill'),
            scrubberHandle: document.getElementById('scrubberHandle'),
            timeCurrent: document.getElementById('timeCurrent'),
            timeDuration: document.getElementById('timeDuration'),
            lyricsBlock: document.getElementById('lyricsBlock'),
            lyricView: document.getElementById('lyricView')
        };

        this.bindAudioListeners();
        this.setupInitialUI();
        this.bindLyricViewClick(); 
        
        const initialWrapper = document.getElementById('currentSlideWrapper');
        if (initialWrapper) {
            const coverImg = initialWrapper.querySelector('.artwork-img');
            if (coverImg) {
                coverImg.src = DEFAULT_COVER;
                coverImg.id = 'currentCover';
                coverImg.style.opacity = '1';
                coverImg.onerror = function() { 
                    this.src = DEFAULT_COVER;
                };
            }
        }
        
        await this.loadServerConfigAndData();
        if (store.isAuthed) { this.activateMainStage(); }
    },
    async loadServerConfigAndData() {
        try {
            const [cfgRes, listRes] = await Promise.all([fetch('/api/config'), fetch('/api/playlist')]);
            if (cfgRes.ok) store.allowedSources = (await cfgRes.json()).sources;
            if (listRes.ok) store.playlist = await listRes.json();
        } catch (e) { console.error(e); }
    },
    async savePlaylistToServer() {
        try {
            await fetch('/api/playlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(store.playlist) });
        } catch (e) { console.error(e); }
    },
    setupInitialUI() {
        document.getElementById('playModeBtn').innerHTML = MODE_ICONS[store.playMode];
        document.getElementById('stageQualitySelector').value = store.quality;
        this.refreshAmbientBackground();
    },
    
    // 【已优化】：增加了控制区面板过滤拦截，完美根治 iPhone Safari 穿透误触
    bindLyricViewClick() {
        const lyricView = this.domCache.lyricView || document.getElementById('lyricView');
        if (!lyricView) return;
        lyricView.onclick = (e) => {
            const isClickControlBar = e.target.closest('.player-controls-panel') || 
                                      e.target.closest('#scrubberTrack') || 
                                      e.target.closest('.action-bars-cluster') ||
                                      e.target.closest('.music-dashboard-ctrls'); 
            if (isClickControlBar) return;
            this.switchDisplayMode('artwork');
        };
    },
    onStateMutation(key, val) {
        switch(key) {
            case 'isAuthed': if(val) this.activateMainStage(); break;
            case 'isPlaying':
                const deck = document.getElementById('playerDeck'), stylus = document.getElementById('playerStylus'), icon = document.getElementById('playPauseIcon');
                const coverImg =
                    document.querySelector(
                        '#currentSlideWrapper .artwork-img'
                    );
                if(val) { 
                    deck.classList.add('playing'); 
                    if (stylus) stylus.classList.add('on-record'); 
                    if (coverImg) coverImg.style.animationPlayState = 'running'; 
                    icon.innerHTML = `<path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`; 
                } else { 
                    deck.classList.remove('playing'); 
                    if (stylus) stylus.classList.remove('on-record'); 
                    if (coverImg) coverImg.style.animationPlayState = 'paused';  
                    icon.innerHTML = `<path fill="currentColor" d="M8 5v14l11-7z"/>`; 
                }
                break;
            case 'currentTrack':
                this.handleTrackViewTransition(val);

                // ⭐⭐⭐ 新增：列表自动刷新高亮
                if (store.sheetTab === 'library' || store.sheetTab === 'search') {
                    this.renderSheetLayout();
                }
                break;
            case 'playlist': if(store.sheetTab === 'library') this.renderSheetLayout(); break;
            case 'playMode': document.getElementById('playModeBtn').innerHTML = MODE_ICONS[val]; break;
            case 'sheetOpen': 
                document.getElementById('unifiedBottomSheet').classList.toggle('pan-up', val); 
                document.getElementById('sheetBackdropMask').classList.toggle('active', val);
                if (val) this.renderSheetLayout(); 
                break;
            case 'sheetTab': this.renderSheetLayout(); break;
            case 'quality': document.getElementById('badgeQualityText').innerText = QUALITY_MAP[val] || val; break;
        }
    },
    async validateCredentials() {
        const password = document.getElementById('passwordInput').value;
        try {
            const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
            if (res.ok) { localStorage.setItem('CM_FLAT_AUTH', 'true'); store.isAuthed = true; } 
            else { this.toast('验证失败', '密码错误'); }
        } catch (e) { this.toast('错误', '网络异常'); }
    },
    toast(title, msg) {
        if (this.toastTimer) clearTimeout(this.toastTimer);
        document.getElementById('appleAlertTitle').innerText = title || '';
        document.getElementById('appleAlertMsg').innerText = msg || '';
        document.getElementById('appleAlertMask').classList.add('active');
        this.toastTimer = setTimeout(() => { document.getElementById('appleAlertMask').classList.remove('active'); }, 1500);
    },
    activateMainStage() { document.getElementById('authOverlay').classList.add('hidden'); document.getElementById('mainStage').classList.add('active'); },
    switchDisplayMode(target) {
        if (!store.currentTrack) { this.toast('提示', '请先检索并播放一首单曲'); return; }
        const art = document.getElementById('artworkView'), lyr = this.domCache.lyricView || document.getElementById('lyricView');
        if (target === 'lyrics') { art.style.opacity = '0'; setTimeout(() => { art.style.display = 'none'; lyr.style.display = 'flex'; setTimeout(() => lyr.style.opacity = '1', 30); }, 250); }
        else { lyr.style.opacity = '0'; setTimeout(() => { lyr.style.display = 'none'; art.style.display = 'flex'; setTimeout(() => art.style.opacity = '1', 30); }, 250); }
        store.displayView = target;
    },
    openSheet(tab) { store.sheetTab = tab; store.sheetOpen = true; }, closeSheet() { store.sheetOpen = false; }, switchSheetTab(tab) { store.sheetTab = tab; },
    mutateQualitySetting(val) {
        store.quality = val; localStorage.setItem('CM_PREFERRED_QUALITY', val);
        this.toast('音质已切换', `当前首选: ${QUALITY_MAP[val]}`);
        if (store.currentTrackIndex !== -1) { this.playTrackByIndex(store.currentTrackIndex, store.playlist, false, this.audio.paused); }
    },

    async handleTrackViewTransition(track) {
        const token = ++this.transitionToken;
        const viewport = document.getElementById('vinylCoreClickZone');
        const oldWrapper = document.getElementById('currentSlideWrapper');

        let platform = track ? (track.platformSource || 'netease') : 'netease';
        let targetCoverUrl = '';

        if (track && track.pic && track.pic.startsWith('http')) {
            targetCoverUrl = track.pic.replace('http://', 'https://');
        } else if (track) {
            let targetId = track.pic_id || track.pic || track.id;
            let apiFetchUrl = `${API_BASE}?types=pic&id=${targetId}&source=${platform}&size=400`;
            
            try {
                const picRes = await fetch(apiFetchUrl);
                if (picRes.ok) {
                    const picJson = await picRes.json();
                    if (picJson && picJson.url) {
                        targetCoverUrl = picJson.url.startsWith('http://') ? picJson.url.replace('http://', 'https://') : picJson.url;
                    }
                }
            } catch (e) {
                console.error("解析 gdstudio 封面失败", e);
            }
        }

        const nextCover = document.createElement('img');
        nextCover.referrerPolicy = "no-referrer";
        nextCover.className = "artwork-img";
        nextCover.style.opacity = '1';
        nextCover.style.animationPlayState = store.isPlaying ? 'running' : 'paused';

        const triggerSlideAnimation = () => {

            if (token !== this.transitionToken) {
                return;
            }

            // 清理异常残留节点
            const wrappers =
                viewport.querySelectorAll(
                    '.vinyl-slide-wrapper'
                );

            wrappers.forEach(node => {

                if (
                    node !== oldWrapper &&
                    node.id !== 'currentSlideWrapper'
                ) {
                    node.remove();
                }

            });

            if (oldWrapper) {

                oldWrapper.removeAttribute('id');

                oldWrapper.classList.remove(
                    'slide-active'
                );

                oldWrapper.classList.add(
                    store.lastDirection === 'next'
                        ? 'slide-out-left'
                        : 'slide-out-right'
                );
            }

            const nextWrapper =
                document.createElement('div');

            nextWrapper.className =
                `vinyl-slide-wrapper ${
                    store.lastDirection === 'next'
                        ? 'slide-in-from-right'
                        : 'slide-in-from-left'
                }`;

            nextCover.id = 'currentCover';

            nextCover.style.animationPlayState =
                store.isPlaying
                    ? 'running'
                    : 'paused';

            nextWrapper.appendChild(nextCover);

            viewport.appendChild(nextWrapper);

            nextWrapper.offsetWidth;

            nextWrapper.classList.remove(
                'slide-in-from-right',
                'slide-in-from-left'
            );

            nextWrapper.classList.add(
                'slide-active'
            );

            setTimeout(() => {

                if (
                    token !== this.transitionToken
                ) {

                    nextWrapper.remove();
                    return;
                }

                viewport
                    .querySelectorAll(
                        '.vinyl-slide-wrapper'
                    )
                    .forEach(node => {

                        if (node !== nextWrapper) {
                            node.remove();
                        }

                    });

                nextWrapper.id =
                    'currentSlideWrapper';

                requestAnimationFrame(() => {

                    nextCover.style.animationPlayState =
                        store.isPlaying
                            ? 'running'
                            : 'paused';

                });

            }, 720);
        };

        let animationTriggered = false;

        const safeTrigger = () => {

            if (animationTriggered) {
                return;
            }

            animationTriggered = true;

            triggerSlideAnimation();
        };

        nextCover.onload = function () {

            safeTrigger();
        };

        nextCover.onerror = function () {

            this.onerror = null;

            // 默认封面也失败
            if (this.src === DEFAULT_COVER) {

                safeTrigger();
                return;
            }

            this.src = DEFAULT_COVER;
        };

        nextCover.src = targetCoverUrl || DEFAULT_COVER;

        if(!track) { 
            document.getElementById('currentTitle').innerText = 'Cloud Music'; 
            return; 
        }
        document.getElementById('currentTitle').innerText = track.name;
        document.getElementById('currentArtist').innerText = track.artist ? (Array.isArray(track.artist) ? track.artist.join(', ') : track.artist) : '未知歌手';
        this.refreshAmbientBackground();
    },

    refreshAmbientBackground() {
        const track = store.currentTrack, bg = document.getElementById('ambientBg'); if(!track) return;
        const hash = (track.name + track.id).split("").reduce((a,b)=>{a=((a<<5)-a)+b.charCodeAt(0);return a&a},0);
        bg.style.background = `radial-gradient(circle at 20% 25%, hsl(${Math.abs(hash)%360}, 55%, 12%) 0%, transparent 55%), radial-gradient(circle at 80% 75%, hsl(${(Math.abs(hash)+140)%360}, 45%, 10%) 0%, transparent 50%)`;
    },
    renderSheetLayout() {
        const body = document.getElementById('sheetBodyContent'); if (!body) return;
        document.getElementById('tabSearch').classList.toggle('selected', store.sheetTab === 'search');
        document.getElementById('tabLibrary').classList.toggle('selected', store.sheetTab === 'library');
        this.resetWipeBtn();
        if (store.sheetTab === 'search') {
            const kw = localStorage.getItem('CM_LAST_SEARCH_KEYWORD') || "";
            const sourceOptions = store.allowedSources.map(src => `<option value="${src}">${SOURCE_DISPLAY_MAP[src] || src}</option>`).join('');
            body.innerHTML = `
                <div class="config-hub-panel"><div class="search-engine-box"><select class="custom-select-ui" id="platform">${sourceOptions}</select>
                <input type="text" id="keyword" placeholder="搜歌曲、歌手..." value="${kw}" onkeydown="if(event.key==='Enter') AppStore.triggerNewSearch()">
                <button class="icon-btn" onclick="AppStore.triggerNewSearch()">${SYSTEM_SVG_ICONS.search}</button></div></div>
                <div class="batch-action-bar" id="batchBar" style="display:none;"><span style="font-size:12px; color:var(--text-muted);" id="checkedCountDisplay">已选择 0 项</span><button class="batch-btn" onclick="AppStore.batchAddSelected()">批量追加</button></div>
                <ul class="scroll-container" id="searchResultList"></ul><div class="load-more-container" id="loadMoreBox" style="display:none;"><button class="load-more-btn" onclick="AppStore.executeCloudSearch()">加载更多</button></div>
            `;
            if (store.searchResult.length > 0) { this.renderTrackNodes(store.searchResult, true, 'searchResultList'); if(store.hasMore) document.getElementById('loadMoreBox').style.display = 'block'; this.syncCheckboxCounter(); }
        } else {
            body.innerHTML = `
                <div class="config-hub-panel" style="flex-direction:row; justify-content:space-between; align-items:center; padding: 12px 14px;">
                    <div style="font-weight:700; font-size:13px; color:var(--text-muted);">列表数: ${store.playlist.length}</div>
                    ${store.playlist.length > 0 ? `
                    <button class="icon-btn danger-action" id="clearBtn" onclick="AppStore.clearPlaylist()" title="清空列表">
                        <svg viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>` : ''}
                </div><ul class="scroll-container" id="localTrackList"></ul>`;
            this.renderTrackNodes(store.playlist, false, 'localTrackList');
        }
    },
    triggerNewSearch() {
        const kw = document.getElementById('keyword')?.value.trim() || "";
        if(!kw) {
            localStorage.removeItem('CM_LAST_SEARCH_KEYWORD'); store.searchResult = []; store.hasMore = false; store.searchPage = 1;
            document.getElementById('searchResultList')&&(document.getElementById('searchResultList').innerHTML='');
            document.getElementById('batchBar')&&(document.getElementById('batchBar').style.display='none');
            document.getElementById('loadMoreBox')&&(document.getElementById('loadMoreBox').style.display='none');
            this.syncCheckboxCounter(); return;
        }
        store.searchResult = []; store.searchPage = 1; store.hasMore = false; this.executeCloudSearch();
    },
    async executeCloudSearch() {
        const kw = document.getElementById('keyword').value.trim(), pf = document.getElementById('platform').value, ul = document.getElementById('searchResultList');
        if(!kw) return; localStorage.setItem('CM_LAST_SEARCH_KEYWORD', kw);
        if(store.searchPage === 1) ul.innerHTML = '<div style="text-align:center; padding:30px 0; font-size:13px; color:var(--text-muted);">搜索中...</div>';
        else this.toggleLoadMoreButtonLoading(true);
        try {
            const res = await fetch(`${API_BASE}?types=search&count=10&pages=${store.searchPage}&source=${pf}&name=${encodeURIComponent(kw)}`);
            const data = await res.json(); const verifiedTracks = Array.isArray(data) ? data : [];
            verifiedTracks.forEach(t => t.checked = false); store.searchResult.push(...verifiedTracks);
            store.hasMore = verifiedTracks.length >= 10; store.searchPage += 1;
            this.renderTrackNodes(store.searchResult, true, 'searchResultList'); this.syncCheckboxCounter();
            document.getElementById('loadMoreBox').style.display = store.hasMore ? 'block' : 'none';
        } catch(e) { if(store.searchPage === 1) ul.innerHTML = '<div style="text-align:center; padding:30px 0; color:var(--cm-red);">检索失败</div>'; } finally { this.toggleLoadMoreButtonLoading(false); }
    },
    toggleLoadMoreButtonLoading(load) { const b = document.querySelector('.load-more-btn'); if(b) { b.innerText = load ? "加载中..." : "加载更多"; b.disabled = load; } },
    renderTrackNodes(list, isSearch, targetId) {
        const box = document.getElementById(targetId);
        if(!box) return;

        box.innerHTML = '';

        if (list.length === 0) {
            box.innerHTML = '<div style="text-align:center; padding:30px 0; font-size:13px; color:var(--text-muted);">空空如也</div>';
            return;
        }

        if (isSearch && document.getElementById('batchBar')) {
            document.getElementById('batchBar').style.display = 'flex';
        }

        list.forEach((track, i) => {
            const li = document.createElement('li');
            li.className = 'music-item-node';

            // ⭐⭐⭐ 核心：判断当前播放歌曲
            const isCurrent =
                store.currentTrack &&
                track.id === store.currentTrack.id &&
                !isSearch;

            if (isCurrent) {
                li.classList.add('playing');
                // 延迟居中，等 DOM 渲染完
                setTimeout(() => {
                    li.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                    });
                }, 80);
            }

            let artist = track.artist
                ? (Array.isArray(track.artist) ? track.artist.join(', ') : track.artist)
                : '未知';

            li.innerHTML = isSearch ? `
                <input type="checkbox" class="track-checkbox" id="cb-${i}"
                    ${track.checked ? 'checked' : ''}
                    onchange="AppStore.handleCheckboxChangeEvent(${i}, this.checked)">

                <div class="node-left" onclick="AppStore.toggleRowCheckbox(${i})">
                    <div class="node-cover-wrapper">${APPLE_MUSIC_ICON}</div>
                    <div class="node-info">
                        <div class="node-title">${track.name}</div>
                        <div class="node-artist">${artist}</div>
                    </div>
                </div>

                <div class="node-actions-cluster">
                    <button class="icon-btn" onclick="AppStore.playTrackBySearchResultIndex(${i})">
                        ${SYSTEM_SVG_ICONS.play}
                    </button>
                    <button class="icon-btn" onclick="AppStore.mutateTrackNode(event, ${i}, true)">
                        ${SYSTEM_SVG_ICONS.add}
                    </button>
                </div>
            ` : `
                <div class="node-left" onclick="AppStore.playTrackByLocalIndex(${i})">
                    <div class="node-cover-wrapper">${APPLE_MUSIC_ICON}</div>
                    <div class="node-info">
                        <div class="node-title">${track.name}</div>
                        <div class="node-artist">${artist}</div>
                    </div>
                </div>

                <div class="node-actions-cluster">
                    <button class="icon-btn danger-action"
                        onclick="AppStore.mutateTrackNode(event, ${i}, false)">
                        ${SYSTEM_SVG_ICONS.delete}
                    </button>
                </div>
            `;

            box.appendChild(li);
        });
    },
    handleCheckboxChangeEvent(i, chk) { if (store.searchResult[i]) store.searchResult[i].checked = chk; this.syncCheckboxCounter(); },
    toggleRowCheckbox(i) { const cb = document.getElementById(`cb-${i}`); if(cb) { cb.checked = !cb.checked; this.handleCheckboxChangeEvent(i, cb.checked); } },
    syncCheckboxCounter() { const tot = store.searchResult.filter(t => t.checked).length; const d = document.getElementById('checkedCountDisplay'); if(d) d.innerText = `已选择 ${tot} 项`; },
    batchAddSelected() {
        const sel = store.searchResult.filter(t => t.checked); if(sel.length === 0) return;
        let count = 0, localList = [...store.playlist], pf = document.getElementById('platform').value;
        sel.forEach(t => { if (!localList.some(s => s.id === t.id)) { t.platformSource = pf; localList.push(t); count++; } });
        store.searchResult.forEach(t => t.checked = false); store.playlist = localList; this.savePlaylistToServer();
        this.renderTrackNodes(store.searchResult, true, 'searchResultList'); this.syncCheckboxCounter();
        this.toast('批量导入', `成功追加 ${count} 首`);
    },
    mutateTrackNode(e, i, isSearch) {
        e.stopPropagation(); let localList = [...store.playlist];
        if(isSearch) {
            const track = store.searchResult[i]; if(localList.some(s => s.id === track.id)) return;
            track.platformSource = document.getElementById('platform').value; localList.push(track);
            store.playlist = localList; this.savePlaylistToServer(); this.toast('已保存', '已添加');
        } else {
            localList.splice(i, 1); if (store.currentTrackIndex === i) { store.currentTrackIndex = -1; store.currentTrack = null; } else if (store.currentTrackIndex > i) store.currentTrackIndex--;
            store.playlist = localList; this.savePlaylistToServer();
        }
    },
    clearPlaylist() {
        if (store.playlist.length === 0) return;
        const clearBtn = document.getElementById('clearBtn');
        if (!this.wipeConfirm) { 
            this.wipeConfirm = true; 
            if (clearBtn) clearBtn.classList.add('confirm-state'); 
            if (this.wipeTimer) clearTimeout(this.wipeTimer);
            this.wipeTimer = setTimeout(() => this.resetWipeBtn(), 3000); 
        } else { 
            if (this.wipeTimer) clearTimeout(this.wipeTimer);
            this.resetWipeBtn();
            store.playlist = []; store.currentTrackIndex = -1; store.currentTrack = null; 
            this.savePlaylistToServer(); this.renderSheetLayout(); 
            this.toast('清理成功', '列表已清空');
        }
    },
    resetWipeBtn() { 
        this.wipeConfirm = false; 
        const clearBtn = document.getElementById('clearBtn');
        if (clearBtn) clearBtn.classList.remove('confirm-state'); 
    },
    togglePlayMode() { const ms = ['list', 'random', 'single']; store.playMode = ms[(ms.indexOf(store.playMode) + 1) % ms.length]; },
    togglePlayback() { 
        if (!store.currentTrack) { if (store.playlist.length > 0) { store.lastDirection = 'next'; this.playTrackByIndex(0, store.playlist, false); } return; } 
        this.audio.paused ? this.audio.play() : this.audio.pause(); 
    },
    handleScrubberInteraction(e) {
        if (!store.currentTrack) return;
        const rect = document.getElementById('scrubberTrack').getBoundingClientRect();
        if(this.audio.duration) this.audio.currentTime = ((e.clientX - rect.left) / rect.width) * this.audio.duration;
    },
    
    playTrackBySearchResultIndex(i) { store.lastDirection = 'next'; this.playTrackByIndex(i, store.searchResult, true, false, true); },
    playTrackByLocalIndex(i) { store.lastDirection = i >= store.currentTrackIndex ? 'next' : 'prev'; this.playTrackByIndex(i, store.playlist, true, false, false); },
    
    async playTrackByIndex(i, listGroup, closeSht = false, forcePause = false, isPreview = false) {
        const targetTrack = listGroup[i]; if(!targetTrack) return;
        
        let pf = targetTrack.platformSource || (document.getElementById('platform')?.value || 'netease');
        
        try {
            const [urlRes, lrcRes] = await Promise.all([
                fetch(`${API_BASE}?types=url&id=${targetTrack.id}&source=${pf}&level=${store.quality}`),
                fetch(`${API_BASE}?types=lyric&id=${targetTrack.lyric_id || targetTrack.id}&source=${pf}`)
            ]);
            
            const uData = await urlRes.json();
            
            if (!uData || !uData.url) {
                this.toast('载入失败', '版权或音质不可用');
                return;
            }
            
            store.isPlaying = false; 
            this.audio.src = uData.url; 
            
            if (isPreview) {
                store.currentTrackIndex = -1;
            } else {
                if (listGroup === store.playlist) {
                    store.currentTrackIndex = i;
                } else {
                    let idx = store.playlist.findIndex(s => s.id === targetTrack.id);
                    if(idx === -1) { 
                        targetTrack.platformSource = pf; 
                        const ul = [...store.playlist, targetTrack]; 
                        store.playlist = ul; 
                        this.savePlaylistToServer(); 
                        store.currentTrackIndex = ul.length - 1; 
                    } else {
                        store.currentTrackIndex = idx;
                    }
                }
            }

            store.currentTrack = targetTrack;

            // ⭐强制触发列表更新（关键）
            if (store.sheetTab === 'library' || store.sheetTab === 'search') {
                this.renderSheetLayout();
            }
            if(closeSht) this.closeSheet();

            store.parsedLyrics = []; this.lastLyricIdx = -1;
            const lData = await lrcRes.json();
            let rawLrc = lData.lyric || lData.lrc?.lyric;
            if(rawLrc) {
                const lines = rawLrc.split('\n'), regex = /\[(\d+):(\d+)\.(\d+)\]/;
                store.parsedLyrics = lines.map(l => { const m = regex.exec(l); if(m) return { time: parseInt(m[1])*60 + parseInt(m[2]) + parseInt(m[3])/1000, text: l.replace(regex, '').trim() }; return null; }).filter(v => v && v.text);
            }
            
            const lyricsBlock = this.domCache.lyricsBlock || document.getElementById('lyricsBlock');
            if (lyricsBlock) {
                lyricsBlock.innerHTML = store.parsedLyrics.length > 0 ? store.parsedLyrics.map((v, k) => `<p class="lyric-line" id="lrc-${k}">${v.text}</p>`).join('') : '<p class="lyric-line current" style="margin-top:150px;">无歌词</p>';
            }
            
            if (forcePause) { 
                this.audio.autoplay = false; 
                this.audio.load(); 
                store.isPlaying = false; 
            } else { 
                this.audio.autoplay = true; 
                this.audio.play(); 
            }

        } catch(e) { 
            console.error(e);
            this.toast('链路阻断', '网络异常或接口失效');
        }
    },
    autoRouteNext(type) {
        if (store.playlist.length === 0) return;
        let currentIndex = store.currentTrackIndex === -1 ? 0 : store.currentTrackIndex;
        
        if (store.playMode === 'single' && type === 'ended') { store.lastDirection = 'next'; this.playTrackByIndex(currentIndex, store.playlist, false); return; }
        if (store.playMode === 'random') { store.lastDirection = 'next'; this.playTrackByIndex(Math.floor(Math.random() * store.playlist.length), store.playlist, false); return; }
        let step = (type === 'prev') ? -1 : 1, targetIdx = currentIndex + (store.currentTrackIndex === -1 ? 0 : step);
        if (targetIdx >= store.playlist.length) targetIdx = 0; if (targetIdx < 0) targetIdx = store.playlist.length - 1;
        store.lastDirection = (type === 'prev') ? 'prev' : 'next'; this.playTrackByIndex(targetIdx, store.playlist, false);
    },
    skipTrack(dir) { this.autoRouteNext(dir === -1 ? 'prev' : 'next'); },
    
    // 【已优化】：利用内存高速缓存与 120ms 动作节流重构时间监听引擎
    bindAudioListeners() {
        let lastUpdateTime = 0;

        this.audio.ontimeupdate = () => {
            if(!this.audio.duration) return;
            const cur = this.audio.currentTime, dur = this.audio.duration;
            
            // 1. 进度条与数字时间控制节流（120ms 刷新周期），大幅释放单线程运算损耗
            const now = Date.now();
            if (now - lastUpdateTime > 120) {
                const pct = (cur / dur) * 100;
                if (this.domCache.scrubberFill) this.domCache.scrubberFill.style.width = pct + '%'; 
                if (this.domCache.scrubberHandle) this.domCache.scrubberHandle.style.left = pct + '%';
                if (this.domCache.timeCurrent) this.domCache.timeCurrent.innerText = this.formatTime(cur); 
                if (this.domCache.timeDuration) this.domCache.timeDuration.innerText = "-" + this.formatTime(dur - cur);
                lastUpdateTime = now;
            }

            // 2. 歌词流向位移优化：使用预缓存节点
            if(store.parsedLyrics.length > 0) {
                let active = store.parsedLyrics.findIndex((v, i, arr) => cur >= v.time && (i === arr.length - 1 || cur < arr[i+1].time));
                if (active !== -1 && active !== this.lastLyricIdx) {
                    const oldLine = document.getElementById(`lrc-${this.lastLyricIdx}`); if(oldLine) oldLine.classList.remove('current');
                    const newLine = document.getElementById(`lrc-${active}`);
                    if(newLine) {
                        newLine.classList.add('current');
                        const lyricView = this.domCache.lyricView || document.getElementById('lyricView');
                        const lyricsBlock = this.domCache.lyricsBlock || document.getElementById('lyricsBlock');
                        const vh = lyricView ? lyricView.clientHeight : 400;
                        if (lyricsBlock) {
                            lyricsBlock.style.transform = `translateY(${- (newLine.offsetTop - (vh / 2) + 16)}px)`;
                        }
                    }
                    this.lastLyricIdx = active;
                }
            }
        };
        this.audio.onended = () => { store.isPlaying = false; this.autoRouteNext('ended'); };
        this.audio.onplay = () => { store.isPlaying = true; }; 
        this.audio.onpause = () => { store.isPlaying = false; };
    },
    formatTime(sec) { if(isNaN(sec)) return "0:00"; const m = Math.floor(sec/60), s = Math.floor(sec%60); return `${m}:${s < 10 ? '0' : ''}${s}`; }
};
window.addEventListener('DOMContentLoaded', () => AppStore.startup());
