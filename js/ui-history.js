// ==========================================
// 3. INICIALIZAÇÃO E PERSISTÊNCIA DE UI
// ==========================================
const UI_STATE_STORAGE_KEY = 'velmap_ui_state';
const SOUNDS_STORAGE_KEY = 'velmap_sounds_enabled_v1';
const ONBOARDING_STORAGE_KEY = 'velmap_onboarded_v1';
let isHomeViewOpen = false;
let hasExplicitSidebarPref = false;
let uiViewports = {};
let uiStateSaveTimer = null;
let _lastPopstateHandledAt = 0;

function getNavSnapshotSignature(entry) {
    const bcIds = Array.isArray(entry.breadcrumbs) ? entry.breadcrumbs.map(b => b.id).join('>') : entry.boardId;
    return `${entry.boardId}|${bcIds}|${entry.homeOpen ? '1' : '0'}`;
}

function updateNavHistoryButtons() {
    const backBtn = document.getElementById('nav-back-btn');
    const fwdBtn = document.getElementById('nav-forward-btn');
    if (backBtn) backBtn.disabled = navHistoryIndex <= 0;
    if (fwdBtn) fwdBtn.disabled = navHistoryIndex >= navHistory.length - 1;
}

function recordNavHistoryEntry(boardId, bcList, homeOpen, options = {}) {
    if (isNavigatingHistory) return;
    const entry = {
        boardId: boardId || 'root',
        breadcrumbs: Array.isArray(bcList) ? structuredClone(bcList) : [{ id: boardId || 'root', title: 'Home' }],
        homeOpen: !!homeOpen
    };
    const sig = getNavSnapshotSignature(entry);
    const cur = navHistory[navHistoryIndex];
    if (cur && getNavSnapshotSignature(cur) === sig) {
        updateNavHistoryButtons();
        return;
    }
    if (navHistoryIndex < navHistory.length - 1) {
        navHistory = navHistory.slice(0, navHistoryIndex + 1);
    }
    navHistory.push(entry);
    if (navHistory.length > 60) navHistory.shift();
    navHistoryIndex = navHistory.length - 1;
    try {
        const stateObj = { velmapNavIdx: navHistoryIndex };
        if (options.replace) window.history.replaceState(stateObj, '');
        else window.history.pushState(stateObj, '');
    } catch (_) {}
    updateNavHistoryButtons();
}

async function applyNavHistoryEntry(entry) {
    if (!entry) return;
    isNavigatingHistory = true;
    try {
        breadcrumbs = Array.isArray(entry.breadcrumbs) && entry.breadcrumbs.length > 0
            ? structuredClone(entry.breadcrumbs)
            : [{ id: entry.boardId || 'root', title: 'Home' }];

        let targetId = entry.boardId || 'root';
        const bExists = await dbGet('boards', targetId);
        const cExists = bExists ? null : await dbGet('cards', targetId);
        if (!bExists && (!cExists || cExists.isTrash)) {
            targetId = 'root';
            breadcrumbs = [{ id: 'root', title: 'Home' }];
        }

        if (entry.homeOpen) {
            if (targetId !== currentBoardId) {
                await loadBoard(targetId, { restoreViewport: true, skipSaveUI: true, skipHistory: true });
            }
            await openHomeView(true);
        } else {
            if (isHomeViewOpen) closeHomeView(true, { skipHistory: true });
            await loadBoard(targetId, { restoreViewport: true, skipHistory: true });
        }
        saveUIState();
        updateNavHistoryButtons();
    } finally {
        isNavigatingHistory = false;
    }
}

async function navigateHistoryStep(delta) {
    const nextIdx = navHistoryIndex + delta;
    if (nextIdx < 0 || nextIdx >= navHistory.length) return;
    const beforeStamp = _lastPopstateHandledAt;
    navHistoryIndex = nextIdx;
    updateNavHistoryButtons();
    try {
        if (delta === -1) window.history.back();
        else window.history.forward();
    } catch (_) {}
    setTimeout(() => {
        if (_lastPopstateHandledAt === beforeStamp) {
            applyNavHistoryEntry(navHistory[nextIdx]);
        }
    }, 60);
}

function navigateHistoryBack() {
    navigateHistoryStep(-1);
}

function navigateHistoryForward() {
    navigateHistoryStep(1);
}

window.addEventListener('popstate', (e) => {
    const idx = e?.state?.velmapNavIdx;
    if (typeof idx === 'number' && navHistory[idx]) {
        _lastPopstateHandledAt = Date.now();
        navHistoryIndex = idx;
        applyNavHistoryEntry(navHistory[idx]);
    }
});

window.addEventListener('mouseup', (e) => {
    if (e.button === 3) {
        e.preventDefault();
        navigateHistoryBack();
    } else if (e.button === 4) {
        e.preventDefault();
        navigateHistoryForward();
    }
});

function loadSoundsEnabled() {
    try {
        const raw = localStorage.getItem(SOUNDS_STORAGE_KEY);
        if (raw === null) return true;
        return raw !== 'false';
    } catch (_) {
        return true;
    }
}

let soundsEnabled = loadSoundsEnabled();
let cozyAudioCtx = null;

function getCozyAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!cozyAudioCtx) cozyAudioCtx = new Ctx();
    if (cozyAudioCtx.state === 'suspended') {
        cozyAudioCtx.resume().catch(() => {});
    }
    return cozyAudioCtx;
}

function playCozyTone(ctx, startOffset, freqStart, freqEnd, duration, peakGain, wave = 'sine') {
    const now = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = wave;
    osc.frequency.setValueAtTime(freqStart, now);
    if (freqEnd && freqEnd !== freqStart) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);
    }

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
}

