import { clearSelection, updateCanvasTransform } from './canvasInteractions';
import { updateTrashBadge } from './cardActions';
import { fetchAndRenderCards } from './cardRenderer';
import { dbDelete, dbGet, dbGetAll, dbPut } from './db';
import { applyBoardBackground } from './history';
import { t } from './i18n';
import { syncProfileUI } from './profileSettings';
import { S } from './state';
import { centerCanvasInitial, escapeHtml, saveUIState, showToast } from './uiState';

export function restoreViewportForBoard(boardId) {
    const saved = S.uiViewports[boardId];
    if (saved && Number.isFinite(saved.scale) && Number.isFinite(saved.panX) && Number.isFinite(saved.panY)) {
        S.canvasScale = Math.min(Math.max(saved.scale, 0.25), 2.5);
        S.canvasPanX = saved.panX;
        S.canvasPanY = saved.panY;
        const zl = document.getElementById('zoom-level');
        if (zl) zl.textContent = Math.round(S.canvasScale * 100) + '%';
        updateCanvasTransform();
        return true;
    }
    return false;
}

export async function loadBoard(boardId: string, options: any = {}) {
    S.currentBoardId = boardId;
    S.selectedConnectionId = null;
    clearSelection();
    const board = await dbGet('boards', boardId);
    if (board) {
        const bcIndex = S.breadcrumbs.findIndex(b => b.id === boardId);
        if (bcIndex !== -1) S.breadcrumbs = S.breadcrumbs.slice(0, bcIndex + 1);
        else if (board.isArea || boardId === 'root') S.breadcrumbs = [{ id: boardId, title: board.title }];
        else S.breadcrumbs.push({ id: boardId, title: board.title });
    }
    if (options.restoreViewport) {
        if (!restoreViewportForBoard(boardId)) {
            S.canvasScale = 1;
            const zl = document.getElementById('zoom-level');
            if (zl) zl.textContent = '100%';
            centerCanvasInitial();
        }
    } else if (options.resetViewport) {
        S.canvasScale = 1;
        const zl = document.getElementById('zoom-level');
        if (zl) zl.textContent = '100%';
        centerCanvasInitial();
    }
    applyBoardBackground(board);
    renderBreadcrumbs();
    await fetchAndRenderCards();
    await updateTrashBadge();
    if (!options.skipSaveUI) saveUIState();
}

export function renderBreadcrumbs() {
    const container = document.getElementById('breadcrumb-container');
    container.innerHTML = '';
    S.breadcrumbs.forEach((bc, idx) => {
        if (idx > 0) {
            const sep = document.createElement('span');
            sep.className = 'text-zinc-600 shrink-0';
            sep.textContent = '/';
            container.appendChild(sep);
        }
        const isLast = idx === S.breadcrumbs.length - 1;
        const btn = document.createElement('button');
        btn.type = 'button';
        if (!isLast) {
            btn.className = 'breadcrumb-drop-tab text-zinc-300 hover:text-white transition-all whitespace-nowrap shrink-0';
            btn.dataset.breadcrumbBoardId = bc.id;
        } else {
            btn.className = 'text-zinc-100 font-semibold px-1 py-0.5 whitespace-nowrap shrink-0';
        }
        btn.textContent = bc.id === 'root' ? t('mainWorkspaceTitle') : bc.title;
        btn.onclick = () => {
            if (S.isHomeViewOpen) closeHomeView();
            navigateToBoard(bc.id, idx);
        };
        container.appendChild(btn);
    });
}

export async function navigateToBoard(boardId, index) {
    S.breadcrumbs = S.breadcrumbs.slice(0, index + 1);
    await loadBoard(boardId, { restoreViewport: true });
}

export async function openSubBoard(subBoardId, title) {
    let board = await dbGet('boards', subBoardId);
    if (!board) {
        await dbPut('boards', { id: subBoardId, title: title, parentId: S.currentBoardId, createdAt: Date.now() });
    }
    S.breadcrumbs.push({ id: subBoardId, title: title });
    await loadBoard(subBoardId, { restoreViewport: true });
}

export async function openHomeView(skipSave = false) {
    S.isHomeViewOpen = true;
    const hv = document.getElementById('home-view');
    if (hv) hv.classList.remove('hidden');
    document.getElementById('topbar-home-btn')?.classList.add('bg-white/[0.08]', 'text-white');
    syncProfileUI();
    await renderHomeView();
    if (!skipSave) saveUIState();
}

