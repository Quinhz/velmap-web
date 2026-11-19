import { setActiveEmbedCard, updateCanvasTransform } from './canvasInteractions';
import { drawConnections } from './connections';
import { dbGet, dbGetAll, dbPut } from './db';
import { t } from './i18n';
import { BOARD_ICONS, S, UI_STATE_STORAGE_KEY } from './state';
import { syncSelectionVisuals } from './toolbar';

export function syncFaviconLogos() {
    let iconHref = document.getElementById('velmap-favicon')?.getAttribute('href') || document.querySelector('link[rel*="icon"]')?.getAttribute('href') || '/favicon.ico';
    try {
        const parentIcon = window.parent && window.parent !== window
            ? window.parent.document.querySelector('link[rel*="icon"]')?.getAttribute('href')
            : null;
        if (parentIcon && (!document.getElementById('velmap-favicon')?.getAttribute('href') || iconHref === '/favicon.ico')) {
            iconHref = parentIcon;
        }
    } catch (_) {}
    document.querySelectorAll('.velmap-logo-img').forEach(img => {
        if (img.getAttribute('src') !== iconHref) {
            img.setAttribute('src', iconHref);
        }
    });
}

export function enterCardEditMode(cardEl, focusTarget = null) {
    if (!cardEl) return;
    const cardId = cardEl.dataset.id;
    if (S.editingCardId && S.editingCardId !== cardId) {
        exitCardEditMode(S.editingCardId);
    }
    let selectionChanged = false;
    if (S.selectedCardIds.size > 0) {
        S.selectedCardIds.clear();
        selectionChanged = true;
    }
    if (S.activeEmbedCardId) {
        setActiveEmbedCard(null);
    }
    if (S.selectedConnectionId) {
        S.selectedConnectionId = null;
        drawConnections();
        selectionChanged = true;
    }
    if (selectionChanged) {
        syncSelectionVisuals();
    }
    S.editingCardId = cardId;
    cardEl.classList.add('is-editing');
    const type = cardEl.dataset.type;
    if (type === 'table') {
        cardEl.querySelectorAll('.table-cell-input').forEach(inp => inp.classList.remove('pointer-events-none'));
    } else if (type === 'sticky' || type === 'column' || type === 'comment') {
        cardEl.querySelectorAll('textarea').forEach(ta => ta.classList.remove('pointer-events-none'));
    } else if (type === 'task') {
        cardEl.querySelectorAll('.task-input').forEach(inp => inp.classList.remove('pointer-events-none'));
    }
    if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus();
        if (typeof focusTarget.setSelectionRange === 'function' && typeof focusTarget.value === 'string') {
            const len = focusTarget.value.length;
            try { focusTarget.setSelectionRange(len, len); } catch (_) {}
        }
    }
}

export function exitCardEditMode(cardId = null) {
    const targetId = cardId || S.editingCardId;
    if (!targetId) return;
    const cardEl = document.querySelector<HTMLElement>(`.interactive-card[data-id="${targetId}"]`);
    if (cardEl) {
        cardEl.classList.remove('is-editing');
        const type = cardEl.dataset.type;
        if (type === 'table') {
            cardEl.querySelectorAll('.table-cell-input').forEach(inp => inp.classList.add('pointer-events-none'));
        } else if (type === 'sticky' || type === 'column' || type === 'comment') {
            cardEl.querySelectorAll('textarea').forEach(ta => ta.classList.add('pointer-events-none'));
        } else if (type === 'task') {
            cardEl.querySelectorAll('.task-input').forEach(inp => inp.classList.add('pointer-events-none'));
        }
    }
    if (!cardId || S.editingCardId === cardId) {
        S.editingCardId = null;
    }
}

export function loadUIState() {
    try {
        const raw = localStorage.getItem(UI_STATE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
    return null;
}

export function saveUIState() {
    if (!S.currentBoardId) return;
    S.uiViewports[S.currentBoardId] = {
        scale: Number.isFinite(S.canvasScale) ? S.canvasScale : 1,
        panX: Number.isFinite(S.canvasPanX) ? S.canvasPanX : 0,
        panY: Number.isFinite(S.canvasPanY) ? S.canvasPanY : 0
    };
    try {
        localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({
            unsortedOpen: !!S.isSidebarOpen,
            currentBoardId: S.currentBoardId,
            breadcrumbs: Array.isArray(S.breadcrumbs) ? S.breadcrumbs : [{ id: 'root', title: 'Home' }],
            homeOpen: !!S.isHomeViewOpen,
            soundsEnabled: !!S.soundsEnabled,
            viewports: S.uiViewports
        }));
    } catch (_) {}
}

export function scheduleSaveUIState() {
    clearTimeout(S.uiStateSaveTimer);
    S.uiStateSaveTimer = setTimeout(saveUIState, 160);
}

export function applySidebarDomState() {
    const s = document.getElementById('right-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!s) return;
    if (S.isSidebarOpen) {
        s.classList.remove('hidden');
        if (backdrop && window.innerWidth < 768) backdrop.classList.remove('hidden');
    } else {
        s.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
    }
}

export async function refreshUntouchedStarterCardsLanguage() {
    if (!S.db) return;
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

export async function seedFirstRunExperience() {
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
            content: t('onboardColumnText'),
            x: 455,
            y: 315,
            width: 265,
            height: 175,
            zIndex: 13,
            isTrash: false,
            createdAt: now + 3
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

export function centerCanvasInitial() {
    const viewport = document.getElementById('canvas-viewport');
    if (!viewport) return;
    S.canvasPanX = Math.round((viewport.clientWidth / 2) - 480);
    S.canvasPanY = Math.round((viewport.clientHeight / 2) - 290);
    updateCanvasTransform();
    scheduleSaveUIState();
}

export function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function showToast(msg) {
    const t = document.getElementById('toast'); document.getElementById('toast-msg').textContent = msg;
    t.classList.remove('translate-y-20', 'opacity-0'); clearTimeout(S.toastTimeout);
    S.toastTimeout = setTimeout(() => t.classList.add('translate-y-20', 'opacity-0'), 2600);
}
