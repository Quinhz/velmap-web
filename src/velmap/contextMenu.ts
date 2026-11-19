import { fetchAndRenderCards } from './cardRenderer';
import { dbGet, dbPut } from './db';
import { pushUndoSnapshot } from './history';
import { openSubBoard } from './homeView';
import { t } from './i18n';
import { S } from './state';
import { syncSelectionVisuals } from './toolbar';
import { showToast } from './uiState';

export function openSelectedBoardMoreMenu(event) {
    event?.stopPropagation();
    const selectedId = Array.from(S.selectedCardIds)[0];
    if (!selectedId) return;
    const rect = event?.currentTarget?.getBoundingClientRect();
    const x = rect ? rect.right + 10 : 80;
    const y = rect ? rect.top : 240;
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
    menu.style.left = `${Math.min(x, window.innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
}

export async function openSubBoardById(boardId) {
    document.getElementById('context-menu').style.display = 'none';
    const c = S.cards.find(cd => cd.id === boardId) || await dbGet('cards', boardId);
    await openSubBoard(boardId, c?.title || t('newBoardTitle'));
}

export function openContextMenuAt(clientX, clientY, targetEl) {
    const viewport = document.getElementById('canvas-viewport');
    const menu = document.getElementById('context-menu');
    const targetCardEl = targetEl && targetEl.closest ? targetEl.closest('.interactive-card') : null;
    let html = '';

    if (targetCardEl) {
        const cardId = targetCardEl.dataset.id;
        if (!S.selectedCardIds.has(cardId)) {
            S.selectedCardIds.clear();
            S.selectedCardIds.add(cardId);
            syncSelectionVisuals();
        }

        const selectedIdsArr = Array.from(S.selectedCardIds);
        const count = selectedIdsArr.length;
        const isMulti = count > 1;
        const selectedCards = selectedIdsArr.map(id => S.cards.find(c => c.id === id)).filter(Boolean);
        const allStickies = selectedCards.length > 0 && selectedCards.every(c => c.type === 'sticky');
        const convertOption = allStickies
            ? `<div class="context-menu-item" onclick="convertSelectedToDocument()">${isMulti ? t('convertCardsToDocCount', { n: count }) : t('convertToDocument')}</div>`
            : '';

        html = `
            <div class="context-menu-item" onclick="deleteSelectedCards()">${isMulti ? t('deleteCardsCount', { n: count }) : t('deleteCard')} <kbd>Del</kbd></div>
            <div class="context-menu-item" onclick="moveSelectedToUnsorted()">${isMulti ? t('moveCardsUnsortedCount', { n: count }) : t('moveToUnsorted')}</div>
            ${convertOption}
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" onclick="bringSelectedToFront()">${t('bringToFront')}</div>
            <div class="context-menu-item" onclick="sendSelectedToBack()">${t('sendToBack')}</div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" onclick="cutSelectedCards()">${t('cut')} <kbd>Ctrl X</kbd></div>
            <div class="context-menu-item" onclick="copySelectedCards()">${t('copy')} <kbd>Ctrl C</kbd></div>
            <div class="context-menu-item" onclick="duplicateSelectedCards()">${t('duplicate')} <kbd>Ctrl D</kbd></div>
        `;
    } else {
        const rect = viewport.getBoundingClientRect();
        const cursorCanvasX = Math.round((clientX - rect.left - S.canvasPanX) / S.canvasScale);
        const cursorCanvasY = Math.round((clientY - rect.top - S.canvasPanY) / S.canvasScale);
        const spawnX = Math.round(cursorCanvasX - 110);
        const spawnY = Math.round(cursorCanvasY - 70);
        const hasClipboard = Boolean(S.velmapClipboard && Array.isArray(S.velmapClipboard.cards) && S.velmapClipboard.cards.length > 0);
        html = `
            <div class="context-menu-item" onclick="undoAction()">${t('undo')} <kbd>Ctrl Z</kbd></div>
            <div class="context-menu-item" onclick="redoAction()">${t('redo')} <kbd>Ctrl Y</kbd></div>
            ${hasClipboard ? `<div class="context-menu-item" onclick="pasteVelmapClipboard(${cursorCanvasX}, ${cursorCanvasY})">${t('paste')} <kbd>Ctrl V</kbd></div>` : ''}
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" onclick="selectAllCards()">${t('selectAll')} <kbd>Ctrl A</kbd></div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" onclick="createCardAt('sticky', ${spawnX}, ${spawnY})">${t('newNote')}</div>
            <div class="context-menu-item" onclick="createCardAt('document', ${spawnX}, ${spawnY})">${t('newDocument')}</div>
            <div class="context-menu-item" onclick="createCardAt('link', ${spawnX}, ${spawnY})">${t('newLink')}</div>
            <div class="context-menu-item" onclick="createCardAt('task', ${spawnX}, ${spawnY})">${t('newTodo')}</div>
            <div class="context-menu-item" onclick="activateLineToolFromMenu()">${t('newLine')}</div>
            <div class="context-menu-item" onclick="createCardAt('subboard', ${spawnX}, ${spawnY})">${t('newBoard')}</div>
            <div class="context-menu-item" onclick="createCardAt('column', ${spawnX}, ${spawnY})">${t('newColumn')}</div>
            <div class="context-menu-item" onclick="createCardAt('comment', ${spawnX}, ${spawnY})">${t('newComment')}</div>
            <div class="context-menu-item" onclick="createCardAt('table', ${spawnX}, ${spawnY})">${t('newTable')}</div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" onclick="openBoardBgPopover(${Math.round(clientX)}, ${Math.round(clientY)})">${t('changeBackground')}</div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" onclick="triggerImageUpload()">${t('newImagePlaceholder')}</div>
        `;
    }

    menu.innerHTML = html;
    menu.style.display = 'block';

    const menuW = menu.offsetWidth;
    const menuH = menu.offsetHeight;
    let x = clientX;
    let y = clientY;
    if (x + menuW > window.innerWidth - 8) x = Math.max(8, window.innerWidth - menuW - 8);
    if (y + menuH > window.innerHeight - 8) y = Math.max(8, window.innerHeight - menuH - 8);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
}

export function setupContextMenu() {
    const viewport = document.getElementById('canvas-viewport');
    const menu = document.getElementById('context-menu');

    window.addEventListener('click', (e: any) => {
        if (e.target?.offsetParent !== menu) menu.style.display = 'none';
        const bgPop = document.getElementById('board-bg-popover');
        if (bgPop && !bgPop.classList.contains('hidden') && !bgPop.contains(e.target) && !menu.contains(e.target)) {
            bgPop.classList.add('hidden');
        }
    });
    window.addEventListener('touchstart', (e: any) => {
        if (!e.target?.closest?.('#context-menu')) menu.style.display = 'none';
        const bgPop = document.getElementById('board-bg-popover');
        if (bgPop && !bgPop.classList.contains('hidden') && !e.target?.closest?.('#board-bg-popover')) {
            bgPop.classList.add('hidden');
        }
    }, { passive: true });

    viewport.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        S.lastMouseClientX = e.clientX;
        S.lastMouseClientY = e.clientY;
        openContextMenuAt(e.clientX, e.clientY, e.target);
    });
}

export function selectAllCards() {
    document.getElementById('context-menu').style.display = 'none';
    S.cards.forEach(c => S.selectedCardIds.add(c.id));
    syncSelectionVisuals();
}

export function getNextTopZIndex() {
    const active = S.cards.filter(c => !c.isTrash);
    let maxZ = 10;
    for (const c of active) {
        if (typeof c.zIndex === 'number' && c.zIndex > maxZ) maxZ = c.zIndex;
    }
    return maxZ + 1;
}

export async function reorderCardLayer(cardIdsOrId, direction) {
    const targetIds = new Set(Array.isArray(cardIdsOrId) ? cardIdsOrId : [cardIdsOrId]);
    const sourceList = (S.allSystemCards && S.allSystemCards.length ? S.allSystemCards : S.cards)
        .filter(c => c.boardId === S.currentBoardId && !c.isTrash);
    const boardCards = sourceList
        .slice()
        .sort((a, b) => {
            const za = typeof a.zIndex === 'number' ? a.zIndex : 10;
            const zb = typeof b.zIndex === 'number' ? b.zIndex : 10;
            if (za !== zb) return za - zb;
            return (a.createdAt || 0) - (b.createdAt || 0);
        });

    const moving = boardCards.filter(c => targetIds.has(c.id));
    if (moving.length === 0) return;
    await pushUndoSnapshot();
    const remaining = boardCards.filter(c => !targetIds.has(c.id));
    const reordered = direction === 'front' ? [...remaining, ...moving] : [...moving, ...remaining];

    for (let i = 0; i < reordered.length; i++) {
        const nextZ = 10 + i;
        reordered[i].zIndex = nextZ;
        const stored = await dbGet('cards', reordered[i].id);
        if (stored && stored.zIndex !== nextZ) {
            stored.zIndex = nextZ;
            await dbPut('cards', stored);
        }
    }

    document.getElementById('context-menu').style.display = 'none';
    await fetchAndRenderCards();
    showToast(t(direction === 'front' ? 'broughtToFront' : 'sentToBack'));
}

export async function bringToFront(cardId) {
    const ids = S.selectedCardIds.has(cardId) ? Array.from(S.selectedCardIds) : [cardId];
    await reorderCardLayer(ids, 'front');
}

export async function sendToBack(cardId) {
    const ids = S.selectedCardIds.has(cardId) ? Array.from(S.selectedCardIds) : [cardId];
    await reorderCardLayer(ids, 'back');
}

export async function bringSelectedToFront() {
    const ids = Array.from(S.selectedCardIds);
    if (ids.length > 0) await reorderCardLayer(ids, 'front');
}

export async function sendSelectedToBack() {
    const ids = Array.from(S.selectedCardIds);
    if (ids.length > 0) await reorderCardLayer(ids, 'back');
}
