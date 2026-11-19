import { clearSelection } from './canvasInteractions';
import { fetchAndRenderCards } from './cardRenderer';
import { drawConnections } from './connections';
import { getNextTopZIndex } from './contextMenu';
import { dbDelete, dbGet, dbGetAll, dbPut } from './db';
import { buildTrashDragGhostEl, buildUnsortedDragGhostEl, queueFloatingPhysicsDrag } from './dragDrop';
import { pushUndoSnapshot } from './history';
import { t } from './i18n';
import { extractLinkMetadata, getAssetObjectUrl, getLocalizedCardLabel, isDirectVideoUrl, isVideoFile, parseEmbedUrl, parseIframeEmbedCode, probeImageUrl, resolveDirectOrMetaImage, resolveKnownGifHostUrl, saveImageBlobToUnsorted, saveTextOrLinkToUnsorted, saveVideoBlobToUnsorted } from './mediaAndLinks';
import { pruneOrphanAssets } from './profileSettings';
import { playCozySound } from './sound';
import { S } from './state';
import { syncSelectionVisuals } from './toolbar';
import { applySidebarDomState, enterCardEditMode, escapeHtml, exitCardEditMode, saveUIState, showToast } from './uiState';

export function triggerImageUpload() { document.getElementById('image-file-input').click(); }

export async function handleFileInput(e) {
    let added = false;
    for (const f of e.target.files) {
        if (f.type.startsWith('image/')) {
            await saveImageBlobToUnsorted(f, f.name);
            added = true;
        } else if (isVideoFile(f)) {
            await saveVideoBlobToUnsorted(f, f.name);
            added = true;
        }
    }
    e.target.value = '';
    if (added) {
        await renderUnsortedDrawer(true);
        showToast(t('mediaAdded'));
    }
}

export async function quickCaptureSubmit(e) {
    e.preventDefault(); const input = document.getElementById('quick-input') as HTMLInputElement;
    if (!input.value.trim()) return;
    await saveTextOrLinkToUnsorted(input.value.trim()); input.value = ''; await renderUnsortedDrawer();
}

export async function moveUnsortedCardToCanvas(cardId) {
    const c = await dbGet('cards', cardId);
    if (!c) return;
    await pushUndoSnapshot();
    const vp = document.getElementById('canvas-viewport');
    const centerX = (-S.canvasPanX + vp.clientWidth / 2) / S.canvasScale - (c.width || 270) / 2;
    const centerY = (-S.canvasPanY + vp.clientHeight / 2) / S.canvasScale - (c.height || 170) / 2;
    c.boardId = S.currentBoardId;
    c.zIndex = getNextTopZIndex();
    c.x = Math.round(centerX);
    c.y = Math.round(centerY);
    await dbPut('cards', c);
    S.selectedUnsortedCardIds.delete(cardId);
    await fetchAndRenderCards();
    if (window.innerWidth < 768 && S.isSidebarOpen) toggleSidebar();
    showToast(t('addedToBoard'));
}

