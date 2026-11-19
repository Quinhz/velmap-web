// ==========================================
// 4. MENU DE CONTEXTO
// ==========================================
function openContextMenuAt(clientX, clientY, targetEl) {
    const viewport = document.getElementById('canvas-viewport');
    const menu = document.getElementById('context-menu');
    const targetCardEl = targetEl && targetEl.closest ? targetEl.closest('.interactive-card') : null;
    let html = '';

    if (targetCardEl) {
        const cardId = targetCardEl.dataset.id;
        if (!selectedCardIds.has(cardId)) {
            selectedCardIds.clear();
            selectedCardIds.add(cardId);
            syncSelectionVisuals();
        }

        const selectedIdsArr = Array.from(selectedCardIds);
        const count = selectedIdsArr.length;
        const isMulti = count > 1;
        const selectedCards = selectedIdsArr.map(id => cards.find(c => c.id === id)).filter(Boolean);
        const selectedImageCards = selectedCards.filter(c => c.type === 'image');
        const downloadImagesOption = selectedImageCards.length > 0
            ? `<div class="context-menu-item" onclick="downloadSelectedImages()">${selectedImageCards.length === 1 ? t('downloadImage') : t('downloadImagesCount', { n: selectedImageCards.length })}</div>`
            : '';
        const allStickies = selectedCards.length > 0 && selectedCards.every(c => c.type === 'sticky');
        const convertOption = allStickies
            ? `<div class="context-menu-item" onclick="convertSelectedToDocument()">${isMulti ? t('convertCardsToDocCount', { n: count }) : t('convertToDocument')}</div>`
            : '';
        const connectLinesOption = isMulti
            ? `<div class="context-menu-item" onclick="connectSelectedWithLines()">${t('connectWithLines')}</div>`
            : '';

        html = `
            <div class="context-menu-item" onclick="deleteSelectedCards()">${isMulti ? t('deleteCardsCount', { n: count }) : t('deleteCard')} <kbd>Del</kbd></div>
            <div class="context-menu-item" onclick="moveSelectedToUnsorted()">${isMulti ? t('moveCardsUnsortedCount', { n: count }) : t('moveToUnsorted')}</div>
            ${downloadImagesOption}
            ${connectLinesOption}
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
        const cursorCanvasX = Math.round((clientX - rect.left - canvasPanX) / canvasScale);
        const cursorCanvasY = Math.round((clientY - rect.top - canvasPanY) / canvasScale);
        const spawnX = Math.round(cursorCanvasX - 110);
        const spawnY = Math.round(cursorCanvasY - 70);
        const hasClipboard = Boolean(velmapClipboard && Array.isArray(velmapClipboard.cards) && velmapClipboard.cards.length > 0);
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

function setupContextMenu() {
    const viewport = document.getElementById('canvas-viewport');
    const menu = document.getElementById('context-menu');

    window.addEventListener('click', (e) => {
        if (e.target.offsetParent !== menu) menu.style.display = 'none';
        const bgPop = document.getElementById('board-bg-popover');
        if (bgPop && !bgPop.classList.contains('hidden') && !bgPop.contains(e.target) && !menu.contains(e.target)) {
            bgPop.classList.add('hidden');
        }
        const expPop = document.getElementById('export-popover');
        const expBtn = document.getElementById('header-export-btn');
        if (expPop && !expPop.classList.contains('hidden') && !expPop.contains(e.target) && (!expBtn || !expBtn.contains(e.target))) {
            expPop.classList.add('hidden');
        }
    });
    window.addEventListener('touchstart', (e) => {
        if (!e.target.closest('#context-menu')) menu.style.display = 'none';
        const bgPop = document.getElementById('board-bg-popover');
        if (bgPop && !bgPop.classList.contains('hidden') && !e.target.closest('#board-bg-popover')) {
            bgPop.classList.add('hidden');
        }
        const expPop = document.getElementById('export-popover');
        if (expPop && !expPop.classList.contains('hidden') && !e.target.closest('#export-popover') && !e.target.closest('#header-export-btn')) {
            expPop.classList.add('hidden');
        }
    }, { passive: true });

    viewport.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        lastMouseClientX = e.clientX;
        lastMouseClientY = e.clientY;
        openContextMenuAt(e.clientX, e.clientY, e.target);
    });
}

function selectAllCards() {
    document.getElementById('context-menu').style.display = 'none';
    cards.forEach(c => selectedCardIds.add(c.id));
    syncSelectionVisuals();
}

async function resolveImageCardDownloadBlob(card) {
    if (card.assetId) {
        const asset = await dbGet('assets', card.assetId);
        if (asset && asset.blob) return { blob: asset.blob, fallbackUrl: null };
    }
    const url = card.content;
    if (!url) return null;
    try {
        const res = await fetch(url, { mode: 'cors' });
        if (res.ok) {
            const blob = await res.blob();
            if (blob && blob.size > 0) return { blob, fallbackUrl: url };
        }
    } catch (_) {}
    return { blob: null, fallbackUrl: url };
}

function getImageExtensionFromMimeOrUrl(mime, url, title) {
    const m = (mime || '').toLowerCase();
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    if (m.includes('webp')) return 'webp';
    if (m.includes('gif')) return 'gif';
    if (m.includes('svg')) return 'svg';
    if (m.includes('png')) return 'png';
    const ref = `${title || ''} ${url || ''}`;
    const extMatch = ref.match(/\.(png|jpe?g|webp|gif|svg|avif)(?:[?#\s]|$)/i);
    if (extMatch) return extMatch[1].toLowerCase().replace('jpeg', 'jpg');
    return 'png';
}

function buildDownloadFilename(rawTitle, ext, fallbackBase) {
    const clean = (rawTitle || fallbackBase || 'velmap-image')
        .replace(/\.(png|jpe?g|webp|gif|svg|avif)$/i, '')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .trim() || 'velmap-image';
    return `${clean}.${ext}`;
}

async function downloadSelectedImages() {
    document.getElementById('context-menu').style.display = 'none';
    const ids = Array.from(selectedCardIds);
    const imgCards = ids
        .map(id => cards.find(c => c.id === id))
        .filter(c => c && c.type === 'image');
    if (imgCards.length === 0) {
        showToast(t('noDownloadableImages'));
        return;
    }

    let downloaded = 0;
    for (let i = 0; i < imgCards.length; i++) {
        const card = imgCards[i];
        const info = await resolveImageCardDownloadBlob(card);
        if (!info) continue;
        const ext = getImageExtensionFromMimeOrUrl(info.blob?.type, info.fallbackUrl, card.title);
        const filename = buildDownloadFilename(card.title, ext, `velmap-image-${i + 1}`);
        const a = document.createElement('a');
        if (info.blob) {
            const objUrl = URL.createObjectURL(info.blob);
            a.href = objUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(objUrl), 2500);
            downloaded++;
        } else if (info.fallbackUrl) {
            a.href = info.fallbackUrl;
            a.download = filename;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            a.remove();
            downloaded++;
        }
        if (i < imgCards.length - 1) {
            await new Promise(r => setTimeout(r, 140));
        }
    }

    if (downloaded === 1) showToast(t('downloadedImageToast'));
    else if (downloaded > 1) showToast(t('downloadedImagesToast', { n: downloaded }));
    else showToast(t('noDownloadableImages'));
}

async function connectSelectedWithLines() {
    document.getElementById('context-menu').style.display = 'none';
    const ids = Array.from(selectedCardIds);
    const items = ids
        .map(id => {
            const card = cards.find(c => c.id === id);
            const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
            if (!card || !el) return null;
            const b = getCardConnectionBounds(el);
            return {
                id,
                cx: b.left + b.width / 2,
                cy: b.top + b.height / 2
            };
        })
        .filter(Boolean);
    if (items.length < 2) return;

    // Order chain cleanly via nearest-neighbor starting from top-leftmost card
    items.sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy));
    const ordered = [items.shift()];
    while (items.length > 0) {
        const last = ordered[ordered.length - 1];
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < items.length; i++) {
            const d = Math.hypot(items[i].cx - last.cx, items[i].cy - last.cy);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        ordered.push(items.splice(bestIdx, 1)[0]);
    }

    await pushUndoSnapshot();
    let createdCount = 0;
    for (let i = 0; i < ordered.length - 1; i++) {
        const a = ordered[i].id;
        const b = ordered[i + 1].id;
        const alreadyExists = connections.some(c =>
            (c.fromId === a && c.toId === b) || (c.fromId === b && c.toId === a)
        );
        if (alreadyExists) continue;
        const connObj = {
            id: 'conn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) + '_' + i,
            boardId: currentBoardId,
            fromId: a,
            toId: b,
            startMarker: 'none',
            endMarker: 'none',
            color: '#71717a',
            weight: 2,
            isDashed: false
        };
        await dbPut('connections', connObj);
        connections.push(connObj);
        createdCount++;
    }
    if (createdCount > 0) {
        drawConnections();
    }
}

function getNextTopZIndex() {
    const active = cards.filter(c => !c.isTrash);
    let maxZ = 10;
    for (const c of active) {
        if (typeof c.zIndex === 'number' && c.zIndex > maxZ) maxZ = c.zIndex;
    }
    return maxZ + 1;
}

async function reorderCardLayer(cardIdsOrId, direction) {
    const targetIds = new Set(Array.isArray(cardIdsOrId) ? cardIdsOrId : [cardIdsOrId]);
    const sourceList = (allSystemCards && allSystemCards.length ? allSystemCards : cards)
        .filter(c => c.boardId === currentBoardId && !c.isTrash);
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

async function bringToFront(cardId) {
    const ids = selectedCardIds.has(cardId) ? Array.from(selectedCardIds) : [cardId];
    await reorderCardLayer(ids, 'front');
}

async function sendToBack(cardId) {
    const ids = selectedCardIds.has(cardId) ? Array.from(selectedCardIds) : [cardId];
    await reorderCardLayer(ids, 'back');
}

async function bringSelectedToFront() {
    const ids = Array.from(selectedCardIds);
    if (ids.length > 0) await reorderCardLayer(ids, 'front');
}

async function sendSelectedToBack() {
    const ids = Array.from(selectedCardIds);
    if (ids.length > 0) await reorderCardLayer(ids, 'back');
}

// ==========================================
// 5. BARRA DE FERRAMENTAS CONTEXTUAL
// ==========================================
function syncSelectionVisuals() {
    document.body.classList.toggle('multi-selection-active', selectedCardIds.size > 1);
    const contentLayer = document.getElementById('canvas-content');
    contentLayer.querySelectorAll('.interactive-card').forEach(el => {
        const isBoardNode = el.classList.contains('board-node');
        const isDocNode = el.classList.contains('doc-node');
        const isImage = el.dataset.type === 'image';
        
        if (selectedCardIds.has(el.dataset.id)) {
            if (isBoardNode) el.classList.add('board-node-selected');
            else if (isDocNode) el.classList.add('doc-node-selected');
            else if (isImage) el.classList.add('image-selected');
            else el.classList.add('card-selected');
        } else {
            el.classList.remove('board-node-selected', 'doc-node-selected', 'image-selected', 'card-selected');
        }
    });

    // Alterna a Toolbar Esquerda se um subboard for selecionado
    const leftToolbar = document.getElementById('left-toolbar');
    const defaultToolbar = document.getElementById('default-toolbar');
    const contextToolbar = document.getElementById('contextual-toolbar');
    const connToolbar = document.getElementById('connection-toolbar');

    // Se tiver conexão selecionada, mostra a toolbar de conexão (mantendo a lixeira fixa embaixo)
    if (selectedConnectionId) {
        if (leftToolbar) leftToolbar.classList.add('mobile-context-dock');
        defaultToolbar.classList.add('hidden');
        contextToolbar.classList.add('hidden');
        contextToolbar.classList.remove('flex');
        connToolbar.classList.remove('hidden');
        connToolbar.classList.add('flex');
        
        // Sincroniza UI da Toolbar
        const conn = connections.find(c => c.id === selectedConnectionId);
        if (conn) {
            const startBtn = document.getElementById('btn-start-marker');
            const endBtn = document.getElementById('btn-end-marker');
            const weightBtn = document.getElementById('btn-conn-weight');
            const labelBtn = document.getElementById('btn-conn-label');
            
            if (startBtn) {
                const isActive = conn.startMarker === 'arrow';
                const svg = startBtn.querySelector('svg');
                if (svg) svg.classList.remove('hidden');
                startBtn.className = isActive
                    ? 'w-6 h-6 rounded-[4px] bg-white/10 mb-1 flex items-center justify-center border border-white/80 text-white transition-all'
                    : 'w-6 h-6 rounded-[4px] bg-zinc-800/70 mb-1 flex items-center justify-center border border-white/10 text-zinc-500 transition-all';
            }
            if (endBtn) {
                const isActive = conn.endMarker !== 'none';
                const svg = endBtn.querySelector('svg');
                if (svg) svg.classList.remove('hidden');
                endBtn.className = isActive
                    ? 'w-6 h-6 rounded-[4px] bg-white/10 mb-1 flex items-center justify-center border border-white/80 text-white transition-all'
                    : 'w-6 h-6 rounded-[4px] bg-zinc-800/70 mb-1 flex items-center justify-center border border-white/10 text-zinc-500 transition-all';
            }
            
            if (weightBtn) {
                const w = conn.weight || 2;
                weightBtn.innerHTML = `<div class="w-4 border-b border-zinc-400" style="border-bottom-width: ${w}px"></div>`;
            }
            if (labelBtn) {
                labelBtn.style.color = conn.label ? '#ffffff' : 'inherit';
            }
        }
        return;
    } else {
        connToolbar.classList.add('hidden');
        connToolbar.classList.remove('flex');
    }

    if (selectedCardIds.size === 1) {
        const selectedId = Array.from(selectedCardIds)[0];
        const card = cards.find(c => c.id === selectedId);
        if (card && card.type === 'subboard') {
            if (leftToolbar) leftToolbar.classList.add('mobile-context-dock');
            defaultToolbar.classList.add('hidden');
            contextToolbar.classList.remove('hidden');
            contextToolbar.classList.add('flex');
            
            // Atualiza o botão de ícone na toolbar
            const iconBtn = document.getElementById('btn-board-icon');
            if (iconBtn) {
                if (card.iconAssetId) {
                    iconBtn.innerHTML = '<div class="w-3 h-3 bg-zinc-600 rounded-sm"></div>';
                    getAssetObjectUrl(card.iconAssetId).then(url => {
                        if (url && selectedCardIds.has(card.id)) {
                            iconBtn.innerHTML = `<img src="${url}" class="w-full h-full object-cover rounded-sm" />`;
                        }
                    });
                } else if (card.icon && !card.icon.includes('blob:')) {
                    iconBtn.innerHTML = card.icon;
                } else {
                    iconBtn.innerHTML = '<div class="w-3 h-3 bg-zinc-600 rounded-sm"></div>';
                }
            }
            return;
        }
    }

    // Retorna ao padrão
    if (leftToolbar) leftToolbar.classList.remove('mobile-context-dock');
    defaultToolbar.classList.remove('hidden');
    contextToolbar.classList.add('hidden');
    contextToolbar.classList.remove('flex');
}

async function setBoardColor(color) {
    const selectedId = Array.from(selectedCardIds)[0];
    const c = await dbGet('cards', selectedId);
    if (c) {
        c.color = color;
        await dbPut('cards', c);
        await fetchAndRenderCards();
    }
}

const BOARD_ICONS = [
    null,
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3a9 9 0 1 0 0 18 2.2 2.2 0 0 0 2.2-2.2c0-.6-.2-1.1-.6-1.5-.3-.4-.5-.9-.5-1.4A2 2 0 0 1 15 14h2.5A3.5 3.5 0 0 0 21 10.5C21 6.3 17 3 12 3z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2.5h5L16 6"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><polygon points="10 9 16 12 10 15"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/><line x1="14" y1="5" x2="10" y2="19"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.7.5 1.2 1.3 1.4 2.1h4.2c.2-.8.7-1.6 1.4-2.1A6 6 0 0 0 12 3z"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="6"/><line x1="16" y1="3" x2="16" y2="6"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1z"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 8h12l1 12H5z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    '<svg class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.5-8.5-9A4.8 4.8 0 0 1 12 6.5 4.8 4.8 0 0 1 20.5 11C19 15.5 12 20 12 20z"/></svg>'
];

function openIconPicker(e) {
    const popover = document.getElementById('icon-picker-popover');
    const grid = document.getElementById('icon-picker-grid');
    
    // Popula grid
    grid.innerHTML = BOARD_ICONS.slice(1).filter(Boolean).map((icon) => {
        return `<button onclick="setBoardIcon('${encodeURIComponent(icon)}')" class="w-full aspect-square rounded-md bg-[#2a2a2d] hover:bg-[#333338] border border-borderSubtle flex items-center justify-center text-zinc-400 hover:text-white transition-colors">${icon}</button>`;
    }).join('');
    
    // Posiciona respeitando limites da tela (inclusive acima do dock flutuante mobile)
    popover.classList.remove('hidden');
    const rect = e.currentTarget.getBoundingClientRect();
    const popW = popover.offsetWidth || 240;
    const popH = popover.offsetHeight || 340;
    const isBottomDock = rect.top > window.innerHeight * 0.55;
    const rawLeft = isBottomDock ? rect.left : rect.right + 10;
    const rawTop = isBottomDock ? rect.top - popH - 10 : rect.top;
    const left = Math.min(Math.max(8, rawLeft), Math.max(8, window.innerWidth - popW - 8));
    const top = Math.min(Math.max(8, rawTop), Math.max(8, window.innerHeight - popH - 8));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

async function setBoardIcon(encodedIcon) {
    const selectedId = Array.from(selectedCardIds)[0];
    const c = await dbGet('cards', selectedId);
    if (c) {
        c.icon = decodeURIComponent(encodedIcon);
        c.iconAssetId = null;
        await dbPut('cards', c);
        await pruneOrphanAssets();
        await fetchAndRenderCards();
        syncSelectionVisuals();
        document.getElementById('icon-picker-popover').classList.add('hidden');
    }
}

async function removeBoardIcon() {
    const selectedId = Array.from(selectedCardIds)[0];
    const c = await dbGet('cards', selectedId);
    if (c) {
        c.icon = null;
        c.iconAssetId = null;
        await dbPut('cards', c);
        await pruneOrphanAssets();
        await fetchAndRenderCards();
        syncSelectionVisuals();
        document.getElementById('icon-picker-popover').classList.add('hidden');
    }
}

function triggerIconUpload() { document.getElementById('icon-file-input').click(); }

async function promptIconUrl() {
    const url = prompt(t('promptIconUrl'));
    if (url) await setBoardIcon(encodeURIComponent(`<img src="${url}" class="w-8 h-8 object-contain" />`));
}

async function handleIconFileInput(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const selectedId = Array.from(selectedCardIds)[0];
    const c = selectedId ? await dbGet('cards', selectedId) : null;
    if (!c) return;
    const assetId = 'asset_icon_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await dbPut('assets', { id: assetId, blob: file });
    c.iconAssetId = assetId;
    c.icon = null;
    await dbPut('cards', c);
    await pruneOrphanAssets();
    await fetchAndRenderCards();
    syncSelectionVisuals();
    document.getElementById('icon-picker-popover')?.classList.add('hidden');
}

function focusSelectedBoardTitle() {
    const selectedId = Array.from(selectedCardIds)[0];
    const el = document.querySelector(`.interactive-card[data-id="${selectedId}"]`);
    if (el) {
        const input = el.querySelector('.board-title-input');
        if (input) input.focus();
    }
}

