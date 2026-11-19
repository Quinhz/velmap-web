// ==========================================
// 11. CONFIGURAÇÕES, PERFIL, CROP DE PFP E ARMAZENAMENTO
// ==========================================
const PROFILE_STORAGE_KEY = 'velmap_user_profile';
const LEGACY_PROFILE_KEY = 'velnote_user_profile';
let userProfile = { name: 'Workspace', color: '#4f6b8a', avatar: null, updatedAt: 0 };
let pendingClearAction = null;

// Estado do Crop de PFP
let pfpCropState = {
    img: null,
    zoom: 1,
    minScale: 1,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    startX: 0,
    startY: 0
};

function getInitials(name) {
    const cleaned = (name || '').trim();
    if (!cleaned) return 'U';
    const parts = cleaned.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function normalizeHexColor(color) {
    if (typeof color !== 'string') return '#4f6b8a';
    const trimmed = color.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
        return '#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
    }
    return '#4f6b8a';
}

function getContrastTextColor(hex) {
    const c = normalizeHexColor(hex);
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.65 ? '#141416' : '#ffffff';
}

function loadUserProfile() {
    try {
        let raw = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (!raw) {
            const legacy = localStorage.getItem(LEGACY_PROFILE_KEY);
            if (legacy) {
                localStorage.setItem(PROFILE_STORAGE_KEY, legacy);
                raw = legacy;
            }
        }
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                userProfile.name = parsed.name || 'Workspace';
                userProfile.color = normalizeHexColor(parsed.color || '#4f6b8a');
                userProfile.avatar = parsed.avatar || null;
                userProfile.updatedAt = parsed.updatedAt || 0;
            }
        }
    } catch (e) {
        console.warn('Could not read profile:', e);
    }
    syncProfileUI();
}

function renderAvatarElement(el, initials, ringBg = '#18181b') {
    if (!el) return;
    const bgColor = normalizeHexColor(userProfile.color);
    el.style.setProperty('background-color', bgColor, 'important');
    el.style.setProperty('color', getContrastTextColor(bgColor), 'important');
    if (ringBg) {
        el.style.setProperty('box-shadow', `0 0 0 2px ${ringBg}, 0 0 0 3.5px ${bgColor}`, 'important');
    } else {
        el.style.setProperty('box-shadow', `0 0 0 1.5px ${bgColor}`, 'important');
    }
    if (userProfile.avatar) {
        el.innerHTML = `<img src="${userProfile.avatar}" class="w-full h-full object-cover rounded-full pointer-events-none" alt="">`;
    } else {
        el.innerHTML = '';
        el.textContent = initials;
    }
}

function syncOnboardingPrefsWidgets() {
    const toggleBtn = document.getElementById('onboard-unsorted-toggle');
    if (toggleBtn) {
        toggleBtn.className = `w-9 h-5 rounded-full transition-colors p-0.5 flex items-center ${isSidebarOpen ? 'bg-emerald-500/80 justify-end' : 'bg-white/10 justify-start'}`;
    }
}

async function dismissOnboardingPrefsCard(cardId) {
    const card = await dbGet('cards', cardId);
    if (!card) return;
    card.isTrash = true;
    await dbPut('cards', card);
    selectedCardIds.delete(cardId);
    await fetchAndRenderCards();
    await updateTrashBadge();
}

