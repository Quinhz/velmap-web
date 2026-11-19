import { resetZoom } from './canvasInteractions';
import { emptyTrash, renderUnsortedDrawer, updateTrashBadge } from './cardActions';
import { fetchAndRenderCards } from './cardRenderer';
import { dbDelete, dbGet, dbGetAll, dbPut } from './db';
import { loadBoard, renderHomeView } from './homeView';
import { t } from './i18n';
import { syncSoundsUI } from './sound';
import { LEGACY_PROFILE_KEY, PROFILE_STORAGE_KEY, S, TOMBSTONE_STORAGE_KEY, UI_STATE_STORAGE_KEY, blobUrlCache } from './state';
import { scheduleSyncMutation } from './sync';
import { centerCanvasInitial, showToast } from './uiState';

export function getInitials(name) {
    const cleaned = (name || '').trim();
    if (!cleaned) return 'U';
    const parts = cleaned.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function normalizeHexColor(color) {
    if (typeof color !== 'string') return '#4f6b8a';
    const trimmed = color.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
        return '#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
    }
    return '#4f6b8a';
}

export function getContrastTextColor(hex) {
    const c = normalizeHexColor(hex);
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.65 ? '#141416' : '#ffffff';
}

export function loadUserProfile() {
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
                S.userProfile.name = parsed.name || 'Workspace';
                S.userProfile.color = normalizeHexColor(parsed.color || '#4f6b8a');
                S.userProfile.avatar = parsed.avatar || null;
                S.userProfile.updatedAt = parsed.updatedAt || 0;
            }
        }
    } catch (e) {
        console.warn('Could not read profile:', e);
    }
    syncProfileUI();
}

export function renderAvatarElement(el, initials, ringBg = '#18181b') {
    if (!el) return;
    const bgColor = normalizeHexColor(S.userProfile.color);
    el.style.setProperty('background-color', bgColor, 'important');
    el.style.setProperty('color', getContrastTextColor(bgColor), 'important');
    if (ringBg) {
        el.style.setProperty('box-shadow', `0 0 0 2px ${ringBg}, 0 0 0 3.5px ${bgColor}`, 'important');
    } else {
        el.style.setProperty('box-shadow', `0 0 0 1.5px ${bgColor}`, 'important');
    }
    if (S.userProfile.avatar) {
        el.innerHTML = `<img src="${S.userProfile.avatar}" class="w-full h-full object-cover rounded-full pointer-events-none" alt="">`;
    } else {
        el.innerHTML = '';
        el.textContent = initials;
    }
}

export function syncOnboardingPrefsWidgets() {
    const toggleBtn = document.getElementById('onboard-unsorted-toggle');
    if (toggleBtn) {
        toggleBtn.className = `w-9 h-5 rounded-full transition-colors p-0.5 flex items-center ${S.isSidebarOpen ? 'bg-emerald-500/80 justify-end' : 'bg-white/10 justify-start'}`;
    }
}

export async function dismissOnboardingPrefsCard(cardId) {
    const card = await dbGet('cards', cardId);
    if (!card) return;
    card.isTrash = true;
    await dbPut('cards', card);
    S.selectedCardIds.delete(cardId);
    await fetchAndRenderCards();
    await updateTrashBadge();
}

