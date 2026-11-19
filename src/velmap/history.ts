import { clearSelection } from './canvasInteractions';
import { closeTrashModal, deleteSelectedCards, updateTrashBadge } from './cardActions';
import { fetchAndRenderCards } from './cardRenderer';
import { clearConnectionSelection, deleteSelectedConnection, drawConnections } from './connections';
import { getNextTopZIndex, selectAllCards } from './contextMenu';
import { dbDelete, dbGet, dbGetAll, dbPut } from './db';
import { cancelFloatingPhysicsDrag, clearDropTargetHighlights, setDraggedCardsElevated } from './dragDrop';
import { closeHomeView, loadBoard, renderBreadcrumbs } from './homeView';
import { t } from './i18n';
import { closePfpCropModal, closeSettingsModal, normalizeHexColor } from './profileSettings';
import { BOARD_BG_PRESETS, MAX_UNDO_HISTORY, S, VELMAP_CLIPBOARD_PREFIX } from './state';
import { closeSyncModal, scheduleSyncMutation } from './sync';
import { setTool, syncSelectionVisuals } from './toolbar';
import { escapeHtml, exitCardEditMode, showToast } from './uiState';

export async function captureWorkspaceSnapshot() {
    const [allBoards, allCards, allConns] = await Promise.all([
        dbGetAll('boards'),
        dbGetAll('cards'),
        dbGetAll('connections')
    ]);
    return {
        boards: structuredClone(allBoards),
        cards: structuredClone(allCards),
        connections: structuredClone(allConns),
        boardId: S.currentBoardId
    };
}

export async function pushUndoSnapshot(preCaptured = null) {
    if (S.isApplyingHistory) return;
    const snap = preCaptured || await captureWorkspaceSnapshot();
    S.undoStack.push(snap);
    if (S.undoStack.length > MAX_UNDO_HISTORY) S.undoStack.shift();
    S.redoStack = [];
}

export async function applyWorkspaceSnapshot(snap) {
    if (!snap) return;
    S.isApplyingHistory = true;
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
        const nextBoardId = targetBoardExists ? snap.boardId : (snap.boards || []).some(b => b.id === S.currentBoardId) ? S.currentBoardId : 'root';
        S.selectedCardIds.clear();
        S.selectedConnectionId = null;
        if (nextBoardId !== S.currentBoardId) {
            await loadBoard(nextBoardId, { restoreViewport: true, skipSaveUI: true });
        } else {
            const board = await dbGet('boards', S.currentBoardId);
            applyBoardBackground(board);
            renderBreadcrumbs();
            await fetchAndRenderCards();
            await updateTrashBadge();
        }
        syncSelectionVisuals();
        scheduleSyncMutation();
    } finally {
        S.isApplyingHistory = false;
    }
}

export async function undoAction() {
    if (typeof flushArrowNudgeCommit === 'function') await flushArrowNudgeCommit();
    document.getElementById('context-menu').style.display = 'none';
    if (S.undoStack.length === 0) {
        showToast(t('nothingToUndo'));
        return;
    }
    const currentSnap = await captureWorkspaceSnapshot();
    const targetSnap = S.undoStack.pop();
    S.redoStack.push(currentSnap);
    await applyWorkspaceSnapshot(targetSnap);
    showToast(t('undoneToast'));
}

export async function redoAction() {
    document.getElementById('context-menu').style.display = 'none';
    if (S.redoStack.length === 0) {
        showToast(t('nothingToRedo'));
        return;
    }
    const currentSnap = await captureWorkspaceSnapshot();
    const targetSnap = S.redoStack.pop();
    S.undoStack.push(currentSnap);
    await applyWorkspaceSnapshot(targetSnap);
    showToast(t('redoneToast'));
}

export async function buildClipboardPayloadForSelection() {
    const ids = Array.from(S.selectedCardIds);
    if (ids.length === 0) return null;
    const idSet = new Set(ids);
    const allCardsNow = await dbGetAll('cards');
    const allConnsNow = await dbGetAll('connections');
    const copiedCards = allCardsNow.filter(c => idSet.has(c.id) && !c.isTrash).map(c => structuredClone(c));
    if (copiedCards.length === 0) return null;
    const copiedConns = allConnsNow
        .filter(cn => idSet.has(cn.fromId) && idSet.has(cn.toId))
        .map(cn => structuredClone(cn));
    return { cards: copiedCards, connections: copiedConns };
}