function syncProfileUI() {
    const initials = getInitials(userProfile.name);
    const displayName = (userProfile.name || '').trim() || 'Workspace';
    const activeColor = normalizeHexColor(userProfile.color);

    const headerName = document.getElementById('header-user-name');
    const headerAvatar = document.getElementById('header-user-avatar');
    const headerBtn = document.getElementById('header-profile-btn');
    if (headerName) headerName.textContent = displayName;
    renderAvatarElement(headerAvatar, initials, null);
    if (headerBtn) headerBtn.style.borderColor = `${activeColor}88`;

    const homeName = document.getElementById('home-user-name');
    const homeAvatar = document.getElementById('home-user-avatar');
    const homeCard = document.getElementById('home-profile-card');
    if (homeName) homeName.textContent = displayName;
    renderAvatarElement(homeAvatar, initials, '#1c1c20');
    if (homeCard) homeCard.style.borderColor = `${activeColor}66`;

    const previewAvatar = document.getElementById('settings-avatar-preview');
    const nameInput = document.getElementById('settings-user-name-input');
    renderAvatarElement(previewAvatar, initials, '#18181b');
    if (nameInput && document.activeElement !== nameInput) {
        nameInput.value = userProfile.name;
    }

    const onboardAvatar = document.getElementById('onboard-avatar-preview');
    const onboardNameInput = document.getElementById('onboard-name-input');
    const onboardHex = document.getElementById('onboard-color-hex');
    renderAvatarElement(onboardAvatar, initials, '#202024');
    if (onboardNameInput && document.activeElement !== onboardNameInput) {
        onboardNameInput.value = userProfile.name;
    }
    if (onboardHex) onboardHex.textContent = activeColor;

    const customColorInp = document.getElementById('settings-custom-color-input');
    const customColorLbl = document.getElementById('settings-custom-color-label');
    const onboardCustomInp = document.getElementById('onboard-custom-color-input');
    const onboardCustomLbl = document.getElementById('onboard-custom-color-label');
    if (customColorInp) customColorInp.value = activeColor;
    if (onboardCustomInp) onboardCustomInp.value = activeColor;

    const removeBtn = document.getElementById('btn-remove-pfp');
    if (removeBtn) {
        if (userProfile.avatar) removeBtn.classList.remove('hidden');
        else removeBtn.classList.add('hidden');
    }

    const settingsPresets = new Set();
    document.querySelectorAll('#settings-color-options button').forEach(btn => {
        const c = normalizeHexColor(btn.dataset.color || '');
        settingsPresets.add(c);
        if (c === activeColor) {
            btn.classList.add('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-[#18181b]');
        } else {
            btn.classList.remove('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-[#18181b]');
        }
    });
    if (customColorLbl) {
        const isCustom = !settingsPresets.has(activeColor);
        customColorLbl.style.backgroundColor = isCustom ? activeColor : '#27272a';
        customColorLbl.classList.toggle('ring-2', isCustom);
        customColorLbl.classList.toggle('ring-white', isCustom);
        customColorLbl.classList.toggle('ring-offset-2', isCustom);
        customColorLbl.classList.toggle('ring-offset-[#18181b]', isCustom);
    }

    const onboardPresets = new Set();
    document.querySelectorAll('#onboard-color-options .onboard-color-swatch').forEach(btn => {
        const c = normalizeHexColor(btn.dataset.color || '');
        onboardPresets.add(c);
        if (c === activeColor) {
            btn.classList.add('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-[#202024]');
        } else {
            btn.classList.remove('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-[#202024]');
        }
    });
    if (onboardCustomLbl) {
        const isOnboardCustom = !onboardPresets.has(activeColor);
        onboardCustomLbl.style.backgroundColor = isOnboardCustom ? activeColor : '#27272a';
        onboardCustomLbl.classList.toggle('ring-2', isOnboardCustom);
        onboardCustomLbl.classList.toggle('ring-white', isOnboardCustom);
        onboardCustomLbl.classList.toggle('ring-offset-2', isOnboardCustom);
        onboardCustomLbl.classList.toggle('ring-offset-[#202024]', isOnboardCustom);
    }
}

function saveUserProfile(skipTouch = false) {
    if (!skipTouch) {
        userProfile.updatedAt = Date.now();
    }
    userProfile.color = normalizeHexColor(userProfile.color);
    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(userProfile));
    } catch (e) {
        console.warn('Could not save profile:', e);
        showToast(t('quotaExceededPfp'));
    }
    syncProfileUI();
    if (!skipTouch) scheduleSyncMutation();
}

function setProfileName(name) {
    userProfile.name = typeof name === 'string' ? name : 'Workspace';
    saveUserProfile(false);
}

function setProfileColor(color) {
    userProfile.color = normalizeHexColor(color);
    saveUserProfile(false);
}

function triggerPfpUpload() {
    document.getElementById('pfp-file-input')?.click();
}

function removeUserPfp() {
    userProfile.avatar = null;
    saveUserProfile();
    renderSettingsStorage();
    showToast(t('pfpRemoved'));
}

function handlePfpFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => openPfpCropModal(img);
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

function openPfpCropModal(img) {
    const stageSize = 260;
    const apertureSize = 220;
    pfpCropState.img = img;
    pfpCropState.minScale = Math.max(apertureSize / img.width, apertureSize / img.height);
    pfpCropState.zoom = 1;
    pfpCropState.offsetX = 0;
    pfpCropState.offsetY = 0;
    pfpCropState.isDragging = false;

    const slider = document.getElementById('pfp-crop-zoom');
    if (slider) slider.value = '1';
    document.getElementById('pfp-crop-modal').classList.remove('hidden');
    renderPfpCropCanvas();
}