export function syncProfileUI() {
    const initials = getInitials(S.userProfile.name);
    const displayName = (S.userProfile.name || '').trim() || 'Workspace';
    const activeColor = normalizeHexColor(S.userProfile.color);

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
    const nameInput = document.getElementById('settings-user-name-input') as HTMLInputElement | null;
    renderAvatarElement(previewAvatar, initials, '#18181b');
    if (nameInput && document.activeElement !== nameInput) {
        nameInput.value = S.userProfile.name;
    }

    const onboardAvatar = document.getElementById('onboard-avatar-preview');
    const onboardNameInput = document.getElementById('onboard-name-input') as HTMLInputElement | null;
    const onboardHex = document.getElementById('onboard-color-hex');
    renderAvatarElement(onboardAvatar, initials, '#202024');
    if (onboardNameInput && document.activeElement !== onboardNameInput) {
        onboardNameInput.value = S.userProfile.name;
    }
    if (onboardHex) onboardHex.textContent = activeColor;

    const customColorInp = document.getElementById('settings-custom-color-input') as HTMLInputElement | null;
    const customColorLbl = document.getElementById('settings-custom-color-label');
    const onboardCustomInp = document.getElementById('onboard-custom-color-input') as HTMLInputElement | null;
    const onboardCustomLbl = document.getElementById('onboard-custom-color-label');
    if (customColorInp) customColorInp.value = activeColor;
    if (onboardCustomInp) onboardCustomInp.value = activeColor;

    const removeBtn = document.getElementById('btn-remove-pfp');
    if (removeBtn) {
        if (S.userProfile.avatar) removeBtn.classList.remove('hidden');
        else removeBtn.classList.add('hidden');
    }

    const settingsPresets = new Set();
    document.querySelectorAll<HTMLElement>('#settings-color-options button').forEach(btn => {
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
    document.querySelectorAll<HTMLElement>('#onboard-color-options .onboard-color-swatch').forEach(btn => {
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

export function saveUserProfile(skipTouch = false) {
    if (!skipTouch) {
        S.userProfile.updatedAt = Date.now();
    }
    S.userProfile.color = normalizeHexColor(S.userProfile.color);
    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(S.userProfile));
    } catch (e) {
        console.warn('Could not save profile:', e);
        showToast(t('quotaExceededPfp'));
    }
    syncProfileUI();
    if (!skipTouch) scheduleSyncMutation();
}

export function setProfileName(name) {
    S.userProfile.name = typeof name === 'string' ? name : 'Workspace';
    saveUserProfile(false);
}

export function setProfileColor(color) {
    S.userProfile.color = normalizeHexColor(color);
    saveUserProfile(false);
}

export function triggerPfpUpload() {
    document.getElementById('pfp-file-input')?.click();
}

export function removeUserPfp() {
    S.userProfile.avatar = null;
    saveUserProfile();
    renderSettingsStorage();
    showToast(t('pfpRemoved'));
}

export function handlePfpFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => openPfpCropModal(img);
        img.src = String(ev.target?.result || '');
    };
    reader.readAsDataURL(file);
}

export function openPfpCropModal(img) {
    const stageSize = 260;
    const apertureSize = 220;
    S.pfpCropState.img = img;
    S.pfpCropState.minScale = Math.max(apertureSize / img.width, apertureSize / img.height);
    S.pfpCropState.zoom = 1;
    S.pfpCropState.offsetX = 0;
    S.pfpCropState.offsetY = 0;
    S.pfpCropState.isDragging = false;

    const slider = document.getElementById('pfp-crop-zoom') as HTMLInputElement | null;
    if (slider) slider.value = '1';
    document.getElementById('pfp-crop-modal').classList.remove('hidden');
    renderPfpCropCanvas();
}

export function closePfpCropModal() {
    S.pfpCropState.img = null;
    S.pfpCropState.isDragging = false;
    document.getElementById('pfp-crop-modal')?.classList.add('hidden');
}

export function clampPfpOffsets() {
    if (!S.pfpCropState.img) return;
    const apertureRadius = 110;
    const scale = S.pfpCropState.minScale * S.pfpCropState.zoom;
    const halfW = (S.pfpCropState.img.width * scale) / 2;
    const halfH = (S.pfpCropState.img.height * scale) / 2;
    const maxOffsetX = Math.max(0, halfW - apertureRadius);
    const maxOffsetY = Math.max(0, halfH - apertureRadius);
    S.pfpCropState.offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, S.pfpCropState.offsetX));
    S.pfpCropState.offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, S.pfpCropState.offsetY));
}

export function renderPfpCropCanvas() {
    const canvas = document.getElementById('pfp-crop-canvas') as HTMLCanvasElement | null;
    if (!canvas || !S.pfpCropState.img) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#111113';
    ctx.fillRect(0, 0, size, size);

    clampPfpOffsets();
    const scale = S.pfpCropState.minScale * S.pfpCropState.zoom;
    const drawW = S.pfpCropState.img.width * scale;
    const drawH = S.pfpCropState.img.height * scale;
    const drawX = (size - drawW) / 2 + S.pfpCropState.offsetX;
    const drawY = (size - drawH) / 2 + S.pfpCropState.offsetY;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(S.pfpCropState.img, drawX, drawY, drawW, drawH);
}