function playCozySound(kind) {
    if (!soundsEnabled) return;
    try {
        const ctx = getCozyAudioContext();
        if (!ctx) return;
        if (kind === 'check') {
            playCozyTone(ctx, 0, 523.25, 587.33, 0.07, 0.045, 'sine');
            playCozyTone(ctx, 0.042, 659.25, 659.25, 0.12, 0.042, 'triangle');
        } else if (kind === 'uncheck') {
            playCozyTone(ctx, 0, 523.25, 392.0, 0.08, 0.032, 'sine');
        } else if (kind === 'allTasksDone') {
            playCozyTone(ctx, 0, 523.25, 523.25, 0.14, 0.045, 'sine');
            playCozyTone(ctx, 0.065, 659.25, 659.25, 0.16, 0.045, 'sine');
            playCozyTone(ctx, 0.13, 783.99, 783.99, 0.18, 0.048, 'sine');
            playCozyTone(ctx, 0.195, 987.77, 1046.5, 0.34, 0.052, 'triangle');
        } else if (kind === 'boardDrop') {
            playCozyTone(ctx, 0, 293.66, 440.0, 0.12, 0.055, 'sine');
            playCozyTone(ctx, 0.045, 587.33, 659.25, 0.18, 0.038, 'triangle');
        } else if (kind === 'tabDrop') {
            playCozyTone(ctx, 0, 392.0, 523.25, 0.11, 0.05, 'sine');
            playCozyTone(ctx, 0.05, 659.25, 783.99, 0.16, 0.038, 'sine');
        } else if (kind === 'unsorted') {
            playCozyTone(ctx, 0, 349.23, 440.0, 0.1, 0.045, 'sine');
            playCozyTone(ctx, 0.04, 523.25, 523.25, 0.13, 0.034, 'triangle');
        } else if (kind === 'trash') {
            playCozyTone(ctx, 0, 220.0, 125.0, 0.13, 0.045, 'sine');
        } else if (kind === 'restore' || kind === 'pop') {
            playCozyTone(ctx, 0, 392.0, 587.33, 0.12, 0.042, 'sine');
        } else if (kind === 'toggleOn') {
            playCozyTone(ctx, 0, 440.0, 587.33, 0.1, 0.045, 'sine');
            playCozyTone(ctx, 0.055, 659.25, 783.99, 0.16, 0.04, 'triangle');
        }
    } catch (_) {}
}

function syncSoundsUI() {
    const toggle = document.getElementById('settings-sounds-toggle');
    if (toggle) toggle.checked = !!soundsEnabled;
}

function setSoundsEnabled(enabled) {
    soundsEnabled = !!enabled;
    try {
        localStorage.setItem(SOUNDS_STORAGE_KEY, soundsEnabled ? 'true' : 'false');
    } catch (_) {}
    saveUIState();
    syncSoundsUI();
    if (soundsEnabled) playCozySound('toggleOn');
}