function closePfpCropModal() {
    pfpCropState.img = null;
    pfpCropState.isDragging = false;
    document.getElementById('pfp-crop-modal')?.classList.add('hidden');
}

function clampPfpOffsets() {
    if (!pfpCropState.img) return;
    const apertureRadius = 110;
    const scale = pfpCropState.minScale * pfpCropState.zoom;
    const halfW = (pfpCropState.img.width * scale) / 2;
    const halfH = (pfpCropState.img.height * scale) / 2;
    const maxOffsetX = Math.max(0, halfW - apertureRadius);
    const maxOffsetY = Math.max(0, halfH - apertureRadius);
    pfpCropState.offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, pfpCropState.offsetX));
    pfpCropState.offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, pfpCropState.offsetY));
}

function renderPfpCropCanvas() {
    const canvas = document.getElementById('pfp-crop-canvas');
    if (!canvas || !pfpCropState.img) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#111113';
    ctx.fillRect(0, 0, size, size);

    clampPfpOffsets();
    const scale = pfpCropState.minScale * pfpCropState.zoom;
    const drawW = pfpCropState.img.width * scale;
    const drawH = pfpCropState.img.height * scale;
    const drawX = (size - drawW) / 2 + pfpCropState.offsetX;
    const drawY = (size - drawH) / 2 + pfpCropState.offsetY;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pfpCropState.img, drawX, drawY, drawW, drawH);
}

function onPfpCropZoomChange(val) {
    pfpCropState.zoom = parseFloat(val) || 1;
    renderPfpCropCanvas();
}

function resetPfpCrop() {
    pfpCropState.zoom = 1;
    pfpCropState.offsetX = 0;
    pfpCropState.offsetY = 0;
    const slider = document.getElementById('pfp-crop-zoom');
    if (slider) slider.value = '1';
    renderPfpCropCanvas();
}

function applyPfpCrop() {
    if (!pfpCropState.img) return;
    const outSize = 256;
    const apertureSize = 220;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outSize;
    outCanvas.height = outSize;
    const ctx = outCanvas.getContext('2d');

    const scale = pfpCropState.minScale * pfpCropState.zoom;
    const ratio = outSize / apertureSize;
    const drawW = pfpCropState.img.width * scale * ratio;
    const drawH = pfpCropState.img.height * scale * ratio;
    const drawX = (outSize - drawW) / 2 + pfpCropState.offsetX * ratio;
    const drawY = (outSize - drawH) / 2 + pfpCropState.offsetY * ratio;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pfpCropState.img, drawX, drawY, drawW, drawH);

    userProfile.avatar = outCanvas.toDataURL('image/webp', 0.88);
    saveUserProfile();
    closePfpCropModal();
    renderSettingsStorage();
    showToast(t('pfpUpdated'));
}

document.addEventListener('DOMContentLoaded', () => {
    const stage = document.getElementById('pfp-crop-stage');
    if (!stage) return;
    stage.addEventListener('pointerdown', (e) => {
        if (!pfpCropState.img) return;
        pfpCropState.isDragging = true;
        pfpCropState.startX = e.clientX - pfpCropState.offsetX;
        pfpCropState.startY = e.clientY - pfpCropState.offsetY;
        stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
        if (!pfpCropState.isDragging) return;
        pfpCropState.offsetX = e.clientX - pfpCropState.startX;
        pfpCropState.offsetY = e.clientY - pfpCropState.startY;
        renderPfpCropCanvas();
    });
    const endDrag = () => { pfpCropState.isDragging = false; };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('wheel', (e) => {
        if (!pfpCropState.img) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        pfpCropState.zoom = Math.min(3, Math.max(1, pfpCropState.zoom + delta));
        const slider = document.getElementById('pfp-crop-zoom');
        if (slider) slider.value = String(pfpCropState.zoom);
        renderPfpCropCanvas();
    }, { passive: false });
});

async function openSettingsModal() {
    if (typeof closeMobileSheets === 'function') closeMobileSheets();
    pendingClearAction = null;
    document.getElementById('clear-confirm-bar')?.classList.add('hidden');
    syncProfileUI();
    syncSoundsUI();
    document.getElementById('settings-modal').classList.remove('hidden');
    await renderSettingsStorage();
}