export async function renderUnsortedDrawer(shouldAutoOpen = false) {
    const listEl = document.getElementById('unsorted-list');
    const all = await dbGetAll('cards');
    const unsorted = all.filter(c => c.boardId === 'unsorted' && !c.isTrash).sort((a,b) => b.createdAt - a.createdAt);
    document.getElementById('unsorted-count').textContent = String(unsorted.length);
    
    // Abre automaticamente em desktop quando solicitado (ex: novo item colado) ou se o usuário ainda não definiu preferência explícita
    if (unsorted.length > 0 && !S.isSidebarOpen && window.innerWidth >= 768 && (shouldAutoOpen || !S.hasExplicitSidebarPref)) {
        S.isSidebarOpen = true;
        applySidebarDomState();
        saveUIState();
    }

    listEl.innerHTML = unsorted.length === 0 ? `<div class="text-xs text-zinc-500 text-center py-6">${escapeHtml(t('emptyLabel'))}</div>` : '';

    for (const card of unsorted) {
        const isSelected = S.selectedUnsortedCardIds.has(card.id);
        const el = document.createElement('div');
        el.dataset.id = card.id;
        el.className = 'relative flex flex-col cursor-grab group mb-4 transition-all select-none';

        const beginUnsortedPress = (ev, isTouch) => {
            if (ev.target.closest('button')) return;
            if (!isTouch && ev.button !== 0) return;
            ev.stopPropagation();

            if (!isTouch && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
                if (S.selectedUnsortedCardIds.has(card.id)) S.selectedUnsortedCardIds.delete(card.id);
                else S.selectedUnsortedCardIds.add(card.id);
                syncUnsortedSelectionVisuals();
            } else if (!S.selectedUnsortedCardIds.has(card.id)) {
                S.selectedUnsortedCardIds.clear();
                S.selectedUnsortedCardIds.add(card.id);
                syncUnsortedSelectionVisuals();
            }

            const dragIds = S.selectedUnsortedCardIds.has(card.id)
                ? Array.from(S.selectedUnsortedCardIds)
                : [card.id];
            const pt = isTouch ? ev.touches[0] : ev;
            const elRect = el.getBoundingClientRect();
            const grabX = Math.max(14, Math.min(elRect.width - 14, pt.clientX - elRect.left));
            const grabY = Math.max(14, Math.min(elRect.height - 14, pt.clientY - elRect.top));
            const grabRatioX = Math.max(0.08, Math.min(0.92, (pt.clientX - elRect.left) / Math.max(1, elRect.width)));
            const grabRatioY = Math.max(0.08, Math.min(0.92, (pt.clientY - elRect.top) / Math.max(1, elRect.height)));

            queueFloatingPhysicsDrag({
                source: 'unsorted',
                payload: { cardIds: dragIds, grabX, grabY, grabRatioX, grabRatioY },
                startX: pt.clientX,
                startY: pt.clientY,
                grabX,
                grabY,
                isTouch,
                createPreview: () => buildUnsortedDragGhostEl(el, dragIds.length),
                getSourceEls: () => dragIds
                    .map(id => document.querySelector(`#unsorted-list > div[data-id="${id}"]`))
                    .filter(Boolean)
            });
        };

        el.addEventListener('mousedown', (ev) => beginUnsortedPress(ev, false));
        el.addEventListener('touchstart', (ev) => {
            if (ev.touches.length === 1) beginUnsortedPress(ev, true);
        }, { passive: true });

        const quickAddBtn = `<button type="button" onclick="event.stopPropagation(); moveUnsortedCardToCanvas('${card.id}')" class="touch-visible absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 bg-[#141416]/90 hover:bg-zinc-100 text-zinc-300 hover:text-zinc-900 border border-white/10 rounded-md p-1 shadow transition-all z-10" title="${escapeHtml(t('addToBoardTitle'))}"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>`;

        if (card.type === 'image') {
            const imgUrl = card.assetId ? await getAssetObjectUrl(card.assetId) : card.content;
            el.innerHTML = `
                <div class="w-full flex justify-center relative">
                    ${quickAddBtn}
                    ${imgUrl
                        ? `<img src="${imgUrl}" referrerpolicy="no-referrer" class="w-full h-auto max-h-[300px] object-contain pointer-events-none transition-all ${isSelected ? 'outline outline-2 outline-white' : 'hover:brightness-90'}" draggable="false" alt="">`
                        : `<div class="w-full h-24 bg-[#141416] flex items-center justify-center text-zinc-500 text-[11px]">${escapeHtml(t('noPreview'))}</div>`}
                </div>
            `;
        } else if (card.type === 'video') {
            const videoUrl = card.assetId ? await getAssetObjectUrl(card.assetId) : card.content;
            el.innerHTML = `
                <div class="unsorted-text-box relative w-full bg-[#1c1c1f] rounded-[4px] overflow-hidden border ${isSelected ? 'border-white' : 'border-transparent hover:border-borderSubtle'} transition-colors">
                    ${quickAddBtn}
                    ${videoUrl
                        ? `<video src="${escapeHtml(videoUrl)}" muted playsinline preload="metadata" class="w-full h-32 object-cover bg-black pointer-events-none block"></video>`
                        : `<div class="w-full h-24 bg-[#141416] flex items-center justify-center text-zinc-500 text-[11px]">${escapeHtml(t('noPreview'))}</div>`}
                    <div class="px-2.5 py-2 flex items-center gap-1.5">
                        <svg class="w-3 h-3 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                        <span class="text-xs font-medium text-zinc-200 truncate">${escapeHtml(card.title || t('labelVideo'))}</span>
                    </div>
                </div>
            `;
        } else if (card.type === 'embed') {
            el.innerHTML = `
                <div class="unsorted-text-box relative w-full bg-[#1c1c1f] rounded-[4px] overflow-hidden border ${isSelected ? 'border-white' : 'border-transparent hover:border-borderSubtle'} transition-colors">
                    ${quickAddBtn}
                    ${card.imageUrl
                        ? `<div class="relative w-full h-28 bg-black overflow-hidden">
                                <img src="${escapeHtml(card.imageUrl)}" class="w-full h-full object-cover opacity-80 pointer-events-none" draggable="false" alt="">
                                <div class="absolute inset-0 flex items-center justify-center">
                                    <div class="w-8 h-8 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-white">
                                        <svg class="w-3.5 h-3.5 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                    </div>
                                </div>
                           </div>`
                        : ''}
                    <div class="p-2.5 pr-8 flex flex-col gap-1">
                        <div class="flex items-center gap-1.5">
                            <svg class="w-3 h-3 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                            <span class="text-xs font-medium text-zinc-200 truncate">${escapeHtml(card.title || t('labelEmbed'))}</span>
                        </div>
                        <div class="text-[11px] text-zinc-500 truncate">${escapeHtml(card.siteName || card.domain || t('labelEmbed'))}</div>
                    </div>
                </div>
            `;
        } else if (card.type === 'link' && card.imageUrl) {
            el.innerHTML = `
                <div class="unsorted-text-box relative w-full bg-[#1c1c1f] rounded-[4px] overflow-hidden border ${isSelected ? 'border-white' : 'border-transparent hover:border-borderSubtle'} transition-colors">
                    ${quickAddBtn}
                    <img src="${escapeHtml(card.imageUrl)}" class="w-full h-24 object-cover pointer-events-none border-b border-white/[0.06]" draggable="false" alt="">
                    <div class="p-2.5 pr-8 flex flex-col gap-1">
                        <div class="text-xs font-medium text-zinc-200 truncate">${escapeHtml(card.title)}</div>
                        <div class="text-[11px] text-zinc-500 truncate">${escapeHtml(card.siteName || card.domain || '')}</div>
                    </div>
                </div>
            `;
        } else {
            const summaryText = card.type === 'table' && card.tableData
                ? `${(card.tableData.headers || []).join(' · ')} (${(card.tableData.rows || []).length}x${(card.tableData.headers || []).length})`
                : (card.content || '');
            el.innerHTML = `
                <div class="unsorted-text-box relative w-full bg-[#1c1c1f] rounded-[4px] p-2.5 pr-8 flex flex-col gap-1.5 border ${isSelected ? 'border-white' : 'border-transparent hover:border-borderSubtle'} transition-colors">
                    ${quickAddBtn}
                    <div class="text-xs font-medium text-zinc-200 truncate">${escapeHtml(card.title || getLocalizedCardLabel(card.type))}</div>
                    ${summaryText ? `<div class="text-[11px] text-zinc-500 overflow-hidden" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escapeHtml(summaryText.substring(0,100))}</div>` : ''}
                </div>
            `;
        }
        listEl.appendChild(el);
    }
}