function loadUIState() {
    try {
        const raw = localStorage.getItem(UI_STATE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
    return null;
}

function saveUIState() {
    if (!currentBoardId) return;
    uiViewports[currentBoardId] = {
        scale: Number.isFinite(canvasScale) ? canvasScale : 1,
        panX: Number.isFinite(canvasPanX) ? canvasPanX : 0,
        panY: Number.isFinite(canvasPanY) ? canvasPanY : 0
    };
    try {
        localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({
            unsortedOpen: !!isSidebarOpen,
            currentBoardId,
            breadcrumbs: Array.isArray(breadcrumbs) ? breadcrumbs : [{ id: 'root', title: 'Home' }],
            homeOpen: !!isHomeViewOpen,
            soundsEnabled: !!soundsEnabled,
            viewports: uiViewports
        }));
    } catch (_) {}
}

function scheduleSaveUIState() {
    clearTimeout(uiStateSaveTimer);
    uiStateSaveTimer = setTimeout(saveUIState, 160);
}

function applySidebarDomState() {
    const s = document.getElementById('right-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const mobileUnsortedBtn = document.getElementById('mobile-nav-unsorted');
    if (!s) return;
    if (isSidebarOpen) {
        if (window.innerWidth < 768) {
            closeMobileSheets();
        }
        s.classList.remove('hidden');
        if (backdrop && window.innerWidth < 768) backdrop.classList.remove('hidden');
        if (mobileUnsortedBtn) {
            mobileUnsortedBtn.classList.add('text-white', 'bg-white/[0.1]');
            mobileUnsortedBtn.classList.remove('text-zinc-400');
        }
    } else {
        s.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
        if (mobileUnsortedBtn) {
            mobileUnsortedBtn.classList.remove('text-white', 'bg-white/[0.1]');
            mobileUnsortedBtn.classList.add('text-zinc-400');
        }
    }
}

function syncMobileBottomNavActiveStates() {
    const toolsSheet = document.getElementById('mobile-tools-sheet');
    const moreSheet = document.getElementById('mobile-more-sheet');
    const addBtn = document.getElementById('mobile-nav-add');
    const moreBtn = document.getElementById('mobile-nav-more');
    const toolsOpen = Boolean(toolsSheet && !toolsSheet.classList.contains('hidden'));
    const moreOpen = Boolean(moreSheet && !moreSheet.classList.contains('hidden'));
    if (addBtn) {
        addBtn.classList.toggle('bg-white/[0.12]', toolsOpen);
        addBtn.classList.toggle('text-white', toolsOpen);
    }
    if (moreBtn) {
        moreBtn.classList.toggle('bg-white/[0.12]', moreOpen);
        moreBtn.classList.toggle('text-white', moreOpen);
        moreBtn.classList.toggle('text-zinc-400', !moreOpen);
    }
}

function closeMobileSheets(except = null) {
    const toolsSheet = document.getElementById('mobile-tools-sheet');
    const moreSheet = document.getElementById('mobile-more-sheet');
    const backdrop = document.getElementById('mobile-sheet-backdrop');
    if (except !== 'tools' && toolsSheet) toolsSheet.classList.add('hidden');
    if (except !== 'more' && moreSheet) moreSheet.classList.add('hidden');
    const anyOpen = (toolsSheet && !toolsSheet.classList.contains('hidden')) || (moreSheet && !moreSheet.classList.contains('hidden'));
    if (backdrop) backdrop.classList.toggle('hidden', !anyOpen);
    syncMobileBottomNavActiveStates();
}

function toggleMobileToolsSheet() {
    const sheet = document.getElementById('mobile-tools-sheet');
    const backdrop = document.getElementById('mobile-sheet-backdrop');
    if (!sheet) return;
    const willOpen = sheet.classList.contains('hidden');
    if (willOpen) {
        if (window.innerWidth < 768 && isSidebarOpen) {
            isSidebarOpen = false;
            applySidebarDomState();
        }
        if (typeof closeExportPopover === 'function') closeExportPopover();
        closeBoardBgPopover();
        closeMobileSheets('tools');
        sheet.classList.remove('hidden');
        if (backdrop) backdrop.classList.remove('hidden');
    } else {
        sheet.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
    }
    syncMobileBottomNavActiveStates();
}

function toggleMobileMoreSheet() {
    const sheet = document.getElementById('mobile-more-sheet');
    const backdrop = document.getElementById('mobile-sheet-backdrop');
    if (!sheet) return;
    const willOpen = sheet.classList.contains('hidden');
    if (willOpen) {
        if (window.innerWidth < 768 && isSidebarOpen) {
            isSidebarOpen = false;
            applySidebarDomState();
        }
        if (typeof closeExportPopover === 'function') closeExportPopover();
        closeBoardBgPopover();
        closeMobileSheets('more');
        const mzl = document.getElementById('mobile-zoom-level');
        if (mzl) mzl.textContent = Math.round(canvasScale * 100) + '%';
        sheet.classList.remove('hidden');
        if (backdrop) backdrop.classList.remove('hidden');
    } else {
        sheet.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
    }
    syncMobileBottomNavActiveStates();
}

function toggleMobileSearchBar(forceState = null) {
    const bar = document.getElementById('mobile-search-bar');
    const btn = document.getElementById('mobile-search-btn');
    const inp = document.getElementById('mobile-search-input');
    if (!bar) return;
    const isCurrentlyOpen = !bar.classList.contains('hidden');
    const nextOpen = typeof forceState === 'boolean' ? forceState : !isCurrentlyOpen;
    if (nextOpen) {
        closeMobileSheets();
        bar.classList.remove('hidden');
        bar.classList.add('flex');
        if (btn) btn.classList.add('bg-white/[0.12]', 'text-white', 'border-white/20');
        if (inp) {
            inp.value = searchQuery || '';
            setTimeout(() => inp.focus(), 40);
        }
    } else {
        bar.classList.add('hidden');
        bar.classList.remove('flex');
        if (btn) btn.classList.remove('bg-white/[0.12]', 'text-white', 'border-white/20');
    }
}

function clearMobileSearch() {
    searchQuery = '';
    const deskInp = document.getElementById('search-input');
    const mobInp = document.getElementById('mobile-search-input');
    const clearBtn = document.getElementById('mobile-search-clear-btn');
    const dot = document.getElementById('mobile-search-active-dot');
    if (deskInp) deskInp.value = '';
    if (mobInp) {
        mobInp.value = '';
        mobInp.focus();
    }
    if (clearBtn) clearBtn.classList.add('hidden');
    if (dot) dot.classList.add('hidden');
    fetchAndRenderCards();
}

async function createCardFromMobileSheet(type) {
    closeMobileSheets();
    if (isHomeViewOpen && typeof closeHomeView === 'function') closeHomeView(true, { skipHistory: true });
    if (type === 'line') {
        setTool('line');
        showToast(t('lineToolHint'));
        return;
    }
    if (type === 'image') {
        triggerImageUpload();
        return;
    }
    const vp = document.getElementById('canvas-viewport');
    const dims = typeof getToolPreviewDimensions === 'function' ? getToolPreviewDimensions(type) : { w: 270, h: 170 };
    const x = vp ? (-canvasPanX + vp.clientWidth / 2) / canvasScale - (dims.w / 2) : 120;
    const y = vp ? (-canvasPanY + vp.clientHeight / 2) / canvasScale - (dims.h / 2) : 120;
    await createCardAt(type, x, y);
    showToast(t('addedCard', { type: getLocalizedCardLabel(type) }));
}

async function refreshUntouchedStarterCardsLanguage() {
    if (!db) return;
    try {
        const allCards = await dbGetAll('cards');
        for (const c of allCards) {
            if (!c.starterRole) continue;
            if (c.starterRole === 'prefs') {
                c.title = t('onboardPrefsTitle');
                await dbPut('cards', c, true);
            } else if (c.starterRole === 'welcome') {
                c.title = t('onboardWelcomeTitle');
                c.content = t('onboardWelcomeText');
                await dbPut('cards', c, true);
            } else if (c.starterRole === 'tasks') {
                c.title = t('onboardTasksTitle');
                if (Array.isArray(c.tasks) && c.tasks.length === 4) {
                    c.tasks[0].text = t('onboardTask1');
                    c.tasks[1].text = t('onboardTask2');
                    c.tasks[2].text = t('onboardTask3');
                    c.tasks[3].text = t('onboardTask4');
                }
                await dbPut('cards', c, true);
            } else if (c.starterRole === 'column') {
                c.title = t('onboardColumnTitle');
                c.content = '';
                await dbPut('cards', c, true);
            } else if (c.starterRole === 'column_note') {
                c.content = t('onboardColumnText');
                await dbPut('cards', c, true);
            } else if (c.starterRole === 'doc') {
                c.title = t('onboardDocTitle');
                c.content = t('onboardDocHtml');
                await dbPut('cards', c, true);
            } else if (c.starterRole === 'subboard') {
                c.title = t('onboardBoardTitle');
                await dbPut('cards', c, true);
                const sb = await dbGet('boards', c.id);
                if (sb) { sb.title = t('onboardBoardTitle'); await dbPut('boards', sb, true); }
            } else if (c.starterRole === 'sub_note') {
                c.title = t('onboardSubNoteTitle');
                c.content = t('onboardSubNoteText');
                await dbPut('cards', c, true);
            } else if (c.starterRole === 'sub_todo') {
                c.title = t('onboardSubTodoTitle');
                if (Array.isArray(c.tasks) && c.tasks.length === 2) {
                    c.tasks[0].text = t('onboardSubTodo1');
                    c.tasks[1].text = t('onboardSubTodo2');
                }
                await dbPut('cards', c, true);
            }
        }
    } catch (_) {}
}

async function seedFirstRunExperience() {
    const now = Date.now();
    const prefsId = 'card_onboard_prefs_' + now;
    const subBoardId = 'card_onboard_board_' + now;
    const noteId = 'card_onboard_note_' + now;
    const taskId = 'card_onboard_tasks_' + now;
    const docId = 'card_onboard_doc_' + now;
    const colId = 'card_onboard_col_' + now;

    await dbPut('boards', { id: subBoardId, title: t('onboardBoardTitle'), parentId: 'root', createdAt: now }, true);

    const starterCards = [
        {
            id: prefsId,
            boardId: 'root',
            type: 'onboarding_prefs',
            starterRole: 'prefs',
            title: t('onboardPrefsTitle'),
            content: '',
            x: 90,
            y: 95,
            width: 320,
            height: 360,
            zIndex: 16,
            isTrash: false,
            createdAt: now
        },
        {
            id: noteId,
            boardId: 'root',
            type: 'sticky',
            starterRole: 'welcome',
            title: t('onboardWelcomeTitle'),
            content: t('onboardWelcomeText'),
            x: 455,
            y: 95,
            width: 275,
            height: 180,
            zIndex: 11,
            isTrash: false,
            createdAt: now + 1
        },
        {
            id: taskId,
            boardId: 'root',
            type: 'task',
            starterRole: 'tasks',
            title: t('onboardTasksTitle'),
            content: '',
            tasks: [
                { text: t('onboardTask1'), completed: true },
                { text: t('onboardTask2'), completed: false },
                { text: t('onboardTask3'), completed: false },
                { text: t('onboardTask4'), completed: false }
            ],
            x: 775,
            y: 95,
            width: 280,
            height: 185,
            zIndex: 12,
            isTrash: false,
            createdAt: now + 2
        },
        {
            id: colId,
            boardId: 'root',
            type: 'column',
            starterRole: 'column',
            title: t('onboardColumnTitle'),
            content: '',
            x: 455,
            y: 315,
            width: 265,
            height: 175,
            zIndex: 13,
            isTrash: false,
            createdAt: now + 3
        },
        {
            id: 'card_onboard_col_note_' + now,
            boardId: 'root',
            columnId: colId,
            columnOrder: 0,
            type: 'sticky',
            starterRole: 'column_note',
            title: t('labelNote'),
            content: t('onboardColumnText'),
            x: 455,
            y: 360,
            width: 245,
            height: 120,
            zIndex: 14,
            isTrash: false,
            createdAt: now + 3.5
        },
        {
            id: docId,
            boardId: 'root',
            type: 'document',
            starterRole: 'doc',
            title: t('onboardDocTitle'),
            content: t('onboardDocHtml'),
            x: 775,
            y: 325,
            width: 96,
            height: null,
            zIndex: 14,
            isTrash: false,
            createdAt: now + 4
        },
        {
            id: subBoardId,
            boardId: 'root',
            type: 'subboard',
            starterRole: 'subboard',
            title: t('onboardBoardTitle'),
            color: '#4f6b8a',
            icon: BOARD_ICONS[10],
            x: 920,
            y: 320,
            width: 140,
            height: 140,
            zIndex: 15,
            isTrash: false,
            createdAt: now + 5
        },
        {
            id: 'card_onboard_sub_note_' + now,
            boardId: subBoardId,
            type: 'sticky',
            starterRole: 'sub_note',
            title: t('onboardSubNoteTitle'),
            content: t('onboardSubNoteText'),
            x: 160,
            y: 140,
            width: 270,
            height: 170,
            zIndex: 11,
            isTrash: false,
            createdAt: now + 6
        },
        {
            id: 'card_onboard_sub_todo_' + now,
            boardId: subBoardId,
            type: 'task',
            starterRole: 'sub_todo',
            title: t('onboardSubTodoTitle'),
            tasks: [
                { text: t('onboardSubTodo1'), completed: false },
                { text: t('onboardSubTodo2'), completed: false }
            ],
            x: 475,
            y: 140,
            width: 270,
            height: 170,
            zIndex: 12,
            isTrash: false,
            createdAt: now + 7
        }
    ];

    for (const c of starterCards) {
        await dbPut('cards', c, true);
    }

    await dbPut('connections', {
        id: 'conn_onboard_0_' + now,
        fromId: prefsId,
        toId: noteId,
        fromAnchor: { side: 'right', t: 0.25 },
        toAnchor: { side: 'left', t: 0.5 },
        color: '#71717a',
        weight: 2,
        isDashed: true,
        startMarker: 'none',
        endMarker: 'arrow'
    }, true);

    await dbPut('connections', {
        id: 'conn_onboard_1_' + now,
        fromId: noteId,
        toId: taskId,
        fromAnchor: { side: 'right', t: 0.45 },
        toAnchor: { side: 'left', t: 0.45 },
        color: '#71717a',
        weight: 2,
        isDashed: true,
        startMarker: 'none',
        endMarker: 'arrow'
    }, true);

    await dbPut('connections', {
        id: 'conn_onboard_2_' + now,
        fromId: taskId,
        toId: subBoardId,
        fromAnchor: { side: 'bottom', t: 0.72 },
        toAnchor: { side: 'top', t: 0.5 },
        color: '#71717a',
        weight: 2,
        isDashed: false,
        startMarker: 'none',
        endMarker: 'arrow'
    }, true);
}

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const savedUI = loadUIState();
        if (savedUI) {
            if (typeof savedUI.unsortedOpen === 'boolean') {
                isSidebarOpen = window.innerWidth >= 768 ? savedUI.unsortedOpen : false;
                hasExplicitSidebarPref = true;
            }
            if (savedUI.viewports && typeof savedUI.viewports === 'object') {
                uiViewports = savedUI.viewports;
            }
            if (localStorage.getItem(SOUNDS_STORAGE_KEY) === null && typeof savedUI.soundsEnabled === 'boolean') {
                soundsEnabled = savedUI.soundsEnabled;
                localStorage.setItem(SOUNDS_STORAGE_KEY, soundsEnabled ? 'true' : 'false');
            }
        }
        applySidebarDomState();
        applyTranslations();
        syncFaviconLogos();
        syncSoundsUI();
        loadUserProfile();
        setTool('select');
        await initDB();
        const rootBoard = await dbGet('boards', 'root');
        if (!rootBoard) {
            await dbPut('boards', { id: 'root', title: 'Home', isArea: true, createdAt: Date.now() }, true);
        }

        const existingCards = await dbGetAll('cards');
        if (!localStorage.getItem(ONBOARDING_STORAGE_KEY)) {
            if (existingCards.length === 0) {
                await seedFirstRunExperience();
            }
            localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
        }

        let targetBoardId = 'root';
        if (savedUI && savedUI.currentBoardId) {
            const savedBoard = await dbGet('boards', savedUI.currentBoardId);
            const savedSubCard = savedBoard ? null : await dbGet('cards', savedUI.currentBoardId);
            if (savedBoard || (savedSubCard && savedSubCard.type === 'subboard' && !savedSubCard.isTrash)) {
                if (!savedBoard && savedSubCard) {
                    await dbPut('boards', { id: savedSubCard.id, title: savedSubCard.title || t('newBoardTitle'), parentId: savedSubCard.boardId || 'root', createdAt: Date.now() }, true);
                }
                targetBoardId = savedUI.currentBoardId;
                if (Array.isArray(savedUI.breadcrumbs) && savedUI.breadcrumbs.length > 0 && savedUI.breadcrumbs[savedUI.breadcrumbs.length - 1]?.id === targetBoardId) {
                    breadcrumbs = savedUI.breadcrumbs;
                } else {
                    const b = savedBoard || savedSubCard;
                    breadcrumbs = [{ id: targetBoardId, title: b?.title || 'Home' }];
                }
            }
        }

        await loadBoard(targetBoardId, { restoreViewport: true, skipSaveUI: true, skipHistory: true });
        if (!uiViewports[targetBoardId]) {
            centerCanvasInitial();
        }

        setupCanvasInteractions();
        setupKeyboardShortcuts();
        setupClipboardAndDragDrop();
        setupTrashInteractions();
        setupUnsortedDropInteractions();
        setupContextMenu();
        setupSearch();

        const canvasContentEl = document.getElementById('canvas-content');
        if (canvasContentEl) {
            canvasContentEl.addEventListener('mousedown', (e) => {
                const cardEl = e.target.closest?.('.interactive-card');
                if (!cardEl) return;
                if (e.target.matches('input:not([type="checkbox"]):not([type="color"]):not(.pointer-events-none), textarea:not(.pointer-events-none), [contenteditable="true"]:not(.pointer-events-none)')) {
                    enterCardEditMode(cardEl);
                }
            }, true);
            canvasContentEl.addEventListener('focusin', (e) => {
                const cardEl = e.target.closest?.('.interactive-card');
                if (!cardEl) return;
                if (e.target.matches('input:not([type="checkbox"]):not([type="color"]), textarea, [contenteditable="true"]')) {
                    enterCardEditMode(cardEl);
                }
            });
            canvasContentEl.addEventListener('focusout', (e) => {
                const cardEl = e.target.closest?.('.interactive-card');
                if (!cardEl) return;
                const cid = cardEl.dataset.id;
                setTimeout(() => {
                    if (!cardEl.isConnected) return;
                    const activeEl = document.activeElement;
                    const activeCard = activeEl?.closest?.('.interactive-card');
                    if (!activeCard || activeCard.dataset.id !== cid) {
                        exitCardEditMode(cid);
                    }
                }, 0);
            });
        }

        if (typeof initDeviceSyncSubsystem === 'function') {
            await initDeviceSyncSubsystem();
        }

        if (savedUI && savedUI.homeOpen) {
            await openHomeView(true);
            recordNavHistoryEntry(targetBoardId, breadcrumbs, true, { replace: true });
        } else {
            saveUIState();
            recordNavHistoryEntry(targetBoardId, breadcrumbs, false, { replace: true });
        }
    } catch (error) {
        console.error('Initialization failed:', error);
        showToast(t('dbInitError'));
    }
});