export function closeHomeView(skipSave = false) {
    S.isHomeViewOpen = false;
    const hv = document.getElementById('home-view');
    if (hv) hv.classList.add('hidden');
    document.getElementById('topbar-home-btn')?.classList.remove('bg-white/[0.08]', 'text-white');
    if (!skipSave) saveUIState();
}

export async function toggleHomeView() {
    if (S.isHomeViewOpen) closeHomeView();
    else await openHomeView();
}

export async function openAreaBoard(areaId) {
    const b = await dbGet('boards', areaId);
    const title = areaId === 'root' ? t('mainWorkspaceTitle') : (b?.title || t('newBoardTitle'));
    S.breadcrumbs = [{ id: areaId, title }];
    closeHomeView(true);
    await loadBoard(areaId, { restoreViewport: true });
}

export async function createNewArea(templateType = 'blank') {
    const now = Date.now();
    const areaId = 'area_' + now + '_' + Math.random().toString(36).substring(2, 6);
    const tplTitles = {
        blank: t('tplBlankTitle'),
        moodboard: t('tplMoodboardTitle'),
        project: t('tplProjectTitle'),
        brainstorm: t('tplBrainstormTitle')
    };
    const areaTitle = tplTitles[templateType] || t('newAreaBtn');
    await dbPut('boards', {
        id: areaId,
        title: areaTitle,
        parentId: null,
        isArea: true,
        template: templateType,
        createdAt: now
    });

    if (templateType === 'moodboard') {
        await dbPut('cards', { id: 'c_' + now + '_1', boardId: areaId, type: 'sticky', title: t('tplMoodboardTitle'), content: t('tplMoodboardDesc'), x: 140, y: 120, width: 270, height: 170, zIndex: 11, isTrash: false, createdAt: now });
        await dbPut('cards', { id: 'c_' + now + '_2', boardId: areaId, type: 'column', title: 'Palette & Refs', content: 'Paste images, GIFs, or links directly onto this board.', x: 450, y: 120, width: 280, height: 220, zIndex: 12, isTrash: false, createdAt: now + 1 });
    } else if (templateType === 'project') {
        const n1 = 'c_' + now + '_p1';
        const n2 = 'c_' + now + '_p2';
        await dbPut('cards', { id: n1, boardId: areaId, type: 'task', title: t('onboardTasksTitle'), tasks: [{ text: t('firstTask'), completed: false }], x: 140, y: 120, width: 280, height: 185, zIndex: 11, isTrash: false, createdAt: now });
        await dbPut('cards', { id: n2, boardId: areaId, type: 'document', title: t('newDocTitle'), content: '<p></p>', x: 470, y: 145, width: 96, height: null, zIndex: 12, isTrash: false, createdAt: now + 1 });
        await dbPut('connections', { id: 'conn_' + now, fromId: n1, toId: n2, fromAnchor: { side: 'right', t: 0.5 }, toAnchor: { side: 'left', t: 0.5 }, color: '#71717a', weight: 2, isDashed: false, startMarker: 'none', endMarker: 'arrow' });
    } else if (templateType === 'brainstorm') {
        const centerId = 'c_' + now + '_b0';
        const b1 = 'c_' + now + '_b1';
        const b2 = 'c_' + now + '_b2';
        await dbPut('cards', { id: centerId, boardId: areaId, type: 'sticky', title: areaTitle, content: t('startTyping'), x: 340, y: 180, width: 260, height: 150, zIndex: 11, isTrash: false, createdAt: now });
        await dbPut('cards', { id: b1, boardId: areaId, type: 'sticky', title: 'Topic A', content: '', x: 680, y: 90, width: 240, height: 140, zIndex: 12, isTrash: false, createdAt: now + 1 });
        await dbPut('cards', { id: b2, boardId: areaId, type: 'sticky', title: 'Topic B', content: '', x: 680, y: 270, width: 240, height: 140, zIndex: 13, isTrash: false, createdAt: now + 2 });
        await dbPut('connections', { id: 'conn_' + now + '_1', fromId: centerId, toId: b1, fromAnchor: { side: 'right', t: 0.35 }, toAnchor: { side: 'left', t: 0.5 }, color: '#71717a', weight: 2, isDashed: false, startMarker: 'none', endMarker: 'arrow' });
        await dbPut('connections', { id: 'conn_' + now + '_2', fromId: centerId, toId: b2, fromAnchor: { side: 'right', t: 0.65 }, toAnchor: { side: 'left', t: 0.5 }, color: '#71717a', weight: 2, isDashed: false, startMarker: 'none', endMarker: 'arrow' });
    }

    await openAreaBoard(areaId);
    showToast(t('areaCreatedToast'));
}