export function syncUnsortedSelectionVisuals() {
    document.querySelectorAll<HTMLElement>('#unsorted-list > div').forEach(el => {
        const id = el.dataset.id;
        const isSelected = S.selectedUnsortedCardIds.has(id);
        const img = el.querySelector('img');
        if (img && !el.querySelector('.unsorted-text-box')) {
            if (isSelected) img.classList.add('outline', 'outline-2', 'outline-white');
            else img.classList.remove('outline', 'outline-2', 'outline-white');
        }
        const textBox = el.querySelector('.unsorted-text-box');
        if (textBox) {
            if (isSelected) {
                textBox.classList.add('border-white');
                textBox.classList.remove('border-transparent');
            } else {
                textBox.classList.remove('border-white');
                textBox.classList.add('border-transparent');
            }
        }
    });
}

export async function deleteCard(id) {
    const c = await dbGet('cards', id);
    if (c) {
        await pushUndoSnapshot();
        const wasUnsorted = c.boardId === 'unsorted';
        c.isTrash = true; c.deletedAt = Date.now(); 
        S.selectedCardIds.delete(id); 
        await dbPut('cards', c); 
        await fetchAndRenderCards(); 
        await updateTrashBadge();
        playCozySound('trash');
        
        if (wasUnsorted) {
            const all = await dbGetAll('cards');
            const unsortedCount = all.filter(c => c.boardId === 'unsorted' && !c.isTrash).length;
            if (unsortedCount === 0 && S.isSidebarOpen) toggleSidebar();
        }
    }
}

export async function deleteSelectedCards() {
    document.getElementById('context-menu').style.display = 'none';
    if (S.selectedCardIds.size === 0) return;
    await pushUndoSnapshot();
    let count = 0;
    for (const id of S.selectedCardIds) {
        const c = await dbGet('cards', id);
        if (c && !c.isTrash) {
            c.isTrash = true;
            c.deletedAt = Date.now();
            await dbPut('cards', c);
            count++;
        }
    }
    S.selectedCardIds.clear();
    await fetchAndRenderCards();
    await updateTrashBadge();
    if (count > 0) {
        playCozySound('trash');
        showToast(t('movedToTrash'));
    }
}

export async function convertSelectedToDocument(explicitIds = null) {
    document.getElementById('context-menu').style.display = 'none';
    const ids = Array.isArray(explicitIds) && explicitIds.length > 0
        ? explicitIds
        : Array.from(S.selectedCardIds);
    if (ids.length === 0) return;
    await pushUndoSnapshot();
    let converted = 0;
    for (const id of ids) {
        const c = await dbGet('cards', id);
        if (c && c.type === 'sticky') {
            c.type = 'document';
            c.title = c.title || t('newDocTitle');
            c.width = 96;
            c.height = null;
            await dbPut('cards', c);
            converted++;
        }
    }
    if (converted > 0) {
        await fetchAndRenderCards();
        showToast(t('convertedToDoc'));
    }
}

export async function convertToDocument(id) {
    const ids = (S.selectedCardIds.has(id) && S.selectedCardIds.size > 1)
        ? Array.from(S.selectedCardIds)
        : [id];
    await convertSelectedToDocument(ids);
}