function closeSettingsModal() {
    pendingClearAction = null;
    document.getElementById('clear-confirm-bar')?.classList.add('hidden');
    document.getElementById('settings-modal').classList.add('hidden');
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const val = bytes / Math.pow(1024, idx);
    return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

async function renderSettingsStorage() {
    const [allBoards, allCards, allAssets, allConns] = await Promise.all([
        dbGetAll('boards'),
        dbGetAll('cards'),
        dbGetAll('assets'),
        dbGetAll('connections')
    ]);

    const jsonSize = (obj) => new Blob([JSON.stringify(obj)]).size;
    const assetBytes = allAssets.reduce((sum, a) => sum + (a?.blob?.size || 0), 0);
    const cardsBytes = jsonSize(allCards);
    const boardsBytes = jsonSize(allBoards);
    const connsBytes = jsonSize(allConns);
    const profileBytes = new Blob([localStorage.getItem(PROFILE_STORAGE_KEY) || '']).size;
    const totalAppBytes = assetBytes + cardsBytes + boardsBytes + connsBytes + profileBytes;

    const activeCards = allCards.filter(c => !c.isTrash);
    const trashCards = allCards.filter(c => c.isTrash);
    const unsortedCards = activeCards.filter(c => c.boardId === 'unsorted');

    const notes = activeCards.filter(c => c.type === 'sticky');
    const taskCards = activeCards.filter(c => c.type === 'task');
    const totalTasks = taskCards.reduce((sum, c) => sum + (c.tasks ? c.tasks.length : 0), 0);
    const docs = activeCards.filter(c => c.type === 'document');
    const links = activeCards.filter(c => c.type === 'link');
    const videosAndEmbeds = activeCards.filter(c => c.type === 'video' || c.type === 'embed');
    const images = activeCards.filter(c => c.type === 'image');
    const subboards = activeCards.filter(c => c.type === 'subboard');

    document.getElementById('storage-total-label').textContent = formatBytes(totalAppBytes);
    document.getElementById('storage-items-summary').textContent =
        t('storageSummary', { cards: activeCards.length, boards: allBoards.length, assets: allAssets.length });

    const quotaEl = document.getElementById('storage-quota-label');
    if (navigator.storage && navigator.storage.estimate) {
        try {
            const est = await navigator.storage.estimate();
            if (est && est.quota) {
                const pct = ((est.usage || totalAppBytes) / est.quota) * 100;
                quotaEl.textContent = t('ofQuota', { pct: pct < 0.1 ? '<0.1' : pct.toFixed(1), quota: formatBytes(est.quota) });
            }
        } catch (_) {
            quotaEl.textContent = t('localIndexedDb');
        }
    } else {
        quotaEl.textContent = t('localIndexedDb');
    }

    // Segmented progress bar
    const bar = document.getElementById('storage-progress-bar');
    const denom = Math.max(totalAppBytes, 1);
    const segments = [
        { bytes: assetBytes, color: 'bg-[#4f6b8a]' },
        { bytes: cardsBytes, color: 'bg-[#4f8a5f]' },
        { bytes: boardsBytes + connsBytes, color: 'bg-[#8a7d4f]' }
    ];
    bar.innerHTML = totalAppBytes === 0
        ? ''
        : segments.map(s => `<div class="${s.color} h-full transition-all" style="width:${Math.max(s.bytes > 0 ? 3 : 0, (s.bytes / denom) * 100)}%"></div>`).join('');

    const rows = [
        { label: t('rowBoards'), count: t('rowBoardsCount', { boards: allBoards.length, nested: subboards.length }), size: formatBytes(boardsBytes) },
        { label: t('rowNotes'), count: t('rowCardsCount', { n: notes.length }), size: formatBytes(jsonSize(notes)) },
        { label: t('rowTodos'), count: t('rowTodosCount', { lists: taskCards.length, tasks: totalTasks }), size: formatBytes(jsonSize(taskCards)) },
        { label: t('rowDocs'), count: t('rowDocsCount', { n: docs.length }), size: formatBytes(jsonSize(docs)) },
        { label: t('rowLinks'), count: t('rowLinksCount', { n: links.length }), size: formatBytes(jsonSize(links)) },
        { label: t('rowVideosEmbeds'), count: t('rowItemsCount', { n: videosAndEmbeds.length }), size: formatBytes(jsonSize(videosAndEmbeds)) },
        { label: t('rowImages'), count: t('rowImagesCount', { cards: images.length, blobs: allAssets.length }), size: formatBytes(assetBytes + jsonSize(images)) },
        { label: t('rowConnections'), count: t('rowLinesCount', { n: allConns.length }), size: formatBytes(connsBytes) },
        { label: t('rowUnsorted'), count: t('rowItemsCount', { n: unsortedCards.length }), size: formatBytes(jsonSize(unsortedCards)) },
        { label: t('rowTrash'), count: t('rowItemsCount', { n: trashCards.length }), size: formatBytes(jsonSize(trashCards)) },
        { label: t('rowProfile'), count: userProfile.avatar ? t('customPhoto') : t('initialsLabel'), size: formatBytes(profileBytes) }
    ];

    document.getElementById('storage-breakdown-list').innerHTML = rows.map(r => `
        <div class="py-2 flex items-center justify-between">
            <span class="text-zinc-300">${r.label}</span>
            <div class="flex items-center space-x-3 text-[11px]">
                <span class="text-zinc-500">${r.count}</span>
                <span class="text-zinc-300 font-medium w-14 text-right">${r.size}</span>
            </div>
        </div>
    `).join('');

    document.getElementById('clear-trash-subtitle').textContent = t('clearTrashSubtitle', { n: trashCards.length });
    document.getElementById('clear-unsorted-subtitle').textContent = t('clearUnsortedSubtitle', { n: unsortedCards.length });
}

function requestClearAction(action) {
    pendingClearAction = action;
    const bar = document.getElementById('clear-confirm-bar');
    const text = document.getElementById('clear-confirm-text');
    if (action === 'trash') text.textContent = t('confirmClearTrash');
    else if (action === 'unsorted') text.textContent = t('confirmClearUnsorted');
    else text.textContent = t('confirmClearAll');
    bar.classList.remove('hidden');
}

function cancelClearAction() {
    pendingClearAction = null;
    document.getElementById('clear-confirm-bar').classList.add('hidden');
}

async function executeClearAction() {
    const action = pendingClearAction;
    cancelClearAction();
    if (action === 'trash') {
        await emptyTrash();
        await pruneOrphanAssets();
        showToast(t('trashEmptied'));
    } else if (action === 'unsorted') {
        await clearUnsortedData();
        showToast(t('unsortedCleared'));
    } else if (action === 'all') {
        await clearAllAppData();
        showToast(t('allDataCleared'));
    }
    await renderSettingsStorage();
}

async function pruneOrphanAssets() {
    const [allCards, allAssets] = await Promise.all([dbGetAll('cards'), dbGetAll('assets')]);
    const usedAssetIds = new Set();
    for (const c of allCards) {
        if (c.assetId) usedAssetIds.add(c.assetId);
        if (c.iconAssetId) usedAssetIds.add(c.iconAssetId);
    }
    for (const asset of allAssets) {
        if (!usedAssetIds.has(asset.id)) {
            await dbDelete('assets', asset.id);
            if (blobUrlCache.has(asset.id)) {
                URL.revokeObjectURL(blobUrlCache.get(asset.id));
                blobUrlCache.delete(asset.id);
            }
        }
    }
}

async function clearUnsortedData() {
    const allCards = await dbGetAll('cards');
    for (const c of allCards) {
        if (c.boardId === 'unsorted' && !c.isTrash) {
            await dbDelete('cards', c.id);
        }
    }
    selectedUnsortedCardIds.clear();
    await pruneOrphanAssets();
    await fetchAndRenderCards();
    await renderUnsortedDrawer();
}

async function clearAllAppData() {
    const [allBoards, allCards, allAssets, allConns] = await Promise.all([
        dbGetAll('boards'),
        dbGetAll('cards'),
        dbGetAll('assets'),
        dbGetAll('connections')
    ]);
    for (const b of allBoards) await dbDelete('boards', b.id);
    for (const c of allCards) await dbDelete('cards', c.id);
    for (const a of allAssets) await dbDelete('assets', a.id);
    for (const cn of allConns) await dbDelete('connections', cn.id);

    for (const url of blobUrlCache.values()) {
        URL.revokeObjectURL(url);
    }
    blobUrlCache.clear();

    selectedCardIds.clear();
    selectedUnsortedCardIds.clear();
    selectedConnectionId = null;
    breadcrumbs = [{ id: 'root', title: 'Home' }];
    currentBoardId = 'root';
    uiViewports = {};
    localStorage.removeItem(TOMBSTONE_STORAGE_KEY);
    localStorage.removeItem(UI_STATE_STORAGE_KEY);
    await dbPut('boards', { id: 'root', title: 'Home', isArea: true, createdAt: Date.now() }, true);
    resetZoom();
    centerCanvasInitial();
    await loadBoard('root', { resetViewport: true });
    if (isHomeViewOpen) await renderHomeView();
}