export async function renameArea(areaId) {
    const b = await dbGet('boards', areaId);
    if (!b) return;
    const nextTitle = prompt(t('renameAreaPrompt'), b.title || '');
    if (nextTitle !== null && nextTitle.trim() !== '') {
        b.title = nextTitle.trim();
        await dbPut('boards', b);
        const bc = S.breadcrumbs.find(x => x.id === areaId);
        if (bc) bc.title = b.title;
        renderBreadcrumbs();
        await renderHomeView();
        saveUIState();
    }
}

export async function deleteArea(areaId) {
    if (areaId === 'root') return;
    if (!confirm(t('confirmDeleteArea'))) return;
    const allCards = await dbGetAll('cards');
    for (const c of allCards) {
        if (c.boardId === areaId) await dbDelete('cards', c.id);
    }
    await dbDelete('boards', areaId);
    if (S.currentBoardId === areaId) {
        S.breadcrumbs = [{ id: 'root', title: 'Home' }];
        await loadBoard('root', { restoreViewport: true, skipSaveUI: true });
    }
    await renderHomeView();
    saveUIState();
    showToast(t('areaDeletedToast'));
}

export async function renderHomeView() {
    const grid = document.getElementById('home-areas-grid');
    const statsEl = document.getElementById('home-user-stats');
    if (!grid) return;

    const [allBoards, allCards] = await Promise.all([dbGetAll('boards'), dbGetAll('cards')]);
    const activeCards = allCards.filter(c => !c.isTrash && c.boardId !== 'unsorted');

    const areas = [];
    const rootBoard = allBoards.find(b => b.id === 'root') || { id: 'root', title: 'Home', createdAt: Date.now() };
    areas.push(rootBoard);

    allBoards
        .filter(b => b.id !== 'root' && (b.isArea || !b.parentId))
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
        .forEach(b => areas.push(b));

    if (statsEl) {
        statsEl.textContent = `${t('areasCountLabel', { n: areas.length })} · ${t('cardsCountLabel', { n: activeCards.length })}`;
    }

    grid.innerHTML = '';
    for (const area of areas) {
        const isRoot = area.id === 'root';
        const isActive = S.currentBoardId === area.id;
        const areaCards = activeCards.filter(c => c.boardId === area.id);
        const areaTitle = isRoot ? t('mainWorkspaceTitle') : (area.title || t('newBoardTitle'));
        const cardEl = document.createElement('div');
        cardEl.className = `group bg-[#1a1a1e] hover:bg-[#222227] border ${isActive ? 'border-white/30' : 'border-white/[0.07] hover:border-white/[0.16]'} rounded-xl p-4 transition-all cursor-pointer flex flex-col justify-between gap-4`;
        cardEl.onclick = () => openAreaBoard(area.id);

        cardEl.innerHTML = `
            <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
                        <svg class="w-5 h-5 text-zinc-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                            ${isRoot
                                ? '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline>'
                                : '<rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="M3 9h18M9 21V9"></path>'}
                        </svg>
                    </div>
                    <div class="min-w-0">
                        <div class="text-sm font-semibold text-zinc-100 truncate">${escapeHtml(areaTitle)}</div>
                        <div class="text-[11px] text-zinc-500 mt-0.5">${escapeHtml(t('cardsCountLabel', { n: areaCards.length }))}</div>
                    </div>
                </div>
                <div class="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    ${!isRoot ? `<button type="button" onclick="event.stopPropagation(); renameArea('${area.id}')" class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08]" title="${escapeHtml(t('renameAreaTitle'))}"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>` : ''}
                    ${!isRoot ? `<button type="button" onclick="event.stopPropagation(); deleteArea('${area.id}')" class="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10" title="${escapeHtml(t('deleteAreaTitle'))}"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : ''}
                </div>
            </div>
            <div class="flex items-center justify-between pt-2.5 border-t border-white/[0.05] text-[11px] text-zinc-500">
                <span>${isActive ? 'Active' : ''}</span>
                <span class="text-zinc-300 group-hover:text-white font-medium flex items-center gap-1">${escapeHtml(t('openLabel'))}<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg></span>
            </div>
        `;
        grid.appendChild(cardEl);
    }
}