export async function updateLinkUrl(id, rawInput) {
    const trimmed = (rawInput || '').trim();
    if (!trimmed) return;
    
    const c = await dbGet('cards', id);
    if (!c) return;

    // 1. Verifica se é um embed code (<iframe ...>)
    const embedCode = parseIframeEmbedCode(trimmed);
    if (embedCode) {
        c.type = 'embed';
        c.embedUrl = embedCode.embedUrl;
        c.title = embedCode.title;
        c.domain = embedCode.domain;
        c.content = embedCode.sourceUrl || '';
        c.width = Math.max(c.width || 0, 340);
        c.height = 232;
        await dbPut('cards', c);
        await fetchAndRenderCards();
        showToast(t('convertedToEmbed'));
        return;
    }

    let url = trimmed;
    if (!/^(https?:\/\/|data:image\/)/i.test(url)) url = 'https://' + url;

    // 2. Verifica se é URL embedável (YouTube, Vimeo, Loom, Spotify, Dailymotion)
    const embedInfo = parseEmbedUrl(url);
    if (embedInfo) {
        c.type = 'embed';
        c.content = url;
        c.embedUrl = embedInfo.embedUrl;
        c.domain = embedInfo.domain;
        c.siteName = embedInfo.siteName;
        c.width = Math.max(c.width || 0, 340);
        c.height = 232;
        showToast(t('fetchingPreview'));
        const meta = await extractLinkMetadata(url);
        c.title = (meta.title && meta.title !== embedInfo.domain) ? meta.title : embedInfo.title;
        c.imageUrl = meta.imageUrl || embedInfo.imageUrl;
        await dbPut('cards', c);
        await fetchAndRenderCards();
        showToast(t('convertedToEmbed'));
        return;
    }

    // 3. Verifica se é URL direta de vídeo (.mp4, .webm, etc.)
    if (isDirectVideoUrl(url)) {
        c.type = 'video';
        c.content = url;
        c.title = t('webVideo');
        c.embedUrl = null;
        c.width = Math.max(c.width || 0, 320);
        c.height = null;
        await dbPut('cards', c);
        await fetchAndRenderCards();
        showToast(t('convertedToVideo'));
        return;
    }

    // 4. Verifica se é uma imagem ou GIF (inclui Giphy, Imgur gifv, parâmetros de CDN e probe via Image)
    const knownGif = resolveKnownGifHostUrl(url);
    const isImg = knownGif ? true : await probeImageUrl(url);

    if (isImg) {
        c.type = 'image';
        c.content = knownGif || url;
        c.title = t('webImage');
        c.embedUrl = null;
        c.height = null;
        c.imageUrl = null;
        c.videoUrl = null;
        c.isVideoLink = false;
        c.description = '';
        c.logoUrl = null;
        c.siteName = null;
        c.domain = null;
        await dbPut('cards', c);
        await fetchAndRenderCards();
        showToast(t('convertedToImage'));
        return;
    }

    // 5. Link normal: busca metadata rica estilo Milanote (e converte se o destino for GIF/imagem direto)
    c.type = 'link';
    c.embedUrl = null;
    c.content = url;
    showToast(t('fetchingPreview'));
    const meta = await extractLinkMetadata(url);
    const resolvedImg = resolveDirectOrMetaImage(url, meta, null);
    if (resolvedImg) {
        c.type = 'image';
        c.content = resolvedImg;
        c.title = t('webImage');
        c.embedUrl = null;
        c.height = null;
        c.imageUrl = null;
        c.videoUrl = null;
        c.isVideoLink = false;
        c.description = '';
        c.logoUrl = null;
        c.siteName = null;
        c.domain = null;
        await dbPut('cards', c);
        await fetchAndRenderCards();
        showToast(t('convertedToImage'));
        return;
    }
    c.title = meta.title;
    c.description = meta.description;
    c.domain = meta.domain;
    c.siteName = meta.siteName;
    c.imageUrl = meta.imageUrl;
    c.videoUrl = meta.videoUrl || null;
    c.isVideoLink = !!meta.isVideoLink;
    c.logoUrl = meta.logoUrl;
    await dbPut('cards', c);
    await fetchAndRenderCards();
}

export async function editLinkUrl(id) {
    const c = await dbGet('cards', id);
    if (c) {
        const currentVal = c.content || (c.embedUrl ? `<iframe src="${c.embedUrl}"></iframe>` : '');
        const newUrl = prompt(t('promptEditUrl'), currentVal);
        if (newUrl !== null && newUrl.trim() !== '' && newUrl !== currentVal) {
            await updateLinkUrl(id, newUrl);
        }
    }
}

export async function reorderTask(cardId, fromIndex, toIndex) {
    await moveTaskToCard(cardId, fromIndex, cardId, toIndex);
}

export async function moveTaskToCard(fromCardId, fromIndex, toCardId, toIndex) {
    S.draggedTaskPayload = null;
    if (fromCardId === toCardId) {
        const c = await dbGet('cards', fromCardId);
        if (c && c.tasks && c.tasks[fromIndex]) {
            const targetIdx = (toIndex === null || toIndex === undefined) ? c.tasks.length - 1 : toIndex;
            if (fromIndex !== targetIdx) {
                const [movedTask] = c.tasks.splice(fromIndex, 1);
                c.tasks.splice(targetIdx, 0, movedTask);
                await dbPut('cards', c);
                await fetchAndRenderCards();
            }
        }
        return;
    }

    const sourceCard = await dbGet('cards', fromCardId);
    const targetCard = await dbGet('cards', toCardId);
    if (sourceCard && sourceCard.tasks && sourceCard.tasks[fromIndex] && targetCard && targetCard.type === 'task') {
        const [movedTask] = sourceCard.tasks.splice(fromIndex, 1);
        targetCard.tasks = targetCard.tasks || [];
        if (toIndex !== null && toIndex !== undefined && toIndex >= 0 && toIndex <= targetCard.tasks.length) {
            targetCard.tasks.splice(toIndex, 0, movedTask);
        } else {
            targetCard.tasks.push(movedTask);
        }
        await dbPut('cards', sourceCard);
        await dbPut('cards', targetCard);
        await fetchAndRenderCards();
        showToast(t('taskMoved'));
    }
}