function centerCanvasInitial() {
    const viewport = document.getElementById('canvas-viewport');
    if (!viewport) return;
    const targetCenterX = viewport.clientWidth < 768 ? 250 : 480;
    const targetCenterY = viewport.clientHeight < 768 ? 275 : 290;
    canvasPanX = Math.round((viewport.clientWidth / 2) - targetCenterX);
    canvasPanY = Math.round((viewport.clientHeight / 2) - targetCenterY);
    updateCanvasTransform();
    scheduleSaveUIState();
}

// ==========================================
// 3.9 HISTÓRICO (UNDO / REDO), CLIPBOARD E FUNDO DO QUADRO
// ==========================================
async function captureWorkspaceSnapshot() {
    const [allBoards, allCards, allConns] = await Promise.all([
        dbGetAll('boards'),
        dbGetAll('cards'),
        dbGetAll('connections')
    ]);
    return {
        boards: structuredClone(allBoards),
        cards: structuredClone(allCards),
        connections: structuredClone(allConns),
        boardId: currentBoardId
    };
}

async function pushUndoSnapshot(preCaptured = null) {
    if (isApplyingHistory) return;
    const snap = preCaptured || await captureWorkspaceSnapshot();
    undoStack.push(snap);
    if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift();
    redoStack = [];
}