export function onPfpCropZoomChange(val) {
    S.pfpCropState.zoom = parseFloat(val) || 1;
    renderPfpCropCanvas();
}

export function resetPfpCrop() {
    S.pfpCropState.zoom = 1;
    S.pfpCropState.offsetX = 0;
    S.pfpCropState.offsetY = 0;
    const slider = document.getElementById('pfp-crop-zoom') as HTMLInputElement | null;
    if (slider) slider.value = '1';
    renderPfpCropCanvas();
}

export function applyPfpCrop() {
    if (!S.pfpCropState.img) return;
    const outSize = 256;
    const apertureSize = 220;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outSize;
    outCanvas.height = outSize;
    const ctx = outCanvas.getContext('2d');

    const scale = S.pfpCropState.minScale * S.pfpCropState.zoom;
    const ratio = outSize / apertureSize;
    const drawW = S.pfpCropState.img.width * scale * ratio;
    const drawH = S.pfpCropState.img.height * scale * ratio;
    const drawX = (outSize - drawW) / 2 + S.pfpCropState.offsetX * ratio;
    const drawY = (outSize - drawH) / 2 + S.pfpCropState.offsetY * ratio;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(S.pfpCropState.img, drawX, drawY, drawW, drawH);

    S.userProfile.avatar = outCanvas.toDataURL('image/webp', 0.88);
    saveUserProfile();
    closePfpCropModal();
    renderSettingsStorage();
    showToast(t('pfpUpdated'));
}

export async function openSettingsModal() {
    S.pendingClearAction = null;
    document.getElementById('clear-confirm-bar')?.classList.add('hidden');
    syncProfileUI();
    syncSoundsUI();
    document.getElementById('settings-modal').classList.remove('hidden');
    await renderSettingsStorage();
}

export function closeSettingsModal() {
    S.pendingClearAction = null;
    document.getElementById('clear-confirm-bar')?.classList.add('hidden');
    document.getElementById('settings-modal').classList.add('hidden');
}

export function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const val = bytes / Math.pow(1024, idx);
    return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export async function renderSettingsStorage() {
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
        { label: t('rowProfile'), count: S.userProfile.avatar ? t('customPhoto') : t('initialsLabel'), size: formatBytes(profileBytes) }
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

export function requestClearAction(action) {
    S.pendingClearAction = action;
    const bar = document.getElementById('clear-confirm-bar');
    const text = document.getElementById('clear-confirm-text');
    if (action === 'trash') text.textContent = t('confirmClearTrash');
    else if (action === 'unsorted') text.textContent = t('confirmClearUnsorted');
    else text.textContent = t('confirmClearAll');
    bar.classList.remove('hidden');
}

export function cancelClearAction() {
    S.pendingClearAction = null;
    document.getElementById('clear-confirm-bar').classList.add('hidden');
}

export async function executeClearAction() {
    const action = S.pendingClearAction;
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

export async function pruneOrphanAssets() {
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

export async function clearUnsortedData() {
    const allCards = await dbGetAll('cards');
    for (const c of allCards) {
        if (c.boardId === 'unsorted' && !c.isTrash) {
            await dbDelete('cards', c.id);
        }
    }
    S.selectedUnsortedCardIds.clear();
    await pruneOrphanAssets();
    await fetchAndRenderCards();
    await renderUnsortedDrawer();
}

export async function clearAllAppData() {
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

    S.selectedCardIds.clear();
    S.selectedUnsortedCardIds.clear();
    S.selectedConnectionId = null;
    S.breadcrumbs = [{ id: 'root', title: 'Home' }];
    S.currentBoardId = 'root';
    S.uiViewports = {};
    localStorage.removeItem(TOMBSTONE_STORAGE_KEY);
    localStorage.removeItem(UI_STATE_STORAGE_KEY);
    await dbPut('boards', { id: 'root', title: 'Home', isArea: true, createdAt: Date.now() }, true);
    resetZoom();
    centerCanvasInitial();
    await loadBoard('root', { resetViewport: true });
    if (S.isHomeViewOpen) await renderHomeView();
}