export async function importExternalCardsAsTasks(cardIds, targetCardId, insertIndex) {
    const targetCard = await dbGet('cards', targetCardId);
    if (!targetCard || targetCard.type !== 'task') return;
    targetCard.tasks = targetCard.tasks || [];

    const newTasks = [];
    for (const id of cardIds) {
        if (id === targetCardId) continue;
        const src = await dbGet('cards', id);
        if (!src) continue;
        if (src.type === 'task' && Array.isArray(src.tasks) && src.tasks.length > 0) {
            newTasks.push(...src.tasks.map(t => ({ text: t.text || '', completed: !!t.completed })));
        } else {
            const text = (src.content || src.title || '').trim();
            if (text) newTasks.push({ text, completed: false });
        }
        await dbDelete('cards', id);
    }

    if (newTasks.length > 0) {
        if (insertIndex !== null && insertIndex !== undefined && insertIndex >= 0 && insertIndex <= targetCard.tasks.length) {
            targetCard.tasks.splice(insertIndex, 0, ...newTasks);
        } else {
            targetCard.tasks.push(...newTasks);
        }
        await dbPut('cards', targetCard);
    }

    S.internalDragPayload = null;
    S.selectedUnsortedCardIds.clear();
    await fetchAndRenderCards();
    await renderUnsortedDrawer();
    if (newTasks.length > 0) showToast(t('addedToTodo'));
}

export async function addExternalTextAsTasks(targetCardId, rawText, insertIndex) {
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const targetCard = await dbGet('cards', targetCardId);
    if (!targetCard || targetCard.type !== 'task') return;
    targetCard.tasks = targetCard.tasks || [];

    const newTasks = lines.map(text => ({ text, completed: false }));
    if (insertIndex !== null && insertIndex !== undefined && insertIndex >= 0 && insertIndex <= targetCard.tasks.length) {
        targetCard.tasks.splice(insertIndex, 0, ...newTasks);
    } else {
        targetCard.tasks.push(...newTasks);
    }
    await dbPut('cards', targetCard);
    await fetchAndRenderCards();
    showToast(t('taskAdded'));
}

export function focusTaskInput(cardId, idx) {
    const cardEl = document.querySelector(`.interactive-card[data-id="${cardId}"]`);
    if (!cardEl) return;
    const row = cardEl.querySelector(`[data-task-index="${idx}"]`);
    if (!row) return;
    const inp = row.querySelector('.task-input') as HTMLInputElement | null;
    if (inp) {
        inp.classList.remove('pointer-events-none');
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
    }
}

export async function insertTaskAfter(cardId, idx, currentText) {
    const c = await dbGet('cards', cardId);
    if (!c) return;
    c.tasks = c.tasks || [];
    if (c.tasks[idx]) c.tasks[idx].text = currentText;
    const newIdx = idx + 1;
    c.tasks.splice(newIdx, 0, { text: '', completed: false });
    await dbPut('cards', c);
    await fetchAndRenderCards();
    focusTaskInput(cardId, newIdx);
}

export async function appendNewTask(cardId, text, refocusAddInput) {
    const c = await dbGet('cards', cardId);
    if (!c) return;
    c.tasks = c.tasks || [];
    c.tasks.push({ text, completed: false });
    await dbPut('cards', c);
    await fetchAndRenderCards();
    if (refocusAddInput) {
        const cardEl = document.querySelector(`.interactive-card[data-id="${cardId}"]`);
        const addInp = cardEl?.querySelector<HTMLElement>('.add-task-input');
        if (addInp) addInp.focus();
    }
}

export async function removeTaskAndFocusPrev(cardId, idx) {
    const c = await dbGet('cards', cardId);
    if (!c || !c.tasks || !c.tasks[idx]) return;
    c.tasks.splice(idx, 1);
    await dbPut('cards', c);
    await fetchAndRenderCards();
    if (c.tasks.length > 0) {
        focusTaskInput(cardId, Math.max(0, idx - 1));
    } else {
        const cardEl = document.querySelector(`.interactive-card[data-id="${cardId}"]`);
        const addInp = cardEl?.querySelector<HTMLElement>('.add-task-input');
        if (addInp) addInp.focus();
    }
}