async function applyWorkspaceSnapshot(snap) {
    if (!snap) return;
    isApplyingHistory = true;
    try {
        const replaceStore = async (storeName, nextItems) => {
            const existing = await dbGetAll(storeName);
            const nextIds = new Set(nextItems.map(i => i.id));
            for (const oldItem of existing) {
                if (!nextIds.has(oldItem.id)) {
                    await dbDelete(storeName, oldItem.id, true);
                }
            }
            for (const item of nextItems) {
                await dbPut(storeName, structuredClone(item), true);
            }
        };
        await replaceStore('boards', snap.boards || []);
        await replaceStore('cards', snap.cards || []);
        await replaceStore('connections', snap.connections || []);

        const targetBoardExists = (snap.boards || []).some(b => b.id === snap.boardId);
        const nextBoardId = targetBoardExists ? snap.boardId : (snap.boards || []).some(b => b.id === currentBoardId) ? currentBoardId : 'root';
        selectedCardIds.clear();
        selectedConnectionId = null;
        if (nextBoardId !== currentBoardId) {
            await loadBoard(nextBoardId, { restoreViewport: true, skipSaveUI: true });
        } else {
            const board = await dbGet('boards', currentBoardId);
            applyBoardBackground(board);
            renderBreadcrumbs();
            await fetchAndRenderCards();
            await updateTrashBadge();
        }
        syncSelectionVisuals();
        scheduleSyncMutation();
    } finally {
        isApplyingHistory = false;
    }
}