export async function cloneCardsAndConnectionsToBoard(sourceCards, sourceConnections, targetBoardId, offsetX = 28, offsetY = 28) {
    if (!Array.isArray(sourceCards) || sourceCards.length === 0) return [];
    const idMap = new Map();
    let nextZ = getNextTopZIndex();
    const createdIds = [];
    const now = Date.now();

    for (let i = 0; i < sourceCards.length; i++) {
        const orig = sourceCards[i];
        const prefix = orig.type === 'subboard' ? 'sub_' : 'card_';
        const newId = prefix + (now + i) + '_' + Math.random().toString(36).substring(2, 7);
        idMap.set(orig.id, newId);

        const clone = structuredClone(orig);
        clone.id = newId;
        clone.boardId = targetBoardId;
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
        createdIds.push(newId);
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

    S.selectedCardIds.clear();
    createdIds.forEach(id => S.selectedCardIds.add(id));
    S.selectedConnectionId = null;
    await fetchAndRenderCards();
    syncSelectionVisuals();
    return createdIds;
}

export async function writeClipboardMarker(text) {
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

export async function copySelectedCards() {
    document.getElementById('context-menu').style.display = 'none';
    const payload = await buildClipboardPayloadForSelection();
    if (!payload) return false;
    const token = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const wroteSystem = await writeClipboardMarker(VELMAP_CLIPBOARD_PREFIX + token);
    S.velmapClipboard = {
        cards: payload.cards,
        connections: payload.connections,
        pasteCount: 0,
        token,
        wroteSystem
    };
    showToast(t('copiedToast', { n: payload.cards.length }));
    return true;
}

export async function cutSelectedCards() {
    document.getElementById('context-menu').style.display = 'none';
    const payload = await buildClipboardPayloadForSelection();
    if (!payload) return false;
    await pushUndoSnapshot();
    const token = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const wroteSystem = await writeClipboardMarker(VELMAP_CLIPBOARD_PREFIX + token);
    S.velmapClipboard = {
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
        S.selectedCardIds.delete(c.id);
    }
    await fetchAndRenderCards();
    await updateTrashBadge();
    syncSelectionVisuals();
    showToast(t('cutToast', { n: payload.cards.length }));
    return true;
}

export async function pasteVelmapClipboard(targetX = null, targetY = null) {
    document.getElementById('context-menu').style.display = 'none';
    if (!S.velmapClipboard || !Array.isArray(S.velmapClipboard.cards) || S.velmapClipboard.cards.length === 0) return false;
    await pushUndoSnapshot();

    let anchorX = targetX;
    let anchorY = targetY;
    const vp = document.getElementById('canvas-viewport');

    if (typeof anchorX !== 'number' || typeof anchorY !== 'number') {
        if (vp) {
            const rect = vp.getBoundingClientRect();
            const hasValidMouse = (
                typeof S.lastMouseClientX === 'number' &&
                typeof S.lastMouseClientY === 'number' &&
                S.lastMouseClientX >= rect.left && S.lastMouseClientX <= rect.right &&
                S.lastMouseClientY >= rect.top && S.lastMouseClientY <= rect.bottom
            );
            if (hasValidMouse) {
                anchorX = (S.lastMouseClientX - rect.left - S.canvasPanX) / S.canvasScale;
                anchorY = (S.lastMouseClientY - rect.top - S.canvasPanY) / S.canvasScale;
            } else {
                anchorX = (-S.canvasPanX + vp.clientWidth / 2) / S.canvasScale;
                anchorY = (-S.canvasPanY + vp.clientHeight / 2) / S.canvasScale;
            }
        } else {
            anchorX = 240;
            anchorY = 200;
        }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    S.velmapClipboard.cards.forEach(c => {
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
    if (S.lastPasteCursorKey === spotKey) {
        S.lastPasteSameSpotCount += 1;
    } else {
        S.lastPasteCursorKey = spotKey;
        S.lastPasteSameSpotCount = 0;
    }
    const cascade = 18 * S.lastPasteSameSpotCount;
    const offsetX = Math.round(anchorX - groupCenterX + cascade);
    const offsetY = Math.round(anchorY - groupCenterY + cascade);

    const created = await cloneCardsAndConnectionsToBoard(S.velmapClipboard.cards, S.velmapClipboard.connections, S.currentBoardId, offsetX, offsetY);
    if (created.length > 0) showToast(t('pastedToast', { n: created.length }));
    return created.length > 0;
}

export async function duplicateSelectedCards() {
    document.getElementById('context-menu').style.display = 'none';
    const payload = await buildClipboardPayloadForSelection();
    if (!payload) return;
    await pushUndoSnapshot();
    const created = await cloneCardsAndConnectionsToBoard(payload.cards, payload.connections, S.currentBoardId, 24, 24);
    if (created.length > 0) showToast(t('duplicatedToast'));
}

export function applyBoardBackground(board) {
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

export function refreshBoardBgPopoverUI(bgStyle) {
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
    document.querySelectorAll<HTMLElement>('#board-bg-patterns [data-bg-pattern]').forEach(btn => {
        const isActive = btn.dataset.bgPattern === pattern;
        btn.className = isActive
            ? 'px-2 py-1.5 rounded-lg text-[11px] font-medium border border-white/40 bg-white/15 text-white transition-colors'
            : 'px-2 py-1.5 rounded-lg text-[11px] font-medium border border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-zinc-200 transition-colors';
    });
}

export async function openBoardBgPopover(anchorX, anchorY) {
    document.getElementById('context-menu').style.display = 'none';
    const pop = document.getElementById('board-bg-popover');
    if (!pop) return;
    const board = await dbGet('boards', S.currentBoardId);
    refreshBoardBgPopoverUI(board?.bgStyle || { color: '#131316', pattern: 'dots' });
    const x = Math.min(Math.max(12, anchorX ?? (window.innerWidth / 2 - 132)), Math.max(12, window.innerWidth - 276));
    const y = Math.min(Math.max(56, anchorY ?? (window.innerHeight / 2 - 110)), Math.max(56, window.innerHeight - 230));
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    pop.classList.remove('hidden');
}

export function closeBoardBgPopover() {
    document.getElementById('board-bg-popover')?.classList.add('hidden');
}

export async function updateCurrentBoardBgStyle(nextPartial) {
    let board = await dbGet('boards', S.currentBoardId);
    if (!board) {
        const subCard = await dbGet('cards', S.currentBoardId);
        board = { id: S.currentBoardId, title: subCard?.title || t('newBoardTitle'), parentId: subCard?.boardId || 'root', createdAt: Date.now() };
    }
    const prev = board.bgStyle || { color: '#131316', pattern: 'dots' };
    board.bgStyle = { ...prev, ...nextPartial };
    await dbPut('boards', board);
    applyBoardBackground(board);
    refreshBoardBgPopoverUI(board.bgStyle);
}

export async function setBoardBgPreset(color, pattern) {
    await pushUndoSnapshot();
    await updateCurrentBoardBgStyle({ color, pattern });
}

export async function setBoardBgColor(color) {
    await updateCurrentBoardBgStyle({ color: normalizeHexColor(color) });
}

export async function setBoardBgPattern(pattern) {
    await pushUndoSnapshot();
    await updateCurrentBoardBgStyle({ pattern });
}

export async function resetBoardBackground() {
    await pushUndoSnapshot();
    await updateCurrentBoardBgStyle({ color: '#131316', pattern: 'dots' });
    showToast(t('bgUpdatedToast'));
}

export async function flushArrowNudgeCommit() {
    if (S.arrowNudgeTimer) {
        clearTimeout(S.arrowNudgeTimer);
        S.arrowNudgeTimer = null;
    }
    const snapPromise = S.pendingArrowUndoSnapshot;
    S.pendingArrowUndoSnapshot = null;
    const movedIds = Array.from(S.arrowMovedCardIds);
    S.arrowMovedCardIds.clear();
    if (movedIds.length === 0) return;
    if (snapPromise) await pushUndoSnapshot(await snapPromise);
    for (const id of movedIds) {
        const el = document.querySelector<HTMLElement>(`.interactive-card[data-id="${id}"]`);
        const c = await dbGet('cards', id);
        if (c) {
            if (el) {
                c.x = Math.round(parseFloat(el.style.left));
                c.y = Math.round(parseFloat(el.style.top));
            } else {
                const mem = S.cards.find(cd => cd.id === id);
                if (mem) {
                    c.x = Math.round(mem.x);
                    c.y = Math.round(mem.y);
                }
            }
            await dbPut('cards', c);
        }
    }
}

export function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.key === 'Control' || e.key === 'Meta') {
            document.body.classList.add('is-zoom-modifier');
        }
        if (e.key === 'Escape') {
            const activeEl = document.activeElement as HTMLElement | null;
            if (S.editingCardId || (activeEl && activeEl.closest?.('.interactive-card') && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA'))) {
                if (activeEl && typeof activeEl.blur === 'function') activeEl.blur();
                exitCardEditMode();
                return;
            }
            if (S.activeTool === 'line') setTool('select');
            const menu = document.getElementById('context-menu');
            if (menu) menu.style.display = 'none';
            closeBoardBgPopover();
            closePfpCropModal();
            closeSyncModal();
            closeSettingsModal();
            closeTrashModal();
            if (S.isHomeViewOpen) closeHomeView();
            clearSelection();
            clearConnectionSelection();
            return;
        }
        const activeNode = document.activeElement as HTMLElement | null;
        const tag = activeNode?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || activeNode?.isContentEditable) return;

        const isModalOpen = S.isHomeViewOpen ||
            !document.getElementById('document-modal')?.classList.contains('hidden') ||
            !document.getElementById('settings-modal')?.classList.contains('hidden') ||
            !document.getElementById('sync-modal')?.classList.contains('hidden') ||
            !document.getElementById('trash-modal')?.classList.contains('hidden') ||
            !document.getElementById('pfp-crop-modal')?.classList.contains('hidden');
        if (isModalOpen) return;

        const mod = e.ctrlKey || e.metaKey;
        const k = (e.key || '').toLowerCase();

        if (mod && k === 'z' && !e.shiftKey) {
            e.preventDefault();
            undoAction();
            return;
        }
        if ((mod && k === 'z' && e.shiftKey) || (mod && k === 'y' && !e.shiftKey && !e.altKey)) {
            e.preventDefault();
            redoAction();
            return;
        }
        if (mod && k === 'd') {
            e.preventDefault();
            if (S.selectedCardIds.size > 0) duplicateSelectedCards();
            return;
        }
        if (mod && k === 'c') {
            const selText = window.getSelection()?.toString();
            if (!selText && S.selectedCardIds.size > 0) {
                e.preventDefault();
                copySelectedCards();
            }
            return;
        }
        if (mod && k === 'x') {
            const selText = window.getSelection()?.toString();
            if (!selText && S.selectedCardIds.size > 0) {
                e.preventDefault();
                cutSelectedCards();
            }
            return;
        }
        if (mod && k === 'a') {
            e.preventDefault();
            selectAllCards();
            return;
        }

        if (!mod && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            if (S.selectedCardIds.size > 0) {
                e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
                if (!S.pendingArrowUndoSnapshot) {
                    S.pendingArrowUndoSnapshot = captureWorkspaceSnapshot();
                }
                S.selectedCardIds.forEach(id => {
                    const el = document.querySelector<HTMLElement>(`.interactive-card[data-id="${id}"]`);
                    if (el) {
                        const nx = Math.round((parseFloat(el.style.left) || 0) + dx);
                        const ny = Math.round((parseFloat(el.style.top) || 0) + dy);
                        el.style.left = `${nx}px`;
                        el.style.top = `${ny}px`;
                        const mem = S.cards.find(cd => cd.id === id);
                        if (mem) { mem.x = nx; mem.y = ny; }
                        S.arrowMovedCardIds.add(id);
                    }
                });
                drawConnections();
                if (S.arrowNudgeTimer) clearTimeout(S.arrowNudgeTimer);
                S.arrowNudgeTimer = setTimeout(() => { flushArrowNudgeCommit(); }, 260);
                return;
            }
        }

        if (e.code === 'Space' && !S.isSpacePressed) {
            e.preventDefault();
            S.isSpacePressed = true;
            document.body.classList.add('is-space-pressed');
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (S.selectedConnectionId) {
                deleteSelectedConnection();
            } else if (S.selectedCardIds.size > 0) {
                deleteSelectedCards();
            }
        }
    });
    window.addEventListener('keyup', (e) => {
        if (!e.ctrlKey && !e.metaKey) {
            document.body.classList.remove('is-zoom-modifier');
        }
        if (e.code === 'Space') {
            S.isSpacePressed = false;
            document.body.classList.remove('is-space-pressed');
        }
    });
    window.addEventListener('blur', () => {
        S.isSpacePressed = false;
        S.pendingCardDrag = null;
        document.body.classList.remove('is-zoom-modifier', 'is-space-pressed', 'is-canvas-interacting');
        if (typeof cancelFloatingPhysicsDrag === 'function') cancelFloatingPhysicsDrag();
        if (typeof setDraggedCardsElevated === 'function') setDraggedCardsElevated(false);
        if (typeof clearDropTargetHighlights === 'function') clearDropTargetHighlights();
    });
}
