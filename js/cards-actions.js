// ==========================================
// 10. AÇÕES RESTANTES E LIXEIRA
// ==========================================
function triggerImageUpload() { document.getElementById('image-file-input').click(); }
async function handleFileInput(e) {
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

async function quickCaptureSubmit(e) {
    e.preventDefault(); const input = document.getElementById('quick-input');
    if (!input.value.trim()) return;
    await saveTextOrLinkToUnsorted(input.value.trim()); input.value = ''; await renderUnsortedDrawer();
}

async function moveUnsortedCardToCanvas(cardId) {
    const c = await dbGet('cards', cardId);
    if (!c) return;
    await pushUndoSnapshot();
    const vp = document.getElementById('canvas-viewport');
    const centerX = (-canvasPanX + vp.clientWidth / 2) / canvasScale - (c.width || 270) / 2;
    const centerY = (-canvasPanY + vp.clientHeight / 2) / canvasScale - (c.height || 170) / 2;
    c.boardId = currentBoardId;
    c.columnId = null;
    c.columnOrder = null;
    c.zIndex = getNextTopZIndex();
    c.x = Math.round(centerX);
    c.y = Math.round(centerY);
    await dbPut('cards', c);
    selectedUnsortedCardIds.delete(cardId);
    await fetchAndRenderCards();
    if (window.innerWidth < 768 && isSidebarOpen) toggleSidebar();
    showToast(t('addedToBoard'));
}

async function renderUnsortedDrawer(shouldAutoOpen = false) {
    const listEl = document.getElementById('unsorted-list');
    const all = await dbGetAll('cards');
    const unsorted = all.filter(c => c.boardId === 'unsorted' && !c.isTrash).sort((a,b) => b.createdAt - a.createdAt);
    document.getElementById('unsorted-count').textContent = unsorted.length;
    const mobUnsorted = document.getElementById('mobile-unsorted-count');
    if (mobUnsorted) {
        if (unsorted.length > 0) {
            mobUnsorted.textContent = unsorted.length > 99 ? '99+' : String(unsorted.length);
            mobUnsorted.classList.remove('hidden');
        } else {
            mobUnsorted.classList.add('hidden');
        }
    }
    
    // Abre automaticamente em desktop quando solicitado (ex: novo item colado) ou se o usuário ainda não definiu preferência explícita
    if (unsorted.length > 0 && !isSidebarOpen && window.innerWidth >= 768 && (shouldAutoOpen || !hasExplicitSidebarPref)) {
        isSidebarOpen = true;
        applySidebarDomState();
        saveUIState();
    }

    listEl.innerHTML = unsorted.length === 0 ? `<div class="text-xs text-zinc-500 text-center py-6">${escapeHtml(t('emptyLabel'))}</div>` : '';

    for (const card of unsorted) {
        const isSelected = selectedUnsortedCardIds.has(card.id);
        const el = document.createElement('div');
        el.dataset.id = card.id;
        el.className = 'relative flex flex-col cursor-grab group mb-4 transition-all select-none';

        const beginUnsortedPress = (ev, isTouch) => {
            if (ev.target.closest('button')) return;
            if (!isTouch && ev.button !== 0) return;
            ev.stopPropagation();

            if (!isTouch && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
                if (selectedUnsortedCardIds.has(card.id)) selectedUnsortedCardIds.delete(card.id);
                else selectedUnsortedCardIds.add(card.id);
                syncUnsortedSelectionVisuals();
            } else if (!selectedUnsortedCardIds.has(card.id)) {
                selectedUnsortedCardIds.clear();
                selectedUnsortedCardIds.add(card.id);
                syncUnsortedSelectionVisuals();
            }

            const dragIds = selectedUnsortedCardIds.has(card.id)
                ? Array.from(selectedUnsortedCardIds)
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
                : stripHtmlToText(card.content || '');
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

function syncUnsortedSelectionVisuals() {
    document.querySelectorAll('#unsorted-list > div').forEach(el => {
        const id = el.dataset.id;
        const isSelected = selectedUnsortedCardIds.has(id);
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

async function deleteCard(id) {
    const c = await dbGet('cards', id);
    if (c) {
        await pushUndoSnapshot();
        const wasUnsorted = c.boardId === 'unsorted';
        const now = Date.now();
        c.isTrash = true; c.deletedAt = now;
        selectedCardIds.delete(id);
        await dbPut('cards', c);
        if (c.type === 'column') {
            const allCards = await dbGetAll('cards');
            for (const ch of allCards) {
                if (ch.columnId === c.id && !ch.isTrash) {
                    ch.isTrash = true;
                    ch.deletedAt = now;
                    selectedCardIds.delete(ch.id);
                    await dbPut('cards', ch);
                }
            }
        }
        await fetchAndRenderCards();
        await updateTrashBadge();
        playCozySound('trash');
        
        if (wasUnsorted) {
            const all = await dbGetAll('cards');
            const unsortedCount = all.filter(c => c.boardId === 'unsorted' && !c.isTrash).length;
            if (unsortedCount === 0 && isSidebarOpen) toggleSidebar();
        }
    }
}
async function deleteSelectedCards() {
    document.getElementById('context-menu').style.display = 'none';
    if (selectedCardIds.size === 0) return;
    await pushUndoSnapshot();
    const allCards = await dbGetAll('cards');
    const now = Date.now();
    let count = 0;
    const trashedColIds = new Set();
    for (const id of selectedCardIds) {
        const c = allCards.find(cd => cd.id === id) || await dbGet('cards', id);
        if (c && !c.isTrash) {
            c.isTrash = true;
            c.deletedAt = now;
            await dbPut('cards', c);
            if (c.type === 'column') trashedColIds.add(c.id);
            count++;
        }
    }
    if (trashedColIds.size > 0) {
        for (const ch of allCards) {
            if (ch.columnId && trashedColIds.has(ch.columnId) && !ch.isTrash) {
                ch.isTrash = true;
                ch.deletedAt = now;
                await dbPut('cards', ch);
            }
        }
    }
    selectedCardIds.clear();
    await fetchAndRenderCards();
    await updateTrashBadge();
    if (count > 0) {
        playCozySound('trash');
        showToast(t('movedToTrash'));
    }
}
async function convertSelectedToDocument(explicitIds = null) {
    document.getElementById('context-menu').style.display = 'none';
    const ids = Array.isArray(explicitIds) && explicitIds.length > 0
        ? explicitIds
        : Array.from(selectedCardIds);
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
async function convertToDocument(id) {
    const ids = (selectedCardIds.has(id) && selectedCardIds.size > 1)
        ? Array.from(selectedCardIds)
        : [id];
    await convertSelectedToDocument(ids);
}

async function updateLinkUrl(id, rawInput) {
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

async function editLinkUrl(id) {
    const c = await dbGet('cards', id);
    if (c) {
        const currentVal = c.content || (c.embedUrl ? `<iframe src="${c.embedUrl}"></iframe>` : '');
        const newUrl = prompt(t('promptEditUrl'), currentVal);
        if (newUrl !== null && newUrl.trim() !== '' && newUrl !== currentVal) {
            await updateLinkUrl(id, newUrl);
        }
    }
}

async function reorderTask(cardId, fromIndex, toIndex) {
    await moveTaskToCard(cardId, fromIndex, cardId, toIndex);
}

async function moveTaskToCard(fromCardId, fromIndex, toCardId, toIndex) {
    draggedTaskPayload = null;
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

async function importExternalCardsAsTasks(cardIds, targetCardId, insertIndex) {
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
            const text = (stripHtmlToText(src.content || '') || src.title || '').trim();
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

    internalDragPayload = null;
    selectedUnsortedCardIds.clear();
    await fetchAndRenderCards();
    await renderUnsortedDrawer();
    if (newTasks.length > 0) showToast(t('addedToTodo'));
}

async function addExternalTextAsTasks(targetCardId, rawText, insertIndex) {
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

function focusTaskInput(cardId, idx) {
    const cardEl = document.querySelector(`.interactive-card[data-id="${cardId}"]`);
    if (!cardEl) return;
    const row = cardEl.querySelector(`[data-task-index="${idx}"]`);
    if (!row) return;
    const inp = row.querySelector('.task-input');
    if (inp) {
        inp.classList.remove('pointer-events-none');
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
    }
}

async function insertTaskAfter(cardId, idx, currentText) {
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

async function appendNewTask(cardId, text, refocusAddInput) {
    const c = await dbGet('cards', cardId);
    if (!c) return;
    c.tasks = c.tasks || [];
    c.tasks.push({ text, completed: false });
    await dbPut('cards', c);
    await fetchAndRenderCards();
    if (refocusAddInput) {
        const cardEl = document.querySelector(`.interactive-card[data-id="${cardId}"]`);
        const addInp = cardEl?.querySelector('.add-task-input');
        if (addInp) addInp.focus();
    }
}

async function removeTaskAndFocusPrev(cardId, idx) {
    const c = await dbGet('cards', cardId);
    if (!c || !c.tasks || !c.tasks[idx]) return;
    c.tasks.splice(idx, 1);
    await dbPut('cards', c);
    await fetchAndRenderCards();
    if (c.tasks.length > 0) {
        focusTaskInput(cardId, Math.max(0, idx - 1));
    } else {
        const cardEl = document.querySelector(`.interactive-card[data-id="${cardId}"]`);
        const addInp = cardEl?.querySelector('.add-task-input');
        if (addInp) addInp.focus();
    }
}

async function moveSelectedToUnsorted(explicitIds = null) {
    document.getElementById('context-menu').style.display = 'none';
    const ids = Array.isArray(explicitIds) && explicitIds.length > 0
        ? explicitIds
        : Array.from(selectedCardIds);
    if (ids.length === 0) return;
    await pushUndoSnapshot();
    const allCards = await dbGetAll('cards');
    const unsortColIds = new Set();
    let moved = 0;
    for (const id of ids) {
        const c = allCards.find(cd => cd.id === id) || await dbGet('cards', id);
        if (c && c.boardId !== 'unsorted') {
            c.boardId = 'unsorted';
            c.columnId = null;
            c.columnOrder = null;
            await dbPut('cards', c);
            if (c.type === 'column') unsortColIds.add(c.id);
            moved++;
        }
        selectedCardIds.delete(id);
    }
    if (unsortColIds.size > 0) {
        for (const ch of allCards) {
            if (ch.columnId && unsortColIds.has(ch.columnId) && !ch.isTrash && ch.boardId !== 'unsorted') {
                ch.boardId = 'unsorted';
                ch.columnId = null;
                ch.columnOrder = null;
                await dbPut('cards', ch);
                selectedCardIds.delete(ch.id);
            }
        }
    }
    if (moved > 0) {
        if (!isSidebarOpen) {
            isSidebarOpen = true;
            hasExplicitSidebarPref = true;
            applySidebarDomState();
            saveUIState();
        }
        await fetchAndRenderCards();
        playCozySound('unsorted');
        showToast(t('movedToUnsortedToast'));
    }
}
async function moveToUnsorted(id) {
    const ids = (selectedCardIds.has(id) && selectedCardIds.size > 1)
        ? Array.from(selectedCardIds)
        : [id];
    await moveSelectedToUnsorted(ids);
}
async function updateCardTitle(id, t) {
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
async function updateCardContent(id, t) { const c = await dbGet('cards', id); if (c) { c.content = t; await dbPut('cards', c); } }
async function toggleCommentResolved(id) {
    const c = await dbGet('cards', id);
    if (!c) return;
    await pushUndoSnapshot();
    c.resolved = !c.resolved;
    await dbPut('cards', c);
    await fetchAndRenderCards();
    playCozySound(c.resolved ? 'check' : 'uncheck');
}
async function modifyCardTable(id, action) {
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
    const wasEditingThis = editingCardId === id;
    await dbPut('cards', c);
    await fetchAndRenderCards();
    if (wasEditingThis) {
        const updatedEl = document.querySelector(`.interactive-card[data-id="${id}"]`);
        if (updatedEl) enterCardEditMode(updatedEl);
    }
}
async function updateTableHeaderCell(id, colIdx, value) {
    const c = await dbGet('cards', id);
    if (!c || c.type !== 'table') return;
    const td = c.tableData || { headers: [`${t('tableColPrefix')} 1`, `${t('tableColPrefix')} 2`, `${t('tableColPrefix')} 3`], rows: [['', '', ''], ['', '', '']] };
    if (td.headers[colIdx] === value) return;
    await pushUndoSnapshot();
    td.headers[colIdx] = value;
    c.tableData = td;
    await dbPut('cards', c);
    const mem = cards.find(cd => cd.id === id);
    if (mem) mem.tableData = structuredClone(td);
}
async function updateTableBodyCell(id, rowIdx, colIdx, value) {
    const c = await dbGet('cards', id);
    if (!c || c.type !== 'table') return;
    const td = c.tableData || { headers: [`${t('tableColPrefix')} 1`, `${t('tableColPrefix')} 2`, `${t('tableColPrefix')} 3`], rows: [['', '', ''], ['', '', '']] };
    if (!td.rows[rowIdx]) return;
    if (td.rows[rowIdx][colIdx] === value) return;
    await pushUndoSnapshot();
    td.rows[rowIdx][colIdx] = value;
    c.tableData = td;
    await dbPut('cards', c);
    const mem = cards.find(cd => cd.id === id);
    if (mem) mem.tableData = structuredClone(td);
}
async function toggleTask(id, i) {
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
async function updateTaskText(id, i, t) { const c = await dbGet('cards', id); if (c && c.tasks[i]) { c.tasks[i].text = t; await dbPut('cards', c); } }
async function updateTaskTextLive(id, i, t) {
    const cardInMem = cards.find(c => c.id === id);
    if (cardInMem && cardInMem.tasks && cardInMem.tasks[i]) cardInMem.tasks[i].text = t;
    await updateTaskText(id, i, t);
}

async function openTrashModal() {
    if (typeof closeMobileSheets === 'function') closeMobileSheets();
    await renderTrashList();
    document.getElementById('trash-modal').classList.remove('hidden');
}
function closeTrashModal() { document.getElementById('trash-modal').classList.add('hidden'); }

async function renderTrashList() {
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
    
    for (const [dateLabel, items] of Object.entries(groups)) {
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
                        : stripHtmlToText(card.content || '');
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
async function restoreCard(id) {
    const c = await dbGet('cards', id);
    if (c) {
        await pushUndoSnapshot();
        c.isTrash = false;
        c.boardId = currentBoardId;
        c.columnId = null;
        c.columnOrder = null;
        await dbPut('cards', c);
        await renderTrashList();
        await fetchAndRenderCards();
        await updateTrashBadge();
        playCozySound('restore');
    }
}
async function permanentDelete(id) { await dbDelete('cards', id); await pruneOrphanAssets(); await renderTrashList(); await updateTrashBadge(); }
async function emptyTrash() { const all = await dbGetAll('cards'); for (const c of all) if (c.isTrash) await dbDelete('cards', c.id); await pruneOrphanAssets(); await renderTrashList(); await updateTrashBadge(); }
async function updateTrashBadge() {
    const all = await dbGetAll('cards');
    const n = all.filter(c => c.isTrash).length;
    const label = n > 99 ? '99+' : String(n);
    const b = document.getElementById('trash-badge');
    const mb = document.getElementById('mobile-trash-badge');
    if (b) {
        if (n > 0) { b.textContent = label; b.classList.remove('hidden'); }
        else b.classList.add('hidden');
    }
    if (mb) {
        if (n > 0) { mb.textContent = label; mb.classList.remove('hidden'); }
        else mb.classList.add('hidden');
    }
}

function toggleSidebar() {
    isSidebarOpen = !isSidebarOpen;
    hasExplicitSidebarPref = true;
    applySidebarDomState();
    saveUIState();
}
function setupSearch() {
    const deskInp = document.getElementById('search-input');
    const mobInp = document.getElementById('mobile-search-input');
    const clearBtn = document.getElementById('mobile-search-clear-btn');
    const activeDot = document.getElementById('mobile-search-active-dot');

    const applySearchVal = (val) => {
        searchQuery = val || '';
        if (deskInp && deskInp.value !== searchQuery) deskInp.value = searchQuery;
        if (mobInp && mobInp.value !== searchQuery) mobInp.value = searchQuery;
        const hasQuery = searchQuery.trim().length > 0;
        if (clearBtn) clearBtn.classList.toggle('hidden', !hasQuery);
        if (activeDot) activeDot.classList.toggle('hidden', !hasQuery);
        fetchAndRenderCards();
    };

    if (deskInp) {
        deskInp.addEventListener('input', (e) => applySearchVal(e.target.value));
    }
    if (mobInp) {
        mobInp.addEventListener('input', (e) => applySearchVal(e.target.value));
        mobInp.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && typeof toggleMobileSearchBar === 'function') {
                toggleMobileSearchBar(false);
            }
        });
    }
}
async function flushArrowNudgeCommit() {
    if (arrowNudgeTimer) {
        clearTimeout(arrowNudgeTimer);
        arrowNudgeTimer = null;
    }
    const snapPromise = pendingArrowUndoSnapshot;
    pendingArrowUndoSnapshot = null;
    const movedIds = Array.from(arrowMovedCardIds);
    arrowMovedCardIds.clear();
    if (movedIds.length === 0) return;
    if (snapPromise) await pushUndoSnapshot(await snapPromise);
    for (const id of movedIds) {
        const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
        const c = await dbGet('cards', id);
        if (c) {
            if (el) {
                c.x = Math.round(parseFloat(el.style.left));
                c.y = Math.round(parseFloat(el.style.top));
            } else {
                const mem = cards.find(cd => cd.id === id);
                if (mem) {
                    c.x = Math.round(mem.x);
                    c.y = Math.round(mem.y);
                }
            }
            await dbPut('cards', c);
        }
    }
}

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.key === 'Control' || e.key === 'Meta') {
            document.body.classList.add('is-zoom-modifier');
        }
        if (e.key === 'Escape') {
            const activeEl = document.activeElement;
            if (editingCardId || (activeEl && activeEl.closest?.('.interactive-card') && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable))) {
                if (activeEl && typeof activeEl.blur === 'function') activeEl.blur();
                exitCardEditMode();
                return;
            }
            if (activeTool === 'line') setTool('select');
            const menu = document.getElementById('context-menu');
            if (menu) menu.style.display = 'none';
            closeBoardBgPopover();
            if (typeof closeExportPopover === 'function') closeExportPopover();
            if (typeof closeMobileSheets === 'function') closeMobileSheets();
            if (typeof toggleMobileSearchBar === 'function') toggleMobileSearchBar(false);
            closePfpCropModal();
            closeSyncModal();
            closeSettingsModal();
            closeTrashModal();
            if (isHomeViewOpen) closeHomeView();
            clearSelection();
            clearConnectionSelection();
            return;
        }
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

        const isModalOpen = isHomeViewOpen ||
            !document.getElementById('document-modal')?.classList.contains('hidden') ||
            !document.getElementById('settings-modal')?.classList.contains('hidden') ||
            !document.getElementById('sync-modal')?.classList.contains('hidden') ||
            !document.getElementById('trash-modal')?.classList.contains('hidden') ||
            !document.getElementById('pfp-crop-modal')?.classList.contains('hidden');
        if (isModalOpen) return;

        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (typeof navigateHistoryBack === 'function') navigateHistoryBack();
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (typeof navigateHistoryForward === 'function') navigateHistoryForward();
                return;
            }
        }

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
            if (selectedCardIds.size > 0) duplicateSelectedCards();
            return;
        }
        if (mod && k === 'c') {
            const selText = window.getSelection()?.toString();
            if (!selText && selectedCardIds.size > 0) {
                e.preventDefault();
                copySelectedCards();
            }
            return;
        }
        if (mod && k === 'x') {
            const selText = window.getSelection()?.toString();
            if (!selText && selectedCardIds.size > 0) {
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
            if (selectedCardIds.size > 0) {
                e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
                if (!pendingArrowUndoSnapshot) {
                    pendingArrowUndoSnapshot = captureWorkspaceSnapshot();
                }
                selectedCardIds.forEach(id => {
                    const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
                    if (el) {
                        const nx = Math.round((parseFloat(el.style.left) || 0) + dx);
                        const ny = Math.round((parseFloat(el.style.top) || 0) + dy);
                        el.style.left = `${nx}px`;
                        el.style.top = `${ny}px`;
                        const mem = cards.find(cd => cd.id === id);
                        if (mem) { mem.x = nx; mem.y = ny; }
                        arrowMovedCardIds.add(id);
                    }
                });
                drawConnections();
                if (arrowNudgeTimer) clearTimeout(arrowNudgeTimer);
                arrowNudgeTimer = setTimeout(() => { flushArrowNudgeCommit(); }, 260);
                return;
            }
        }

        if (e.code === 'Space' && !isSpacePressed) {
            e.preventDefault();
            isSpacePressed = true;
            document.body.classList.add('is-space-pressed');
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedConnectionId) {
                deleteSelectedConnection();
            } else if (selectedCardIds.size > 0) {
                deleteSelectedCards();
            }
        }
    });
    window.addEventListener('keyup', (e) => {
        if (!e.ctrlKey && !e.metaKey) {
            document.body.classList.remove('is-zoom-modifier');
        }
        if (e.code === 'Space') {
            isSpacePressed = false;
            document.body.classList.remove('is-space-pressed');
        }
    });
    window.addEventListener('blur', () => {
        isSpacePressed = false;
        pendingCardDrag = null;
        document.body.classList.remove('is-zoom-modifier', 'is-space-pressed', 'is-canvas-interacting');
        if (typeof cancelFloatingPhysicsDrag === 'function') cancelFloatingPhysicsDrag();
        if (typeof setDraggedCardsElevated === 'function') setDraggedCardsElevated(false);
        if (typeof clearDropTargetHighlights === 'function') clearDropTargetHighlights();
    });
}

function handleGlobalTrashClick() {
    if (selectedConnectionId) {
        deleteSelectedConnection();
        return;
    }
    if (selectedCardIds.size === 1) {
        const selectedId = Array.from(selectedCardIds)[0];
        const card = cards.find(c => c.id === selectedId);
        if (card && card.type === 'subboard') {
            deleteSelectedCards();
            return;
        }
    }
    openTrashModal();
}

async function deleteSelectedConnection() {
    if (!selectedConnectionId) return;
    await pushUndoSnapshot();
    await dbDelete('connections', selectedConnectionId);
    selectedConnectionId = null;
    await fetchAndRenderCards(); // Redesenha os cards e linhas
    syncSelectionVisuals();
    showToast(t('connectionDeleted'));
}

async function toggleConnectionDashed() {
    if (!selectedConnectionId) return;
    const conn = connections.find(c => c.id === selectedConnectionId);
    if (conn) {
        conn.isDashed = !conn.isDashed;
        await dbPut('connections', conn);
        drawConnections();
    }
}

async function setConnColor(color) {
    if (!selectedConnectionId) return;
    const conn = connections.find(c => c.id === selectedConnectionId);
    if (conn) {
        conn.color = color;
        await dbPut('connections', conn);
        drawConnections();
    }
}

async function toggleStartMarker() {
    if (!selectedConnectionId) return;
    const conn = connections.find(c => c.id === selectedConnectionId);
    if (conn) {
        conn.startMarker = conn.startMarker === 'arrow' ? 'none' : 'arrow';
        await dbPut('connections', conn);
        drawConnections();
        syncSelectionVisuals();
    }
}

async function toggleEndMarker() {
    if (!selectedConnectionId) return;
    const conn = connections.find(c => c.id === selectedConnectionId);
    if (conn) {
        conn.endMarker = conn.endMarker === 'none' ? 'arrow' : 'none';
        await dbPut('connections', conn);
        drawConnections();
        syncSelectionVisuals();
    }
}

async function cycleConnWeight() {
    if (!selectedConnectionId) return;
    const conn = connections.find(c => c.id === selectedConnectionId);
    if (conn) {
        const weights = [1, 2, 4];
        const curr = conn.weight || 2;
        conn.weight = weights[(weights.indexOf(curr) + 1) % weights.length];
        await dbPut('connections', conn);
        drawConnections();
        syncSelectionVisuals();
    }
}

async function promptConnLabel() {
    if (!selectedConnectionId) return;
    const conn = connections.find(c => c.id === selectedConnectionId);
    if (conn) {
        const newLabel = prompt(t('promptConnLabel'), conn.label || "");
        if (newLabel !== null) {
            conn.label = newLabel;
            await dbPut('connections', conn);
            drawConnections();
            syncSelectionVisuals();
        }
    }
}

function clearConnectionSelection() {
    selectedConnectionId = null;
    drawConnections();
    syncSelectionVisuals();
}
function setActiveEmbedCard(cardId) {
    activeEmbedCardId = cardId || null;
    document.querySelectorAll('.embed-card').forEach(el => {
        const isActive = activeEmbedCardId === el.dataset.id;
        el.classList.toggle('embed-active', isActive);
        const btn = el.querySelector('button[onclick*="toggleEmbedInteract"]');
        if (btn) {
            btn.classList.toggle('opacity-100', isActive);
            btn.classList.toggle('text-indigo-300', isActive);
            btn.classList.toggle('bg-indigo-500/20', isActive);
            btn.classList.toggle('opacity-0', !isActive);
            btn.classList.toggle('group-hover:opacity-100', !isActive);
            btn.classList.toggle('text-zinc-500', !isActive);
            btn.classList.toggle('hover:text-zinc-200', !isActive);
        }
    });
}
function toggleEmbedInteract(cardId) {
    setActiveEmbedCard(activeEmbedCardId === cardId ? null : cardId);
}
function clearSelection() { selectedCardIds.clear(); setActiveEmbedCard(null); syncSelectionVisuals(); }

function applyZoomAroundCenter(nextScale) {
    const vp = document.getElementById('canvas-viewport');
    const clamped = Math.min(Math.max(nextScale, 0.25), 2.5);
    if (vp) {
        const cx = vp.clientWidth / 2;
        const cy = vp.clientHeight / 2;
        const worldX = (cx - canvasPanX) / canvasScale;
        const worldY = (cy - canvasPanY) / canvasScale;
        canvasScale = clamped;
        canvasPanX = cx - worldX * canvasScale;
        canvasPanY = cy - worldY * canvasScale;
    } else {
        canvasScale = clamped;
    }
    const pct = Math.round(canvasScale * 100) + '%';
    const zl = document.getElementById('zoom-level');
    const mzl = document.getElementById('mobile-zoom-level');
    if (zl) zl.textContent = pct;
    if (mzl) mzl.textContent = pct;
    updateCanvasTransform();
    saveUIState();
}
function zoomIn() { applyZoomAroundCenter(canvasScale * 1.15); }
function zoomOut() { applyZoomAroundCenter(canvasScale / 1.15); }
function resetZoom() { applyZoomAroundCenter(1); }

let toastTimeout;
let activeDocId = null;

async function openDocumentModal(id) {
    exitCardEditMode();
    clearSelection();
    if (selectedConnectionId) {
        selectedConnectionId = null;
        drawConnections();
        syncSelectionVisuals();
    }
    activeDocId = id;
    const c = await dbGet('cards', id);
    if (!c) return;
    
    document.getElementById('doc-title-input').value = c.title || t('newDocTitle');
    const docEditor = document.getElementById('doc-editor');
    docEditor.innerHTML = markdownToRichHtml(c.content || '');
    attachLiveMarkdownEditor(docEditor, { onChange: () => updateDocWordCount() });
    updateDocWordCount();
    
    document.getElementById('document-modal').classList.remove('hidden');
}

function closeDocumentModal() {
    document.getElementById('document-modal').classList.add('hidden');
    activeDocId = null;
    fetchAndRenderCards(); // Atualiza a contagem de palavras no card
}

function updateDocWordCount() {
    const editor = document.getElementById('doc-editor');
    const text = (editor ? (editor.innerText || '') : '').replace(/\u200B/g, '');
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    document.getElementById('doc-word-count').textContent = `${words} ${words === 1 ? t('wordSingular') : t('wordPlural')}`;
}

async function saveDocument() {
    if (!activeDocId) return;
    const c = await dbGet('cards', activeDocId);
    if (c) {
        c.title = document.getElementById('doc-title-input').value;
        c.content = document.getElementById('doc-editor').innerHTML;
        await dbPut('cards', c);
    }
}

function promptDocLink() {
    const url = prompt(t('promptDocUrl'));
    if (url) document.execCommand('createLink', false, url);
}

// Auto-save a cada 2 segundos enquanto digita
setInterval(() => {
    if (activeDocId) saveDocument();
}, 2000);

// Atualiza contagem de palavras e salva ao digitar
document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('doc-editor');
    if (editor) {
        attachLiveMarkdownEditor(editor, { onChange: updateDocWordCount });
        editor.addEventListener('blur', saveDocument);
    }
    document.getElementById('doc-title-input').addEventListener('change', saveDocument);
    document.getElementById('icon-file-input').addEventListener('change', handleIconFileInput);
});

// Fecha modal ao clicar fora (opcional)
document.getElementById('document-modal').addEventListener('mousedown', (e) => {
    if (e.target.id === 'document-modal') closeDocumentModal();
});

function showToast(msg) {
    const t = document.getElementById('toast'); document.getElementById('toast-msg').textContent = msg;
    t.classList.remove('translate-y-20', 'opacity-0'); clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.add('translate-y-20', 'opacity-0'), 2600);
}

function activateLineToolFromMenu() {
    const cm = document.getElementById('context-menu');
    if (cm) cm.style.display = 'none';
    setTool('line');
    showToast(t('lineToolHint'));
}

function setTool(tool) {
    activeTool = tool;
    const selectBtn = document.getElementById('tool-select');
    const handBtn = document.getElementById('tool-hand');
    const lineBtn = document.getElementById('tool-line');
    const vp = document.getElementById('canvas-viewport');
    const activeCls = 'w-full py-1.5 rounded-lg bg-white/10 text-zinc-100 hover:bg-white/15 transition-all border border-white/10 flex flex-col items-center';
    const inactiveCls = 'w-full py-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-all border border-transparent flex flex-col items-center';

    if (selectBtn) selectBtn.className = tool === 'select' ? activeCls : inactiveCls;
    if (handBtn) handBtn.className = tool === 'hand' ? activeCls : inactiveCls;
    if (lineBtn) lineBtn.className = tool === 'line' ? activeCls : inactiveCls;

    const mobModeBtn = document.getElementById('mobile-nav-mode');
    const mobModeIcon = document.getElementById('mobile-nav-mode-icon');
    const mobModeLabel = document.getElementById('mobile-nav-mode-label');
    if (mobModeBtn && mobModeIcon && mobModeLabel) {
        if (tool === 'hand') {
            mobModeIcon.innerHTML = '<path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"></path><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"></path><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path>';
            mobModeLabel.textContent = t('toolHand');
            mobModeBtn.classList.add('bg-white/[0.12]', 'text-white');
            mobModeBtn.classList.remove('text-zinc-300');
        } else if (tool === 'line') {
            mobModeIcon.innerHTML = '<line x1="5" y1="19" x2="19" y2="5"></line><polyline points="11 5 19 5 19 13"></polyline>';
            mobModeLabel.textContent = t('toolLine');
            mobModeBtn.classList.add('bg-white/[0.12]', 'text-white');
            mobModeBtn.classList.remove('text-zinc-300');
        } else {
            mobModeIcon.innerHTML = '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path>';
            mobModeLabel.textContent = t('toolSelect');
            mobModeBtn.classList.remove('bg-white/[0.12]', 'text-white');
            mobModeBtn.classList.add('text-zinc-300');
        }
    }

    document.body.classList.toggle('tool-line-active', tool === 'line');
    if (vp) {
        vp.style.cursor = tool === 'hand' ? 'grab' : tool === 'line' ? 'crosshair' : 'default';
    }
}