async function undoAction() {
    if (typeof flushArrowNudgeCommit === 'function') await flushArrowNudgeCommit();
    document.getElementById('context-menu').style.display = 'none';
    if (undoStack.length === 0) {
        showToast(t('nothingToUndo'));
        return;
    }
    const currentSnap = await captureWorkspaceSnapshot();
    const targetSnap = undoStack.pop();
    redoStack.push(currentSnap);
    await applyWorkspaceSnapshot(targetSnap);
    showToast(t('undoneToast'));
}

async function redoAction() {
    document.getElementById('context-menu').style.display = 'none';
    if (redoStack.length === 0) {
        showToast(t('nothingToRedo'));
        return;
    }
    const currentSnap = await captureWorkspaceSnapshot();
    const targetSnap = redoStack.pop();
    undoStack.push(currentSnap);
    await applyWorkspaceSnapshot(targetSnap);
    showToast(t('redoneToast'));
}

async function buildClipboardPayloadForSelection() {
    const ids = Array.from(selectedCardIds);
    if (ids.length === 0) return null;
    const allCardsNow = await dbGetAll('cards');
    const allConnsNow = await dbGetAll('connections');
    const idSet = new Set(ids);
    allCardsNow.forEach(c => {
        if (!c.isTrash && c.columnId && idSet.has(c.columnId)) {
            idSet.add(c.id);
        }
    });
    const copiedCards = allCardsNow.filter(c => idSet.has(c.id) && !c.isTrash).map(c => structuredClone(c));
    if (copiedCards.length === 0) return null;
    const copiedConns = allConnsNow
        .filter(cn => idSet.has(cn.fromId) && idSet.has(cn.toId))
        .map(cn => structuredClone(cn));
    return { cards: copiedCards, connections: copiedConns };
}

async function cloneCardsAndConnectionsToBoard(sourceCards, sourceConnections, targetBoardId, offsetX = 28, offsetY = 28) {
    if (!Array.isArray(sourceCards) || sourceCards.length === 0) return [];
    const idMap = new Map();
    const now = Date.now();
    for (let i = 0; i < sourceCards.length; i++) {
        const orig = sourceCards[i];
        const prefix = orig.type === 'subboard' ? 'sub_' : 'card_';
        const newId = prefix + (now + i) + '_' + Math.random().toString(36).substring(2, 7);
        idMap.set(orig.id, newId);
    }

    let nextZ = getNextTopZIndex();
    const createdTopIds = [];

    for (let i = 0; i < sourceCards.length; i++) {
        const orig = sourceCards[i];
        const newId = idMap.get(orig.id);
        const clone = structuredClone(orig);
        clone.id = newId;
        clone.boardId = targetBoardId;
        if (orig.columnId && idMap.has(orig.columnId)) {
            clone.columnId = idMap.get(orig.columnId);
        } else {
            clone.columnId = null;
            clone.columnOrder = null;
        }
        clone.x = Math.round((orig.x || 0) + offsetX);
        clone.y = Math.round((orig.y || 0) + offsetY);
        clone.zIndex = nextZ++;
        clone.isTrash = false;
        clone.deletedAt = null;
        clone.createdAt = now + i;
        await dbPut('cards', clone);

        if (clone.type === 'subboard') {
            await dbPut('boards', {
                id: newId,
                title: clone.title || t('newBoardTitle'),
                parentId: targetBoardId,
                createdAt: now + i
            });
        }
        if (!clone.columnId) {
            createdTopIds.push(newId);
        }
    }

    if (Array.isArray(sourceConnections)) {
        for (let j = 0; j < sourceConnections.length; j++) {
            const cn = sourceConnections[j];
            const mappedFrom = idMap.get(cn.fromId);
            const mappedTo = idMap.get(cn.toId);
            if (mappedFrom && mappedTo) {
                const connClone = structuredClone(cn);
                connClone.id = 'conn_' + (now + j) + '_' + Math.random().toString(36).substring(2, 6);
                connClone.fromId = mappedFrom;
                connClone.toId = mappedTo;
                await dbPut('connections', connClone);
            }
        }
    }

    selectedCardIds.clear();
    createdTopIds.forEach(id => selectedCardIds.add(id));
    selectedConnectionId = null;
    await fetchAndRenderCards();
    syncSelectionVisuals();
    return createdTopIds;
}