export async function moveSelectedToUnsorted(explicitIds = null) {
    document.getElementById('context-menu').style.display = 'none';
    const ids = Array.isArray(explicitIds) && explicitIds.length > 0
        ? explicitIds
        : Array.from(S.selectedCardIds);
    if (ids.length === 0) return;
    await pushUndoSnapshot();
    let moved = 0;
    for (const id of ids) {
        const c = await dbGet('cards', id);
        if (c && c.boardId !== 'unsorted') {
            c.boardId = 'unsorted';
            await dbPut('cards', c);
            moved++;
        }
        S.selectedCardIds.delete(id);
    }
    if (moved > 0) {
        if (!S.isSidebarOpen) {
            S.isSidebarOpen = true;
            S.hasExplicitSidebarPref = true;
            applySidebarDomState();
            saveUIState();
        }
        await fetchAndRenderCards();
        playCozySound('unsorted');
        showToast(t('movedToUnsortedToast'));
    }
}

export async function moveToUnsorted(id) {
    const ids = (S.selectedCardIds.has(id) && S.selectedCardIds.size > 1)
        ? Array.from(S.selectedCardIds)
        : [id];
    await moveSelectedToUnsorted(ids);
}

export async function updateCardTitle(id, t) {
    const c = await dbGet('cards', id);
    if (c) {
        c.title = t;
        await dbPut('cards', c);
        if (c.type === 'subboard') {
            const b = await dbGet('boards', id);
            if (b) {
                b.title = t;
                await dbPut('boards', b);
            }
        }
    }
}

export async function updateCardContent(id, t) { const c = await dbGet('cards', id); if (c) { c.content = t; await dbPut('cards', c); } }

export async function toggleCommentResolved(id) {
    const c = await dbGet('cards', id);
    if (!c) return;
    await pushUndoSnapshot();
    c.resolved = !c.resolved;
    await dbPut('cards', c);
    await fetchAndRenderCards();
    playCozySound(c.resolved ? 'check' : 'uncheck');
}

export async function modifyCardTable(id, action) {
    const c = await dbGet('cards', id);
    if (!c || c.type !== 'table') return;
    await pushUndoSnapshot();
    const td = (c.tableData && Array.isArray(c.tableData.headers) && Array.isArray(c.tableData.rows))
        ? structuredClone(c.tableData)
        : { headers: [`${t('tableColPrefix')} 1`, `${t('tableColPrefix')} 2`, `${t('tableColPrefix')} 3`], rows: [['', '', ''], ['', '', '']] };
    const colCount = Math.max(1, td.headers.length);
    if (action === 'addRow') {
        td.rows.push(new Array(colCount).fill(''));
    } else if (action === 'addCol') {
        td.headers.push(`${t('tableColPrefix')} ${td.headers.length + 1}`);
        td.rows.forEach(r => r.push(''));
    } else if (action === 'removeRow' && td.rows.length > 1) {
        td.rows.pop();
    } else if (action === 'removeCol' && td.headers.length > 1) {
        td.headers.pop();
        td.rows.forEach(r => { if (r.length > td.headers.length) r.length = td.headers.length; });
    }
    c.tableData = td;
    const wasEditingThis = S.editingCardId === id;
    await dbPut('cards', c);
    await fetchAndRenderCards();
    if (wasEditingThis) {
        const updatedEl = document.querySelector(`.interactive-card[data-id="${id}"]`);
        if (updatedEl) enterCardEditMode(updatedEl);
    }
}

export async function updateTableHeaderCell(id, colIdx, value) {
    const c = await dbGet('cards', id);
    if (!c || c.type !== 'table') return;
    const td = c.tableData || { headers: [`${t('tableColPrefix')} 1`, `${t('tableColPrefix')} 2`, `${t('tableColPrefix')} 3`], rows: [['', '', ''], ['', '', '']] };
    if (td.headers[colIdx] === value) return;
    await pushUndoSnapshot();
    td.headers[colIdx] = value;
    c.tableData = td;
    await dbPut('cards', c);
    const mem = S.cards.find(cd => cd.id === id);
    if (mem) mem.tableData = structuredClone(td);
}

export async function updateTableBodyCell(id, rowIdx, colIdx, value) {
    const c = await dbGet('cards', id);
    if (!c || c.type !== 'table') return;
    const td = c.tableData || { headers: [`${t('tableColPrefix')} 1`, `${t('tableColPrefix')} 2`, `${t('tableColPrefix')} 3`], rows: [['', '', ''], ['', '', '']] };
    if (!td.rows[rowIdx]) return;
    if (td.rows[rowIdx][colIdx] === value) return;
    await pushUndoSnapshot();
    td.rows[rowIdx][colIdx] = value;
    c.tableData = td;
    await dbPut('cards', c);
    const mem = S.cards.find(cd => cd.id === id);
    if (mem) mem.tableData = structuredClone(td);
}

export async function toggleTask(id, i) {
    const c = await dbGet('cards', id);
    if (c && c.tasks && c.tasks[i]) {
        await pushUndoSnapshot();
        c.tasks[i].completed = !c.tasks[i].completed;
        const isNowCompleted = !!c.tasks[i].completed;
        const allCompleted = isNowCompleted && c.tasks.length > 0 && c.tasks.every(taskItem => !!taskItem.completed);
        await dbPut('cards', c);
        await fetchAndRenderCards();
        if (allCompleted) playCozySound('allTasksDone');
        else if (isNowCompleted) playCozySound('check');
        else playCozySound('uncheck');
    }
}