async function writeClipboardMarker(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) {}
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return !!ok;
    } catch (_) {}
    return false;
}

async function copySelectedCards() {
    document.getElementById('context-menu').style.display = 'none';
    const payload = await buildClipboardPayloadForSelection();
    if (!payload) return false;
    const token = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const wroteSystem = await writeClipboardMarker(VELMAP_CLIPBOARD_PREFIX + token);
    velmapClipboard = {
        cards: payload.cards,
        connections: payload.connections,
        pasteCount: 0,
        token,
        wroteSystem
    };
    showToast(t('copiedToast', { n: payload.cards.length }));
    return true;
}

async function cutSelectedCards() {
    document.getElementById('context-menu').style.display = 'none';
    const payload = await buildClipboardPayloadForSelection();
    if (!payload) return false;
    await pushUndoSnapshot();
    const token = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const wroteSystem = await writeClipboardMarker(VELMAP_CLIPBOARD_PREFIX + token);
    velmapClipboard = {
        cards: payload.cards,
        connections: payload.connections,
        pasteCount: 0,
        token,
        wasCut: true,
        wroteSystem
    };
    for (const c of payload.cards) {
        const stored = await dbGet('cards', c.id);
        if (stored) {
            stored.isTrash = true;
            stored.deletedAt = Date.now();
            await dbPut('cards', stored);
        }
        selectedCardIds.delete(c.id);
    }
    await fetchAndRenderCards();
    await updateTrashBadge();
    syncSelectionVisuals();
    showToast(t('cutToast', { n: payload.cards.length }));
    return true;
}

async function pasteVelmapClipboard(targetX = null, targetY = null) {
    document.getElementById('context-menu').style.display = 'none';
    if (!velmapClipboard || !Array.isArray(velmapClipboard.cards) || velmapClipboard.cards.length === 0) return false;
    await pushUndoSnapshot();

    let anchorX = targetX;
    let anchorY = targetY;
    const vp = document.getElementById('canvas-viewport');

    if (typeof anchorX !== 'number' || typeof anchorY !== 'number') {
        if (vp) {
            const rect = vp.getBoundingClientRect();
            const hasValidMouse = (
                typeof lastMouseClientX === 'number' &&
                typeof lastMouseClientY === 'number' &&
                lastMouseClientX >= rect.left && lastMouseClientX <= rect.right &&
                lastMouseClientY >= rect.top && lastMouseClientY <= rect.bottom
            );
            if (hasValidMouse) {
                anchorX = (lastMouseClientX - rect.left - canvasPanX) / canvasScale;
                anchorY = (lastMouseClientY - rect.top - canvasPanY) / canvasScale;
            } else {
                anchorX = (-canvasPanX + vp.clientWidth / 2) / canvasScale;
                anchorY = (-canvasPanY + vp.clientHeight / 2) / canvasScale;
            }
        } else {
            anchorX = 240;
            anchorY = 200;
        }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    velmapClipboard.cards.forEach(c => {
        const cx = Number(c.x) || 0;
        const cy = Number(c.y) || 0;
        const cw = Number(c.width) || (c.type === 'subboard' ? 140 : c.type === 'document' ? 96 : 270);
        const ch = Number(c.height) || (c.type === 'subboard' ? 140 : c.type === 'document' ? 140 : 170);
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx + cw > maxX) maxX = cx + cw;
        if (cy + ch > maxY) maxY = cy + ch;
    });
    const groupCenterX = (minX + maxX) / 2;
    const groupCenterY = (minY + maxY) / 2;

    const spotKey = `${Math.round(anchorX / 8)},${Math.round(anchorY / 8)}`;
    if (lastPasteCursorKey === spotKey) {
        lastPasteSameSpotCount += 1;
    } else {
        lastPasteCursorKey = spotKey;
        lastPasteSameSpotCount = 0;
    }
    const cascade = 18 * lastPasteSameSpotCount;
    const offsetX = Math.round(anchorX - groupCenterX + cascade);
    const offsetY = Math.round(anchorY - groupCenterY + cascade);

    const created = await cloneCardsAndConnectionsToBoard(velmapClipboard.cards, velmapClipboard.connections, currentBoardId, offsetX, offsetY);
    if (created.length > 0) showToast(t('pastedToast', { n: created.length }));
    return created.length > 0;
}

async function duplicateSelectedCards() {
    document.getElementById('context-menu').style.display = 'none';
    const payload = await buildClipboardPayloadForSelection();
    if (!payload) return;
    await pushUndoSnapshot();
    const created = await cloneCardsAndConnectionsToBoard(payload.cards, payload.connections, currentBoardId, 24, 24);
    if (created.length > 0) showToast(t('duplicatedToast'));
}

function applyBoardBackground(board) {
    const viewport = document.getElementById('canvas-viewport');
    if (!viewport) return;
    const bgStyle = board?.bgStyle || { color: '#131316', pattern: 'dots' };
    const bgColor = normalizeHexColor(bgStyle.color || '#131316');
    const pattern = bgStyle.pattern || 'dots';
    viewport.classList.remove('dot-grid', 'fine-grid', 'solid-grid');
    if (pattern === 'grid') viewport.classList.add('fine-grid');
    else if (pattern === 'solid') viewport.classList.add('solid-grid');
    else viewport.classList.add('dot-grid');
    viewport.style.backgroundColor = bgColor;
}

function refreshBoardBgPopoverUI(bgStyle) {
    const color = normalizeHexColor(bgStyle?.color || '#131316');
    const pattern = bgStyle?.pattern || 'dots';
    const swatchesEl = document.getElementById('board-bg-swatches');
    if (swatchesEl) {
        swatchesEl.innerHTML = BOARD_BG_PRESETS.map(p => {
            const active = p.color === color;
            return `<button type="button" onclick="setBoardBgPreset('${p.color}', '${p.pattern}')" class="w-6 h-6 rounded-full border ${active ? 'border-white ring-2 ring-white/30 scale-110' : 'border-white/20'} hover:scale-110 transition-transform" style="background-color:${p.color}" title="${escapeHtml(p.label)}"></button>`;
        }).join('') + `
            <label class="relative w-6 h-6 rounded-full border border-white/25 overflow-hidden cursor-pointer hover:scale-110 transition-transform flex items-center justify-center bg-[#27272a]" title="Custom">
                <input type="color" value="${escapeHtml(color)}" oninput="setBoardBgColor(this.value)" onchange="setBoardBgColor(this.value)" class="opacity-0 absolute inset-0 w-full h-full cursor-pointer">
                <svg class="w-3 h-3 text-zinc-200 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </label>
        `;
    }
    document.querySelectorAll('#board-bg-patterns [data-bg-pattern]').forEach(btn => {
        const isActive = btn.dataset.bgPattern === pattern;
        btn.className = isActive
            ? 'px-2 py-1.5 rounded-lg text-[11px] font-medium border border-white/40 bg-white/15 text-white transition-colors'
            : 'px-2 py-1.5 rounded-lg text-[11px] font-medium border border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-zinc-200 transition-colors';
    });
}

async function openBoardBgPopover(anchorX, anchorY) {
    document.getElementById('context-menu').style.display = 'none';
    const pop = document.getElementById('board-bg-popover');
    if (!pop) return;
    const board = await dbGet('boards', currentBoardId);
    refreshBoardBgPopoverUI(board?.bgStyle || { color: '#131316', pattern: 'dots' });
    const x = Math.min(Math.max(12, anchorX ?? (window.innerWidth / 2 - 132)), Math.max(12, window.innerWidth - 276));
    const y = Math.min(Math.max(56, anchorY ?? (window.innerHeight / 2 - 110)), Math.max(56, window.innerHeight - 230));
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    pop.classList.remove('hidden');
}

function closeBoardBgPopover() {
    document.getElementById('board-bg-popover')?.classList.add('hidden');
}

async function updateCurrentBoardBgStyle(nextPartial) {
    let board = await dbGet('boards', currentBoardId);
    if (!board) {
        const subCard = await dbGet('cards', currentBoardId);
        board = { id: currentBoardId, title: subCard?.title || t('newBoardTitle'), parentId: subCard?.boardId || 'root', createdAt: Date.now() };
    }
    const prev = board.bgStyle || { color: '#131316', pattern: 'dots' };
    board.bgStyle = { ...prev, ...nextPartial };
    await dbPut('boards', board);
    applyBoardBackground(board);
    refreshBoardBgPopoverUI(board.bgStyle);
}

async function setBoardBgPreset(color, pattern) {
    await pushUndoSnapshot();
    await updateCurrentBoardBgStyle({ color, pattern });
}

async function setBoardBgColor(color) {
    await updateCurrentBoardBgStyle({ color: normalizeHexColor(color) });
}

async function setBoardBgPattern(pattern) {
    await pushUndoSnapshot();
    await updateCurrentBoardBgStyle({ pattern });
}

async function resetBoardBackground() {
    await pushUndoSnapshot();
    await updateCurrentBoardBgStyle({ color: '#131316', pattern: 'dots' });
    showToast(t('bgUpdatedToast'));
}

function openSelectedBoardMoreMenu(event) {
    event?.stopPropagation();
    const selectedId = Array.from(selectedCardIds)[0];
    if (!selectedId) return;
    const rect = event?.currentTarget?.getBoundingClientRect();
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    menu.innerHTML = `
        <div class="context-menu-item" onclick="openSubBoardById('${selectedId}')">${t('openBoardAction')}</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" onclick="duplicateSelectedCards()">${t('duplicate')} <kbd>Ctrl D</kbd></div>
        <div class="context-menu-item" onclick="moveSelectedToUnsorted()">${t('moveToUnsorted')}</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" onclick="bringSelectedToFront()">${t('bringToFront')}</div>
        <div class="context-menu-item" onclick="sendSelectedToBack()">${t('sendToBack')}</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item text-red-400" onclick="deleteSelectedCards()">${t('deleteCard')}</div>
    `;
    menu.style.display = 'block';
    const menuW = menu.offsetWidth || 200;
    const menuH = menu.offsetHeight || 220;
    const isBottomDock = rect && rect.top > window.innerHeight * 0.55;
    const rawX = rect ? (isBottomDock ? rect.left : rect.right + 10) : 80;
    const rawY = rect ? (isBottomDock ? rect.top - menuH - 10 : rect.top) : 240;
    const clampedX = Math.min(Math.max(8, rawX), Math.max(8, window.innerWidth - menuW - 8));
    const clampedY = Math.min(Math.max(8, rawY), Math.max(8, window.innerHeight - menuH - 8));
    menu.style.left = `${clampedX}px`;
    menu.style.top = `${clampedY}px`;
}

async function openSubBoardById(boardId) {
    document.getElementById('context-menu').style.display = 'none';
    const c = cards.find(cd => cd.id === boardId) || await dbGet('cards', boardId);
    await openSubBoard(boardId, c?.title || t('newBoardTitle'));
}