export async function updateTaskText(id, i, t) { const c = await dbGet('cards', id); if (c && c.tasks[i]) { c.tasks[i].text = t; await dbPut('cards', c); } }

export async function updateTaskTextLive(id, i, t) {
    const cardInMem = S.cards.find(c => c.id === id);
    if (cardInMem && cardInMem.tasks && cardInMem.tasks[i]) cardInMem.tasks[i].text = t;
    await updateTaskText(id, i, t);
}

export async function openTrashModal() { await renderTrashList(); document.getElementById('trash-modal').classList.remove('hidden'); }

export function closeTrashModal() { document.getElementById('trash-modal').classList.add('hidden'); }

export async function renderTrashList() {
    const list = document.getElementById('trash-list');
    const all = await dbGetAll('cards');
    const trash = all.filter(c => c.isTrash).sort((a,b) => b.deletedAt - a.deletedAt);
    
    if (trash.length === 0) {
        list.innerHTML = `<div class="text-xs text-zinc-500 text-center py-10 flex flex-col items-center"><svg class="w-8 h-8 mb-2 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>${escapeHtml(t('trashIsEmpty'))}</div>`;
        return;
    }

    // Agrupar por data
    const groups = {};
    const today = new Date();
    today.setHours(0,0,0,0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    trash.forEach(c => {
        const d = new Date(c.deletedAt);
        d.setHours(0,0,0,0);
        let label = d.getTime() === today.getTime() ? t('today') : d.getTime() === yesterday.getTime() ? t('yesterday') : d.toLocaleDateString();
        if (!groups[label]) groups[label] = [];
        groups[label].push(c);
    });

    list.innerHTML = '';
    
    for (const [dateLabel, items] of Object.entries(groups) as [string, any[]][]) {
        const groupEl = document.createElement('div');
        groupEl.className = 'space-y-3';
        groupEl.innerHTML = `<div class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider sticky top-0 bg-[#18181b] py-2 z-10">${dateLabel}</div>`;
        
        for (const card of items) {
            const el = document.createElement('div');
            el.className = 'trash-item relative rounded-md p-2.5 cursor-grab group mb-2 select-none';

            const beginTrashPress = (ev, isTouch) => {
                if (ev.target.closest('button')) return;
                if (!isTouch && ev.button !== 0) return;
                ev.stopPropagation();
                const pt = isTouch ? ev.touches[0] : ev;
                const rect = el.getBoundingClientRect();
                const grabX = Math.max(14, Math.min(rect.width - 14, pt.clientX - rect.left));
                const grabY = Math.max(14, Math.min(rect.height - 14, pt.clientY - rect.top));
                const grabRatioX = Math.max(0.08, Math.min(0.92, (pt.clientX - rect.left) / Math.max(1, rect.width)));
                const grabRatioY = Math.max(0.08, Math.min(0.92, (pt.clientY - rect.top) / Math.max(1, rect.height)));
                queueFloatingPhysicsDrag({
                    source: 'trash',
                    payload: { cardId: card.id, grabX, grabY, grabRatioX, grabRatioY },
                    startX: pt.clientX,
                    startY: pt.clientY,
                    grabX,
                    grabY,
                    isTouch,
                    createPreview: () => buildTrashDragGhostEl(el),
                    sourceEls: [el]
                });
            };

            el.addEventListener('mousedown', (ev) => beginTrashPress(ev, false));
            el.addEventListener('touchstart', (ev) => {
                if (ev.touches.length === 1) beginTrashPress(ev, true);
            }, { passive: true });

            if (card.type === 'image') {
                const imgUrl = card.assetId ? await getAssetObjectUrl(card.assetId) : card.content;
                el.innerHTML = `
                    <div class="w-full relative">
                        ${imgUrl ? `<img src="${imgUrl}" class="w-full h-auto max-h-[200px] object-contain rounded-sm pointer-events-none" draggable="false">` : `<div class="w-full h-20 bg-[#141416] flex items-center justify-center text-zinc-500 text-[10px]">${escapeHtml(t('noImage'))}</div>`}
                        <div class="mt-2 text-[11px] text-zinc-300 truncate">${escapeHtml(card.title)}</div>
                        <div class="touch-visible absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-black/60 rounded p-1">
                            <button onclick="event.stopPropagation(); restoreCard('${card.id}')" class="text-emerald-400 hover:text-emerald-300 p-1" title="${escapeHtml(t('restoreTitle'))}"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></button>
                            <button onclick="event.stopPropagation(); permanentDelete('${card.id}')" class="text-red-400 hover:text-red-300 p-1" title="${escapeHtml(t('deletePermTitle'))}"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                        </div>
                    </div>
                `;
            } else if (card.type === 'video') {
                const videoUrl = card.assetId ? await getAssetObjectUrl(card.assetId) : card.content;
                el.innerHTML = `
                    <div class="w-full relative">
                        ${videoUrl ? `<video src="${escapeHtml(videoUrl)}" muted playsinline preload="metadata" class="w-full h-28 object-cover rounded-sm bg-black pointer-events-none"></video>` : `<div class="w-full h-20 bg-[#141416] flex items-center justify-center text-zinc-500 text-[10px]">${escapeHtml(t('noPreview'))}</div>`}
                        <div class="mt-2 text-[11px] text-zinc-300 truncate">${escapeHtml(card.title || t('labelVideo'))}</div>
                        <div class="touch-visible absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-black/60 rounded p-1">
                            <button onclick="event.stopPropagation(); restoreCard('${card.id}')" class="text-emerald-400 hover:text-emerald-300 p-1" title="${escapeHtml(t('restoreTitle'))}"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></button>
                            <button onclick="event.stopPropagation(); permanentDelete('${card.id}')" class="text-red-400 hover:text-red-300 p-1" title="${escapeHtml(t('deletePermTitle'))}"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                        </div>
                    </div>
                `;
            } else {
                const subText = card.type === 'embed'
                    ? (card.siteName || card.domain || card.embedUrl || '')
                    : card.type === 'table' && card.tableData
                        ? `${(card.tableData.headers || []).join(' · ')} (${(card.tableData.rows || []).length}x${(card.tableData.headers || []).length})`
                        : (card.content || '');
                el.innerHTML = `
                    <div class="flex flex-col gap-1 w-full">
                        <div class="text-xs font-medium text-zinc-300 truncate">${escapeHtml(card.title || getLocalizedCardLabel(card.type))}</div>
                        ${subText ? `<div class="text-[11px] text-zinc-500 line-clamp-2">${escapeHtml(subText.substring(0,80))}</div>` : ''}
                        <div class="touch-visible absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-black/60 rounded p-1">
                            <button onclick="event.stopPropagation(); restoreCard('${card.id}')" class="text-emerald-400 hover:text-emerald-300 p-1" title="${escapeHtml(t('restoreTitle'))}"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></button>
                            <button onclick="event.stopPropagation(); permanentDelete('${card.id}')" class="text-red-400 hover:text-red-300 p-1" title="${escapeHtml(t('deletePermTitle'))}"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                        </div>
                    </div>
                `;
            }
            groupEl.appendChild(el);
        }
        list.appendChild(groupEl);
    }
}

export async function restoreCard(id) {
    const c = await dbGet('cards', id);
    if (c) {
        await pushUndoSnapshot();
        c.isTrash = false;
        c.boardId = S.currentBoardId;
        await dbPut('cards', c);
        await renderTrashList();
        await fetchAndRenderCards();
        await updateTrashBadge();
        playCozySound('restore');
    }
}

export async function permanentDelete(id) { await dbDelete('cards', id); await pruneOrphanAssets(); await renderTrashList(); await updateTrashBadge(); }

export async function emptyTrash() { const all = await dbGetAll('cards'); for (const c of all) if (c.isTrash) await dbDelete('cards', c.id); await pruneOrphanAssets(); await renderTrashList(); await updateTrashBadge(); }

export async function updateTrashBadge() { const all = await dbGetAll('cards'); const n = all.filter(c => c.isTrash).length; const b = document.getElementById('trash-badge'); if (n > 0) { b.textContent = String(n); b.classList.remove('hidden'); } else b.classList.add('hidden'); }

export function toggleSidebar() {
    S.isSidebarOpen = !S.isSidebarOpen;
    S.hasExplicitSidebarPref = true;
    applySidebarDomState();
    saveUIState();
}

export function setupSearch() {
    document.getElementById('search-input').addEventListener('input', (e: any) => { S.searchQuery = e.target?.value || ''; fetchAndRenderCards(); });
}

export async function openDocumentModal(id) {
    exitCardEditMode();
    clearSelection();
    if (S.selectedConnectionId) {
        S.selectedConnectionId = null;
        drawConnections();
        syncSelectionVisuals();
    }
    S.activeDocId = id;
    const c = await dbGet('cards', id);
    if (!c) return;
    
    (document.getElementById('doc-title-input') as HTMLInputElement).value = c.title || t('newDocTitle');
    document.getElementById('doc-editor').innerHTML = c.content || '';
    updateDocWordCount();
    
    document.getElementById('document-modal').classList.remove('hidden');
}

export function closeDocumentModal() {
    document.getElementById('document-modal').classList.add('hidden');
    S.activeDocId = null;
    fetchAndRenderCards(); // Atualiza a contagem de palavras no card
}

export function updateDocWordCount() {
    const text = document.getElementById('doc-editor').innerText || '';
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    document.getElementById('doc-word-count').textContent = `${words} ${words === 1 ? t('wordSingular') : t('wordPlural')}`;
}

export async function saveDocument() {
    if (!S.activeDocId) return;
    const c = await dbGet('cards', S.activeDocId);
    if (c) {
        c.title = (document.getElementById('doc-title-input') as HTMLInputElement).value;
        c.content = document.getElementById('doc-editor').innerHTML;
        await dbPut('cards', c);
    }
}

export function promptDocLink() {
    const url = prompt(t('promptDocUrl'));
    if (url) document.execCommand('createLink', false, url);
}
