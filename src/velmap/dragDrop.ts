import { closeTrashModal, importExternalCardsAsTasks, moveTaskToCard, renderTrashList, renderUnsortedDrawer, toggleSidebar, triggerImageUpload, updateTrashBadge } from './cardActions';
import { fetchAndRenderCards } from './cardRenderer';
import { getEventPoint } from './connections';
import { getNextTopZIndex } from './contextMenu';
import { dbGet, dbGetAll, dbPut } from './db';
import { pasteVelmapClipboard, pushUndoSnapshot } from './history';
import { t } from './i18n';
import { createCardAt, extractLinkMetadata, getLocalizedCardLabel, isDirectVideoUrl, isVideoFile, normalizeHttpUrl, parseEmbedUrl, parseIframeEmbedCode, probeImageUrl, resolveDirectOrMetaImage, resolveHtmlMediaSource, resolveKnownGifHostUrl, saveImageBlobToUnsorted, saveImageToCanvas, saveTextOrLinkToUnsorted, saveVideoBlobToUnsorted, saveVideoToCanvas } from './mediaAndLinks';
import { playCozySound } from './sound';
import { S, VELMAP_CLIPBOARD_PREFIX } from './state';
import { applySidebarDomState, escapeHtml, saveUIState, showToast } from './uiState';

export const handleFloatingTouchEnd = async (e) => {
    if (S.pendingFloatingDrag && S.pendingFloatingDrag.isTouch) {
        S.pendingFloatingDrag = null;
    }
    if (S.floatingDragState && S.floatingDragState.isTouch) {
        const pt = getEventPoint(e);
        await finishFloatingPhysicsDrag(pt.clientX || S.floatingDragState.clientX, pt.clientY || S.floatingDragState.clientY);
    }
};

export function setupClipboardAndDragDrop() {
    document.querySelectorAll('.tool-drag-item').forEach(item => {
        const beginToolPress = (e, isTouch) => {
            if (!isTouch && e.button !== 0) return;
            const type = item.getAttribute('data-tool-type');
            if (!type) return;
            const pt = isTouch ? e.touches[0] : e;
            const dims = getToolPreviewDimensions(type);
            queueFloatingPhysicsDrag({
                source: 'toolbar',
                payload: { type },
                startX: pt.clientX,
                startY: pt.clientY,
                grabX: dims.w / 2,
                grabY: dims.h / 2,
                isTouch,
                createPreview: () => buildToolDragGhostEl(type),
                onDragStart: () => {
                    S.suppressNextToolClick = true;
                },
                onDragEnd: () => {
                    setTimeout(() => { S.suppressNextToolClick = false; }, 120);
                }
            });
        };

        item.addEventListener('mousedown', (e) => beginToolPress(e, false));
        item.addEventListener('touchstart', (e: TouchEvent) => {
            if (e.touches.length === 1) beginToolPress(e, true);
        }, { passive: true });

        item.addEventListener('click', async () => {
            if (S.suppressNextToolClick) {
                S.suppressNextToolClick = false;
                return;
            }
            const type = item.getAttribute('data-tool-type');
            if (type === 'image') return triggerImageUpload();
            const vp = document.getElementById('canvas-viewport');
            await createCardAt(type, (-S.canvasPanX + vp.clientWidth / 2 - 135) / S.canvasScale, (-S.canvasPanY + vp.clientHeight / 2 - 85) / S.canvasScale);
            showToast(t('addedCard', { type: getLocalizedCardLabel(type) }));
        });
    });

    window.addEventListener('paste', async (e) => {
        const activeEl = document.activeElement as HTMLElement | null;
        const tag = activeEl?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || activeEl?.isContentEditable) return;
        let handled = false;
        const seenFiles = new Set();
        const handleMediaFile = async (file) => {
            if (!file) return;
            const sig = `${file.name}:${file.size}:${file.type}`;
            if (seenFiles.has(sig)) return;
            seenFiles.add(sig);
            if (file.type.includes('image')) {
                await saveImageBlobToUnsorted(file, file.name || t('pastedImage'));
                handled = true;
            } else if (isVideoFile(file)) {
                await saveVideoBlobToUnsorted(file, file.name || t('pastedVideo'));
                handled = true;
            }
        };

        if (e.clipboardData?.items) {
            for (let i of e.clipboardData.items) {
                if (i.kind === 'file') await handleMediaFile(i.getAsFile());
            }
        }
        if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
            for (const f of e.clipboardData.files) {
                await handleMediaFile(f);
            }
        }

        const plainText = (e.clipboardData?.getData('text/plain') || '').trim();
        const htmlText = e.clipboardData?.getData('text/html') || '';

        if (!handled && S.velmapClipboard && (plainText === (VELMAP_CLIPBOARD_PREFIX + S.velmapClipboard.token) || (!plainText && !htmlText) || !S.velmapClipboard.wroteSystem)) {
            e.preventDefault();
            await pasteVelmapClipboard();
            return;
        }

        if (!handled && (plainText || htmlText)) {
            if (plainText || parseIframeEmbedCode(htmlText) || resolveHtmlMediaSource(htmlText)) {
                await saveTextOrLinkToUnsorted(plainText, htmlText);
                handled = true;
            }
        }
        if (handled) { await renderUnsortedDrawer(true); showToast(t('addedToUnsorted')); }
    });

    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e: any) => {
        // Ignora se o drop foi na lixeira (já tratado por setupTrashInteractions)
        if (e.target?.closest?.('#global-trash-btn')) return;

        e.preventDefault();
        let payload = S.internalDragPayload;
        if (!payload && e.dataTransfer.getData('application/x-milanote-internal')) {
            payload = JSON.parse(e.dataTransfer.getData('application/x-milanote-internal'));
        }

        const rect = document.getElementById('canvas-viewport').getBoundingClientRect();
        const overCanvas = (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom);

        // 0.1 Drop de TASK para fora do card (Criar novo card de checklist)
        const taskPayloadStr = e.dataTransfer.getData('application/x-milanote-task');
        const taskPayload = taskPayloadStr ? JSON.parse(taskPayloadStr) : S.draggedTaskPayload;
        if (taskPayload && overCanvas && !e.target?.closest?.('.interactive-card')) {
            const sourceCard = await dbGet('cards', taskPayload.cardId);
            if (sourceCard && sourceCard.tasks && sourceCard.tasks[taskPayload.taskIdx]) {
                const [movedTask] = sourceCard.tasks.splice(taskPayload.taskIdx, 1);
                await dbPut('cards', sourceCard);

                const mouseCanvasX = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale;
                const mouseCanvasY = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale;
                await dbPut('cards', {
                    id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                    boardId: S.currentBoardId,
                    type: 'task',
                    title: t('labelTask'),
                    tasks: [movedTask],
                    x: Math.round(mouseCanvasX - 135),
                    y: Math.round(mouseCanvasY - 85),
                    width: 270,
                    height: 170,
                    zIndex: getNextTopZIndex(),
                    isTrash: false,
                    createdAt: Date.now()
                });

                S.draggedTaskPayload = null;
                await fetchAndRenderCards();
                showToast(t('taskMovedNewCard'));
                return;
            }
        }

        // 0. Drop da LIXEIRA (Restaurar arrastando)
        if (payload && payload.source === 'trash' && overCanvas) {
            const card = await dbGet('cards', payload.cardId);
            if (card) {
                const mouseCanvasX = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale;
                const mouseCanvasY = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale;
                const targetW = card.width || (card.type === 'subboard' ? 140 : card.type === 'document' ? 96 : card.type === 'table' ? 380 : card.type === 'comment' ? 256 : 270);
                const targetH = card.height || (card.type === 'subboard' ? 140 : card.type === 'document' ? 144 : card.type === 'table' ? 180 : card.type === 'comment' ? 132 : 170);
                const ratioX = typeof payload.grabRatioX === 'number' ? payload.grabRatioX : 0.5;
                const ratioY = typeof payload.grabRatioY === 'number' ? payload.grabRatioY : 0.5;
                
                card.isTrash = false;
                card.deletedAt = null;
                card.boardId = S.currentBoardId;
                card.zIndex = getNextTopZIndex();
                card.x = Math.round(mouseCanvasX - ratioX * targetW);
                card.y = Math.round(mouseCanvasY - ratioY * targetH);
                
                await dbPut('cards', card);
                S.internalDragPayload = null;
                
                await fetchAndRenderCards();
                await renderTrashList();
                await updateTrashBadge();
                
                const allCards = await dbGetAll('cards');
                if (allCards.filter(c => c.isTrash).length === 0) closeTrashModal();
                
                showToast(t('itemRestored'));
            }
            return;
        }

        // 1. Drop de FERRAMENTAS (Toolbar)
        if (payload && payload.source === 'toolbar' && overCanvas) {
            const type = payload.type;
            if (type === 'image') return triggerImageUpload();
            
            const mouseCanvasX = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale;
            const mouseCanvasY = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale;
            const dims = getToolPreviewDimensions(type);
            const x = mouseCanvasX - (dims.w / 2);
            const y = mouseCanvasY - (dims.h / 2);
            
            await createCardAt(type, x, y);
            S.internalDragPayload = null;
            return;
        }

        // Verifica se o drop foi em cima de um Board (Subboard)
        const targetBoardNode = e.target?.closest?.('.board-node') as HTMLElement | null;
        if (targetBoardNode && payload && (payload.source === 'unsorted' || payload.source === 'canvas')) {
            const boardId = targetBoardNode.dataset.id;
            S.internalDragPayload = null;
            await moveCardsToBoard(payload.cardIds, boardId);
            return;
        }

        // 2. Drop do UNSORTED
        if (payload && payload.source === 'unsorted' && overCanvas) {
            let offsetX = 0;
            let offsetY = 0;
            const mouseCanvasX = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale;
            const mouseCanvasY = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale;
            const ratioX = typeof payload.grabRatioX === 'number' ? payload.grabRatioX : 0.5;
            const ratioY = typeof payload.grabRatioY === 'number' ? payload.grabRatioY : 0.5;
            let nextZ = getNextTopZIndex();

            for (const cardId of payload.cardIds) {
                const card = await dbGet('cards', cardId);
                if (card) {
                    const targetW = card.width || (card.type === 'subboard' ? 140 : card.type === 'document' ? 96 : card.type === 'table' ? 380 : card.type === 'comment' ? 256 : 270);
                    const targetH = card.height || (card.type === 'subboard' ? 140 : card.type === 'document' ? 144 : card.type === 'table' ? 180 : card.type === 'comment' ? 132 : 170);
                    card.boardId = S.currentBoardId; 
                    card.x = Math.round(mouseCanvasX - ratioX * targetW + offsetX); 
                    card.y = Math.round(mouseCanvasY - ratioY * targetH + offsetY); 
                    card.zIndex = nextZ++;
                    await dbPut('cards', card);
                    offsetX += 20;
                    offsetY += 20;
                }
            }
            S.internalDragPayload = null;
            S.selectedUnsortedCardIds.clear();
            await fetchAndRenderCards();
            await renderUnsortedDrawer();
            
            const allCards = await dbGetAll('cards');
            const unsortedCount = allCards.filter(c => c.boardId === 'unsorted' && !c.isTrash).length;
            if (unsortedCount === 0 && S.isSidebarOpen) toggleSidebar();
            return;
        }
        
        // 3. Drop de ARQUIVOS ou URLs / EMBEDS EXTERNOS (Imagens, Vídeos Web/Locais, Embed Codes e Links)
        if (!payload) {
            if (e.dataTransfer.files.length > 0) {
                let imageCount = 0;
                let videoCount = 0;
                for (const f of e.dataTransfer.files) {
                    if (f.type.startsWith('image/')) {
                        if (overCanvas) await saveImageToCanvas(f, f.name, e.clientX, e.clientY);
                        else await saveImageBlobToUnsorted(f, f.name);
                        imageCount++;
                    } else if (isVideoFile(f)) {
                        if (overCanvas) await saveVideoToCanvas(f, f.name, e.clientX, e.clientY);
                        else await saveVideoBlobToUnsorted(f, f.name);
                        videoCount++;
                    }
                }
                const total = imageCount + videoCount;
                if (total > 0) {
                    if (overCanvas) await fetchAndRenderCards();
                    else await renderUnsortedDrawer();
                    if (imageCount > 0 && videoCount > 0) {
                        showToast(t(overCanvas ? 'mediaAddedCanvas' : 'mediaAddedUnsorted', { count: total }));
                    } else if (videoCount > 0) {
                        showToast(t(overCanvas ? 'videosAddedCanvas' : 'videosAddedUnsorted', { count: videoCount }));
                    } else {
                        showToast(t(overCanvas ? 'imagesAddedCanvas' : 'imagesAddedUnsorted', { count: imageCount }));
                    }
                }
            } else {
                const rawPlain = (e.dataTransfer.getData('text/plain') || '').trim();
                const rawUri = (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).find(l => l && !l.startsWith('#')) || '';
                const html = e.dataTransfer.getData('text/html') || '';

                // 3a. Código embed (<iframe ...>) ou <video> arrastado
                const embedCode = parseIframeEmbedCode(rawPlain) || parseIframeEmbedCode(html);
                if (embedCode) {
                    if (overCanvas) {
                        const x = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale - 170;
                        const y = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale - 116;
                        await dbPut('cards', {
                            id: 'card_' + Date.now(), boardId: S.currentBoardId, type: 'embed',
                            title: embedCode.title, content: embedCode.sourceUrl || '',
                            embedUrl: embedCode.embedUrl, domain: embedCode.domain,
                            x: Math.round(x), y: Math.round(y), width: 340, height: 232, zIndex: getNextTopZIndex(), isTrash: false, createdAt: Date.now()
                        });
                        await fetchAndRenderCards();
                        showToast(t('embedAddedCanvas'));
                    } else {
                        await dbPut('cards', {
                            id: 'card_' + Date.now(), boardId: 'unsorted', type: 'embed',
                            title: embedCode.title, content: embedCode.sourceUrl || '',
                            embedUrl: embedCode.embedUrl, domain: embedCode.domain,
                            x: 100, y: 100, width: 340, height: 232, isTrash: false, createdAt: Date.now()
                        });
                        await renderUnsortedDrawer();
                        showToast(t('embedAddedUnsorted'));
                    }
                    return;
                }

                const htmlMedia = resolveHtmlMediaSource(html);
                let url = (htmlMedia?.kind === 'video' ? htmlMedia.url : '') || rawUri || rawPlain;
                if (!url && htmlMedia?.kind === 'image') url = htmlMedia.url;
                url = normalizeHttpUrl(url);

                if (url) {
                    // 3b. URL embedável (YouTube, Vimeo, Loom, Spotify, Dailymotion)
                    const embedInfo = parseEmbedUrl(url);
                    if (embedInfo) {
                        const meta = await extractLinkMetadata(url);
                        if (overCanvas) {
                            const x = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale - 170;
                            const y = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale - 116;
                            await dbPut('cards', {
                                id: 'card_' + Date.now(), boardId: S.currentBoardId, type: 'embed',
                                title: (meta.title && meta.title !== embedInfo.domain) ? meta.title : embedInfo.title,
                                content: url, embedUrl: embedInfo.embedUrl,
                                imageUrl: meta.imageUrl || embedInfo.imageUrl, domain: embedInfo.domain,
                                siteName: meta.siteName || embedInfo.siteName,
                                x: Math.round(x), y: Math.round(y), width: 340, height: 232, zIndex: getNextTopZIndex(), isTrash: false, createdAt: Date.now()
                            });
                            await fetchAndRenderCards();
                            showToast(t('embedAddedCanvas'));
                        } else {
                            await dbPut('cards', {
                                id: 'card_' + Date.now(), boardId: 'unsorted', type: 'embed',
                                title: (meta.title && meta.title !== embedInfo.domain) ? meta.title : embedInfo.title,
                                content: url, embedUrl: embedInfo.embedUrl,
                                imageUrl: meta.imageUrl || embedInfo.imageUrl, domain: embedInfo.domain,
                                siteName: meta.siteName || embedInfo.siteName,
                                x: 100, y: 100, width: 340, height: 232, isTrash: false, createdAt: Date.now()
                            });
                            await renderUnsortedDrawer();
                            showToast(t('embedAddedUnsorted'));
                        }
                        return;
                    }

                    // 3c. Vídeo direto da Web (.mp4, .webm, .mov, <video>)
                    if (htmlMedia?.kind === 'video' || isDirectVideoUrl(url)) {
                        if (overCanvas) {
                            const x = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale - 160;
                            const y = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale - 100;
                            await dbPut('cards', {
                                id: 'card_' + Date.now(), boardId: S.currentBoardId, type: 'video',
                                title: t('webVideo'), content: url,
                                x: Math.round(x), y: Math.round(y), width: 320, height: null, zIndex: getNextTopZIndex(), isTrash: false, createdAt: Date.now()
                            });
                            await fetchAndRenderCards();
                            showToast(t('videoAddedCanvas'));
                        } else {
                            await dbPut('cards', {
                                id: 'card_' + Date.now(), boardId: 'unsorted', type: 'video',
                                title: t('webVideo'), content: url,
                                x: 100, y: 100, width: 320, height: null, isTrash: false, createdAt: Date.now()
                            });
                            await renderUnsortedDrawer();
                            showToast(t('videoAddedUnsorted'));
                        }
                        return;
                    }

                    // 3d. Imagem ou Link rico estilo Milanote
                    const knownGif = resolveKnownGifHostUrl(url);
                    const directMediaUrl = knownGif || url;
                    const isImg = knownGif ? true : await probeImageUrl(url);

                    if (isImg) {
                        if (overCanvas) {
                            const x = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale - 135;
                            const y = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale - 90;
                            await dbPut('cards', { id: 'card_' + Date.now(), boardId: S.currentBoardId, type: 'image', title: t('webImage'), content: directMediaUrl, x: Math.round(x), y: Math.round(y), width: 270, height: null, zIndex: getNextTopZIndex(), isTrash: false, createdAt: Date.now() });
                            await fetchAndRenderCards();
                            showToast(t('imageAddedCanvas'));
                        } else {
                            await dbPut('cards', { id: 'card_' + Date.now(), boardId: 'unsorted', type: 'image', title: t('webImage'), content: directMediaUrl, x: 100, y: 100, width: 270, height: null, isTrash: false, createdAt: Date.now() });
                            await renderUnsortedDrawer();
                            showToast(t('imageAddedUnsorted'));
                        }
                    } else {
                        const fallbackImg = htmlMedia?.kind === 'image' ? htmlMedia.url : null;
                        const meta = await extractLinkMetadata(url, fallbackImg);
                        const resolvedImg = resolveDirectOrMetaImage(url, meta, fallbackImg);
                        if (resolvedImg) {
                            if (overCanvas) {
                                const x = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale - 135;
                                const y = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale - 90;
                                await dbPut('cards', { id: 'card_' + Date.now(), boardId: S.currentBoardId, type: 'image', title: t('webImage'), content: resolvedImg, x: Math.round(x), y: Math.round(y), width: 270, height: null, zIndex: getNextTopZIndex(), isTrash: false, createdAt: Date.now() });
                                await fetchAndRenderCards();
                                showToast(t('imageAddedCanvas'));
                            } else {
                                await dbPut('cards', { id: 'card_' + Date.now(), boardId: 'unsorted', type: 'image', title: t('webImage'), content: resolvedImg, x: 100, y: 100, width: 270, height: null, isTrash: false, createdAt: Date.now() });
                                await renderUnsortedDrawer();
                                showToast(t('imageAddedUnsorted'));
                            }
                            return;
                        }
                        if (overCanvas) {
                            const x = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale - 135;
                            const y = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale - 90;
                            await dbPut('cards', {
                                id: 'card_' + Date.now(), boardId: S.currentBoardId, type: 'link',
                                title: meta.title, description: meta.description,
                                content: url, imageUrl: meta.imageUrl, videoUrl: meta.videoUrl || null,
                                isVideoLink: !!meta.isVideoLink, logoUrl: meta.logoUrl,
                                siteName: meta.siteName, domain: meta.domain,
                                x: Math.round(x), y: Math.round(y), width: 270, height: 170, zIndex: getNextTopZIndex(), isTrash: false, createdAt: Date.now()
                            });
                            await fetchAndRenderCards();
                            showToast(t('linkAddedCanvas'));
                        } else {
                            await dbPut('cards', {
                                id: 'card_' + Date.now(), boardId: 'unsorted', type: 'link',
                                title: meta.title, description: meta.description,
                                content: url, imageUrl: meta.imageUrl, videoUrl: meta.videoUrl || null,
                                isVideoLink: !!meta.isVideoLink, logoUrl: meta.logoUrl,
                                siteName: meta.siteName, domain: meta.domain,
                                x: 100, y: 100, width: 270, height: 170, isTrash: false, createdAt: Date.now()
                            });
                            await renderUnsortedDrawer();
                            showToast(t('linkAddedUnsorted'));
                        }
                    }
                }
            }
        }
    });
}

export function setupTrashInteractions() {
    const trashButtons = [
        document.getElementById('global-trash-btn')
    ].filter(Boolean);

    trashButtons.forEach((btn) => {
        btn.addEventListener('dragenter', (e) => {
            const hasInternal = S.internalDragPayload && (S.internalDragPayload.source === 'unsorted' || S.internalDragPayload.source === 'canvas');
            const hasInternalType = e.dataTransfer?.types?.includes('application/x-milanote-internal');
            const hasTask = S.draggedTaskPayload || e.dataTransfer?.types?.includes('application/x-milanote-task');
            if (hasInternal || hasInternalType || hasTask) {
                e.preventDefault();
                btn.classList.add('trash-drop-active');
            }
        });

        btn.addEventListener('dragover', (e) => {
            const hasInternal = S.internalDragPayload && (S.internalDragPayload.source === 'unsorted' || S.internalDragPayload.source === 'canvas');
            const hasInternalType = e.dataTransfer?.types?.includes('application/x-milanote-internal');
            const hasTask = S.draggedTaskPayload || e.dataTransfer?.types?.includes('application/x-milanote-task');
            if (hasInternal || hasInternalType || hasTask) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                btn.classList.add('trash-drop-active');
            }
        });

        btn.addEventListener('dragleave', (e) => {
            if (!btn.contains(e.relatedTarget as Node | null)) {
                btn.classList.remove('trash-drop-active');
            }
        });

        btn.addEventListener('drop', async (e) => {
            btn.classList.remove('trash-drop-active');
            document.querySelectorAll('.trash-drop-active').forEach(el => el.classList.remove('trash-drop-active'));

            let payload = S.internalDragPayload;
            const rawInternal = e.dataTransfer?.getData('application/x-milanote-internal');
            if (!payload && rawInternal) {
                try { payload = JSON.parse(rawInternal); } catch (_) {}
            }

            if (payload && (payload.source === 'unsorted' || payload.source === 'canvas') && Array.isArray(payload.cardIds) && payload.cardIds.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                let trashedAny = false;
                for (const cardId of payload.cardIds) {
                    const c = await dbGet('cards', cardId);
                    if (c && !c.isTrash) {
                        c.isTrash = true;
                        c.deletedAt = Date.now();
                        await dbPut('cards', c);
                        S.selectedCardIds.delete(cardId);
                        S.selectedUnsortedCardIds.delete(cardId);
                        trashedAny = true;
                    }
                }
                S.internalDragPayload = null;
                if (trashedAny) {
                    await fetchAndRenderCards();
                    await updateTrashBadge();
                    if (payload.source === 'unsorted') {
                        const all = await dbGetAll('cards');
                        const unsortedCount = all.filter(c => c.boardId === 'unsorted' && !c.isTrash).length;
                        if (unsortedCount === 0 && S.isSidebarOpen && window.innerWidth >= 768) toggleSidebar();
                    }
                    showToast(t('movedToTrash'));
                }
                return;
            }

            const rawTask = e.dataTransfer?.getData('application/x-milanote-task');
            const taskPayload = rawTask ? JSON.parse(rawTask) : S.draggedTaskPayload;
            if (taskPayload) {
                e.preventDefault();
                e.stopPropagation();
                const sourceCard = await dbGet('cards', taskPayload.cardId);
                if (sourceCard && sourceCard.tasks && sourceCard.tasks[taskPayload.taskIdx]) {
                    const [removedTask] = sourceCard.tasks.splice(taskPayload.taskIdx, 1);
                    await dbPut('cards', sourceCard);
                    await dbPut('cards', {
                        id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                        boardId: S.currentBoardId,
                        type: 'task',
                        title: removedTask.text || t('labelTask'),
                        tasks: [removedTask],
                        x: 100,
                        y: 100,
                        width: 270,
                        height: 170,
                        isTrash: true,
                        deletedAt: Date.now(),
                        createdAt: Date.now()
                    });
                    S.draggedTaskPayload = null;
                    await fetchAndRenderCards();
                    await updateTrashBadge();
                    showToast(t('movedToTrash'));
                }
            }
        });
    });

    // Modal da Lixeira: fecha somente ao clicar fora (pressionar e soltar no backdrop), nunca ao arrastar de dentro para fora
    const trashModal = document.getElementById('trash-modal');
    if (trashModal) {
        let trashBackdropPressStarted = false;

        trashModal.addEventListener('mousedown', (e) => {
            trashBackdropPressStarted = (e.target === trashModal);
        });
        trashModal.addEventListener('mouseup', (e) => {
            if (trashBackdropPressStarted && e.target === trashModal && !S.internalDragPayload) {
                closeTrashModal();
            }
            trashBackdropPressStarted = false;
        });

        trashModal.addEventListener('touchstart', (e) => {
            trashBackdropPressStarted = (e.target === trashModal);
        }, { passive: true });
        trashModal.addEventListener('touchend', (e) => {
            if (trashBackdropPressStarted && e.target === trashModal && !S.internalDragPayload) {
                closeTrashModal();
            }
            trashBackdropPressStarted = false;
        }, { passive: true });
    }
}

export function getHoveredTrashBtn(clientX, clientY) {
    const candidates = [
        document.getElementById('global-trash-btn')
    ].filter(Boolean);
    for (const btn of candidates) {
        if (btn.getClientRects().length === 0) continue;
        const r = btn.getBoundingClientRect();
        if (clientX >= r.left - 8 && clientX <= r.right + 8 && clientY >= r.top - 8 && clientY <= r.bottom + 8) {
            return btn;
        }
    }
    return null;
}

export function getHoveredUnsortedTarget(clientX, clientY) {
    const sidebar = document.getElementById('right-sidebar');
    if (sidebar && sidebar.getClientRects().length > 0 && !sidebar.classList.contains('hidden')) {
        const r = sidebar.getBoundingClientRect();
        if (clientX >= r.left - 6 && clientX <= r.right + 6 && clientY >= r.top && clientY <= r.bottom) {
            return sidebar;
        }
    }
    const toggleBtn = document.getElementById('unsorted-toggle-btn');
    if (toggleBtn && toggleBtn.getClientRects().length > 0) {
        const r = toggleBtn.getBoundingClientRect();
        if (clientX >= r.left - 6 && clientX <= r.right + 6 && clientY >= r.top - 6 && clientY <= r.bottom + 6) {
            return toggleBtn;
        }
    }
    return null;
}

export function getHoveredBreadcrumbTab(clientX, clientY) {
    const tabs = document.querySelectorAll('.breadcrumb-drop-tab[data-breadcrumb-board-id]');
    for (const tab of tabs) {
        if (tab.getClientRects().length === 0) continue;
        const r = tab.getBoundingClientRect();
        if (clientX >= r.left - 6 && clientX <= r.right + 6 && clientY >= r.top - 6 && clientY <= r.bottom + 6) {
            return tab;
        }
    }
    return null;
}

export function flashBreadcrumbDropTab(boardId) {
    const tab = document.querySelector(`.breadcrumb-drop-tab[data-breadcrumb-board-id="${boardId}"]`);
    if (!tab) return;
    tab.classList.add('breadcrumb-drop-active');
    setTimeout(() => tab.classList.remove('breadcrumb-drop-active'), 420);
}

export function getHoveredBoardNode(clientX, clientY, excludedIdsMap) {
    const boardNodes = document.querySelectorAll<HTMLElement>('.board-node');
    for (const node of boardNodes) {
        const id = node.dataset.id;
        if (excludedIdsMap && excludedIdsMap.has(id)) continue;
        const squircle = node.querySelector('.board-squircle') || node;
        const r = squircle.getBoundingClientRect();
        if (clientX >= r.left - 8 && clientX <= r.right + 8 && clientY >= r.top - 8 && clientY <= r.bottom + 22) {
            return node;
        }
    }
    return null;
}

export function clearTrashHoverHighlight() {
    document.querySelectorAll('.trash-drop-active').forEach(el => el.classList.remove('trash-drop-active'));
}

export function clearDropTargetHighlights() {
    clearTrashHoverHighlight();
    document.querySelectorAll('.unsorted-drop-active').forEach(el => el.classList.remove('unsorted-drop-active'));
    document.querySelectorAll('.board-drop-target').forEach(el => el.classList.remove('board-drop-target'));
    document.querySelectorAll('.breadcrumb-drop-active').forEach(el => el.classList.remove('breadcrumb-drop-active'));
}

export function updateTrashHoverHighlight(clientX, clientY) {
    const hovered = getHoveredTrashBtn(clientX, clientY);
    clearTrashHoverHighlight();
    if (hovered) hovered.classList.add('trash-drop-active');
}

export function playBoardPoofEffect(boardId) {
    const node = document.querySelector(`.board-node[data-id="${boardId}"]`);
    if (!node) return;
    const squircle = node.querySelector<HTMLElement>('.board-squircle');
    if (!squircle) return;

    squircle.classList.remove('board-poof-squish');
    void squircle.offsetWidth;
    squircle.classList.add('board-poof-squish');
    setTimeout(() => squircle.classList.remove('board-poof-squish'), 560);
}

export async function moveCardsToBoard(cardIds: any[], targetBoardId: any, options: any = {}) {
    if (!options.skipUndo) {
        await pushUndoSnapshot(options.preCapturedUndo || null);
    }
    let targetBoard = await dbGet('boards', targetBoardId);
    if (!targetBoard) {
        const subCard = await dbGet('cards', targetBoardId);
        await dbPut('boards', {
            id: targetBoardId,
            title: subCard?.title || t('newBoardTitle'),
            parentId: S.currentBoardId,
            createdAt: Date.now()
        });
    }
    let movedAny = false;
    for (const cardId of cardIds) {
        if (cardId === targetBoardId) continue;
        const card = await dbGet('cards', cardId);
        if (card) {
            card.boardId = targetBoardId;
            if (card.type === 'subboard') {
                const sb = await dbGet('boards', card.id);
                if (sb) {
                    sb.parentId = targetBoardId;
                    await dbPut('boards', sb);
                }
            }
            await dbPut('cards', card);
            movedAny = true;
        }
        S.selectedUnsortedCardIds.delete(cardId);
        S.selectedCardIds.delete(cardId);
    }
    if (movedAny) {
        await fetchAndRenderCards();
        await renderUnsortedDrawer(false);
        if (options.isBreadcrumb) flashBreadcrumbDropTab(targetBoardId);
        else playBoardPoofEffect(targetBoardId);
        playCozySound(options.isBreadcrumb ? 'tabDrop' : 'boardDrop');
        showToast(t('cardMovedToBoard'));
    }
}

export function setupUnsortedDropInteractions() {
    const targets = [
        document.getElementById('right-sidebar'),
        document.getElementById('unsorted-toggle-btn')
    ].filter(Boolean);

    targets.forEach((target) => {
        target.addEventListener('dragover', (e) => {
            const hasCanvasOrTrash = S.internalDragPayload && (S.internalDragPayload.source === 'canvas' || S.internalDragPayload.source === 'trash');
            const hasTask = S.draggedTaskPayload || e.dataTransfer?.types?.includes('application/x-milanote-task');
            if (hasCanvasOrTrash || hasTask) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                target.classList.add('unsorted-drop-active');
            }
        });
        target.addEventListener('dragleave', (e) => {
            if (!target.contains(e.relatedTarget as Node | null)) {
                target.classList.remove('unsorted-drop-active');
            }
        });
        target.addEventListener('drop', async (e) => {
            target.classList.remove('unsorted-drop-active');
            let payload = S.internalDragPayload;
            const raw = e.dataTransfer?.getData('application/x-milanote-internal');
            if (!payload && raw) {
                try { payload = JSON.parse(raw); } catch (_) {}
            }
            if (payload && payload.source === 'canvas' && Array.isArray(payload.cardIds)) {
                e.preventDefault();
                e.stopPropagation();
                for (const id of payload.cardIds) {
                    const c = await dbGet('cards', id);
                    if (c) {
                        c.boardId = 'unsorted';
                        await dbPut('cards', c);
                    }
                    S.selectedCardIds.delete(id);
                }
                S.internalDragPayload = null;
                await fetchAndRenderCards();
                await renderUnsortedDrawer(false);
                playCozySound('unsorted');
                showToast(t('movedToUnsortedToast'));
            }
        });
    });
}

export function bringCardsToFrontOnDragStart(cardIds) {
    if (!Array.isArray(cardIds) || cardIds.length === 0) return;
    const ordered = cardIds.slice().sort((a, b) => {
        const ca = S.cards.find(c => c.id === a);
        const cb = S.cards.find(c => c.id === b);
        return (ca?.zIndex || 10) - (cb?.zIndex || 10);
    });
    let nextZ = getNextTopZIndex();
    ordered.forEach(id => {
        const mem = S.cards.find(c => c.id === id);
        if (mem) mem.zIndex = nextZ;
        const sysMem = S.allSystemCards.find(c => c.id === id);
        if (sysMem) sysMem.zIndex = nextZ;
        const el = document.querySelector<HTMLElement>(`.interactive-card[data-id="${id}"]`);
        if (el) el.style.zIndex = String(nextZ);
        nextZ++;
    });
}

export function syncCanvasDragOverlayTransform() {
    const vp = document.getElementById('canvas-viewport');
    const world = document.getElementById('canvas-drag-overlay-world');
    if (!vp || !world) return;
    const rect = vp.getBoundingClientRect();
    world.style.transform = `translate(${rect.left + S.canvasPanX}px, ${rect.top + S.canvasPanY}px) scale(${S.canvasScale})`;
}

export function setDraggedCardsElevated(shouldElevate) {
    const overlay = document.getElementById('canvas-drag-overlay');
    const overlayWorld = document.getElementById('canvas-drag-overlay-world');
    const contentLayer = document.getElementById('canvas-content');
    if (!overlay || !overlayWorld || !contentLayer) return;

    if (shouldElevate) {
        syncCanvasDragOverlayTransform();
        overlay.classList.remove('hidden');
        if (!S.areDraggedCardsElevated) {
            S.initialCardPositions.forEach((_, id) => {
                const el = contentLayer.querySelector(`.interactive-card[data-id="${id}"]`);
                if (el) overlayWorld.appendChild(el);
            });
            S.areDraggedCardsElevated = true;
        }
    } else {
        if (S.areDraggedCardsElevated) {
            S.initialCardPositions.forEach((_, id) => {
                const el = overlayWorld.querySelector(`.interactive-card[data-id="${id}"]`);
                if (el) contentLayer.appendChild(el);
            });
            S.areDraggedCardsElevated = false;
        }
        overlay.classList.add('hidden');
    }
}

export function getHoveredTaskCard(clientX, clientY, excludedIdsSet) {
    const taskCards = document.querySelectorAll<HTMLElement>('.interactive-card[data-type="task"]');
    for (const cardEl of taskCards) {
        if (excludedIdsSet && excludedIdsSet.has(cardEl.dataset.id)) continue;
        const r = cardEl.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
            return cardEl;
        }
    }
    return null;
}

export function getHoveredTaskRowInfo(taskCardEl: Element | null, clientY: number): { rowEl: HTMLElement | null; insertIdx: number | null } {
    if (!taskCardEl) return { rowEl: null, insertIdx: null };
    const rows = Array.from(taskCardEl.querySelectorAll<HTMLElement>('.task-row'));
    for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (clientY <= r.top + r.height * 0.65) {
            const idx = Number(row.dataset.taskIndex);
            return { rowEl: row, insertIdx: Number.isFinite(idx) ? idx : null };
        }
    }
    return { rowEl: null, insertIdx: null };
}

export function clearTaskDropHighlights() {
    document.querySelectorAll('.interactive-card[data-type="task"].ring-1').forEach(el => {
        el.classList.remove('ring-1', 'ring-zinc-400');
    });
    document.querySelectorAll('.task-row.border-t-2').forEach(el => {
        el.classList.remove('border-t-2', 'border-zinc-300');
    });
}

export function updateCanvasCardDragElevationAndFeedback(clientX, clientY, hoveredTrash, hoveredUnsorted, hoveredBoard, hoveredBreadcrumb) {
    const vp = document.getElementById('canvas-viewport');
    if (!vp) return;
    const vpRect = vp.getBoundingClientRect();
    const isOutsideCanvas = clientX < vpRect.left || clientX > vpRect.right || clientY < vpRect.top || clientY > vpRect.bottom;

    let cardCrossesBarEdge = false;
    S.initialCardPositions.forEach((_, id) => {
        const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
        if (el && !cardCrossesBarEdge) {
            const r = el.getBoundingClientRect();
            if (r.left < vpRect.left + 2 || r.right > vpRect.right - 2 || r.top < vpRect.top + 2) {
                cardCrossesBarEdge = true;
            }
        }
    });

    const shouldElevate = Boolean(hoveredTrash || hoveredUnsorted || hoveredBreadcrumb || isOutsideCanvas || cardCrossesBarEdge);
    setDraggedCardsElevated(shouldElevate);

    S.isDragOverInteractiveArea = Boolean(hoveredTrash || hoveredUnsorted || hoveredBreadcrumb || hoveredBoard);
    S.initialCardPositions.forEach((_, id) => {
        const el = document.querySelector<HTMLElement>(`.interactive-card[data-id="${id}"]`);
        if (el) {
            el.style.opacity = S.isDragOverInteractiveArea ? '0.72' : '';
        }
    });
}

export function getToolPreviewDimensions(type) {
    if (type === 'subboard') return { w: 140, h: 140 };
    if (type === 'document') return { w: 96, h: 144 };
    if (type === 'image') return { w: 270, h: 180 };
    if (type === 'table') return { w: 380, h: 180 };
    if (type === 'comment') return { w: 256, h: 132 };
    return { w: 270, h: 170 };
}

export function buildToolDragGhostEl(type) {
    const dims = getToolPreviewDimensions(type);
    const title = getLocalizedCardLabel(type);
    const wrap = document.createElement('div');
    wrap.className = 'bg-[#26262a] border border-white/[0.12] rounded-[4px] p-3 flex flex-col pointer-events-none select-none';
    wrap.style.width = `${dims.w}px`;
    wrap.style.minHeight = `${dims.h}px`;

    let iconSvg = '';
    if (type === 'sticky') { iconSvg = '<svg class="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>'; }
    else if (type === 'task') { iconSvg = '<svg class="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>'; }
    else if (type === 'link') { iconSvg = '<svg class="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>'; }
    else if (type === 'subboard') { iconSvg = '<svg class="w-4 h-4 text-zinc-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'; }
    else if (type === 'column') { iconSvg = '<svg class="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>'; }
    else if (type === 'document') { iconSvg = '<svg class="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>'; }
    else if (type === 'comment') { iconSvg = '<svg class="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'; }
    else if (type === 'table') { iconSvg = '<svg class="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>'; }
    else if (type === 'image') { iconSvg = '<svg class="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'; }

    if (type === 'subboard') {
        wrap.className = 'flex flex-col items-center justify-center pointer-events-none select-none';
        wrap.style.width = `${dims.w}px`;
        wrap.style.minHeight = `${dims.h}px`;
        wrap.innerHTML = `
            <div class="w-24 h-24 rounded-[22px] bg-[#78787a] border border-white/15 flex items-center justify-center shadow-2xl">
                <svg class="w-9 h-9 text-white/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <div class="mt-2 px-2 py-0.5 rounded bg-[#26262a] border border-white/10 text-[11px] font-medium text-zinc-200 truncate max-w-[130px]">${escapeHtml(title)}</div>
        `;
    } else if (type === 'document') {
        wrap.className = 'flex flex-col items-center justify-center pointer-events-none select-none';
        wrap.style.width = `${dims.w}px`;
        wrap.style.minHeight = `${dims.h}px`;
        wrap.innerHTML = `
            <div class="w-24 h-28 rounded-[4px] bg-[#26262a] border border-white/[0.14] p-2.5 flex flex-col gap-1.5 shadow-2xl">
                <div class="h-1.5 w-12 rounded-full bg-zinc-400/50"></div>
                <div class="h-1 w-full rounded-full bg-zinc-500/35 mt-1"></div>
                <div class="h-1 w-4/5 rounded-full bg-zinc-500/30"></div>
                <div class="h-1 w-full rounded-full bg-zinc-500/30"></div>
            </div>
            <div class="mt-1.5 text-[11px] font-medium text-zinc-200 truncate max-w-[130px]">${escapeHtml(title)}</div>
        `;
    } else if (type === 'table') {
        wrap.innerHTML = `
            <div class="flex items-center space-x-2 mb-2">
                ${iconSvg}
                <span class="text-xs font-medium text-zinc-200 truncate">${escapeHtml(title)}</span>
            </div>
            <div class="grid grid-cols-3 gap-1 flex-1 border border-white/10 rounded p-1.5 bg-black/20">
                <div class="h-4 rounded-sm bg-white/[0.06]"></div><div class="h-4 rounded-sm bg-white/[0.06]"></div><div class="h-4 rounded-sm bg-white/[0.06]"></div>
                <div class="h-4 rounded-sm bg-white/[0.03]"></div><div class="h-4 rounded-sm bg-white/[0.03]"></div><div class="h-4 rounded-sm bg-white/[0.03]"></div>
                <div class="h-4 rounded-sm bg-white/[0.03]"></div><div class="h-4 rounded-sm bg-white/[0.03]"></div><div class="h-4 rounded-sm bg-white/[0.03]"></div>
            </div>
        `;
    } else {
        wrap.innerHTML = `
            <div class="flex items-center space-x-2 mb-2">
                ${iconSvg}
                <span class="text-xs font-medium text-zinc-200 truncate">${escapeHtml(title)}</span>
            </div>
            <div class="text-xs text-zinc-400 flex-1">${escapeHtml(type === 'task' ? t('firstTask') : type === 'image' ? t('toolImage') : type === 'comment' ? t('commentPlaceholder') : t('startTyping'))}</div>
        `;
    }
    return wrap;
}

export function buildUnsortedDragGhostEl(el, count) {
    const clone = el.cloneNode(true);
    clone.style.width = `${el.offsetWidth}px`;
    clone.style.margin = '0';
    clone.style.opacity = '1';
    clone.classList.add('pointer-events-none', 'select-none');
    clone.querySelectorAll('button').forEach(btn => btn.remove());
    const img = clone.querySelector('img');
    if (img) img.classList.remove('outline', 'outline-2', 'outline-white');
    const textBox = clone.querySelector('.unsorted-text-box');
    if (textBox) {
        textBox.classList.remove('border-white');
        textBox.classList.add('border-white/15');
    }
    if (count > 1) {
        const badge = document.createElement('div');
        badge.className = 'absolute -top-2 -right-2 px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-900 text-[10px] font-bold shadow-lg border border-black/20';
        badge.textContent = `${count}`;
        clone.appendChild(badge);
    }
    return clone;
}

export function buildTrashDragGhostEl(el) {
    const clone = el.cloneNode(true);
    clone.style.width = `${el.offsetWidth}px`;
    clone.style.margin = '0';
    clone.style.backgroundColor = '#222226';
    clone.style.borderColor = 'rgba(255,255,255,0.16)';
    clone.classList.add('pointer-events-none', 'select-none');
    clone.querySelectorAll('button').forEach(btn => btn.remove());
    return clone;
}

export function buildTaskDragGhostEl(taskText, widthPx) {
    const wrap = document.createElement('div');
    wrap.className = 'bg-[#26262a] border border-white/[0.14] rounded-md px-3 py-2 flex items-center gap-2 text-xs text-zinc-200 pointer-events-none select-none';
    wrap.style.width = `${widthPx || 220}px`;
    wrap.innerHTML = `
        <span class="w-3.5 h-3.5 rounded-[2px] border border-zinc-400 shrink-0"></span>
        <span class="truncate font-medium">${escapeHtml(taskText || t('taskDefault'))}</span>
    `;
    return wrap;
}

export function queueFloatingPhysicsDrag(opts) {
    S.pendingFloatingDrag = opts;
}

export function startFloatingPhysicsDrag(opts, clientX, clientY) {
    const ghostContainer = document.getElementById('floating-drag-ghost');
    if (!ghostContainer) return;
    const previewEl = opts.createPreview();
    const cardFrame = document.createElement('div');
    cardFrame.className = 'floating-physics-card rounded-[6px]';
    cardFrame.style.opacity = '0.85';
    cardFrame.style.transform = 'scale(1.015) rotate(0deg)';
    cardFrame.appendChild(previewEl);

    ghostContainer.innerHTML = '';
    ghostContainer.appendChild(cardFrame);
    ghostContainer.style.left = `${Math.round(clientX - opts.grabX)}px`;
    ghostContainer.style.top = `${Math.round(clientY - opts.grabY)}px`;
    ghostContainer.classList.remove('hidden');

    const sourceEls = opts.getSourceEls ? opts.getSourceEls() : (opts.sourceEls || []);
    sourceEls.forEach(sEl => {
        if (sEl) sEl.style.opacity = '0.32';
    });

    if (opts.source === 'toolbar') {
        S.internalDragPayload = { source: 'toolbar', type: opts.payload.type };
    } else if (opts.source === 'unsorted') {
        S.internalDragPayload = { source: 'unsorted', ...opts.payload };
    } else if (opts.source === 'trash') {
        S.internalDragPayload = { source: 'trash', ...opts.payload };
    } else if (opts.source === 'task') {
        S.draggedTaskPayload = { cardId: opts.payload.cardId, taskIdx: opts.payload.taskIdx };
    }

    if (typeof opts.onDragStart === 'function') opts.onDragStart();
    document.body.classList.add('is-canvas-interacting');

    S.floatingDragState = {
        ...opts,
        sourceEls,
        ghostContainer,
        cardFrame,
        clientX,
        clientY,
        lastClientX: clientX,
        velocityX: 0,
        currentTilt: 0,
        currentScale: 1.015,
        isInteractiveTarget: false,
        hoveredTrash: null,
        hoveredUnsorted: null,
        hoveredBreadcrumb: null,
        hoveredBoard: null,
        hoveredTaskCard: null,
        hoveredTaskInsertIdx: null,
        overCanvas: false,
        rafId: null
    };

    const stepFloatingPhysics = () => {
        if (!S.floatingDragState) return;
        const st = S.floatingDragState;
        const targetTilt = Math.max(-3.6, Math.min(3.6, st.velocityX * 0.22));
        st.currentTilt += (targetTilt - st.currentTilt) * 0.28;
        st.velocityX *= 0.78;
        const targetScale = st.isInteractiveTarget ? 0.84 : 1.015;
        st.currentScale += (targetScale - st.currentScale) * 0.25;
        st.cardFrame.style.transform = `translate3d(0, -3px, 0) scale(${st.currentScale.toFixed(3)}) rotate(${st.currentTilt.toFixed(2)}deg)`;
        st.rafId = requestAnimationFrame(stepFloatingPhysics);
    };
    S.floatingDragState.rafId = requestAnimationFrame(stepFloatingPhysics);
    updateFloatingPhysicsDragPosition(clientX, clientY);
}

export function updateFloatingPhysicsDragPosition(clientX, clientY) {
    if (!S.floatingDragState) return;
    const st = S.floatingDragState;
    st.velocityX = Math.max(-35, Math.min(35, clientX - st.lastClientX));
    st.lastClientX = clientX;
    st.clientX = clientX;
    st.clientY = clientY;

    st.ghostContainer.style.left = `${Math.round(clientX - st.grabX)}px`;
    st.ghostContainer.style.top = `${Math.round(clientY - st.grabY)}px`;

    if (st.source === 'trash') {
        const trashModal = document.getElementById('trash-modal');
        const trashDialog = trashModal?.querySelector('.card-shadow');
        if (trashModal && trashDialog) {
            const dr = trashDialog.getBoundingClientRect();
            const insideDialog = clientX >= dr.left && clientX <= dr.right && clientY >= dr.top && clientY <= dr.bottom;
            trashModal.classList.toggle('trash-modal-dragging-out', !insideDialog);
        }
    }

    clearDropTargetHighlights();
    clearTaskDropHighlights();

    const vp = document.getElementById('canvas-viewport');
    const vpRect = vp ? vp.getBoundingClientRect() : null;
    const overCanvas = Boolean(vpRect && clientX >= vpRect.left && clientX <= vpRect.right && clientY >= vpRect.top && clientY <= vpRect.bottom);
    st.overCanvas = overCanvas;

    let hoveredTrash = null;
    let hoveredUnsorted = null;
    let hoveredBreadcrumb = null;
    let hoveredBoard = null;
    let hoveredTaskCard = null;
    let hoveredTaskInsertIdx = null;

    if (st.source === 'toolbar') {
        if (st.payload.type !== 'image') {
            hoveredUnsorted = getHoveredUnsortedTarget(clientX, clientY);
            if (!hoveredUnsorted) hoveredBreadcrumb = getHoveredBreadcrumbTab(clientX, clientY);
            if (!hoveredUnsorted && !hoveredBreadcrumb && overCanvas) {
                hoveredBoard = getHoveredBoardNode(clientX, clientY, null);
            }
        }
    } else if (st.source === 'unsorted') {
        hoveredTrash = getHoveredTrashBtn(clientX, clientY);
        if (!hoveredTrash) hoveredBreadcrumb = getHoveredBreadcrumbTab(clientX, clientY);
        if (!hoveredTrash && !hoveredBreadcrumb && overCanvas) {
            hoveredTaskCard = getHoveredTaskCard(clientX, clientY, null);
            if (hoveredTaskCard) {
                const rowInfo = getHoveredTaskRowInfo(hoveredTaskCard, clientY);
                hoveredTaskInsertIdx = rowInfo.insertIdx;
                hoveredTaskCard.classList.add('ring-1', 'ring-zinc-400');
                if (rowInfo.rowEl) rowInfo.rowEl.classList.add('border-t-2', 'border-zinc-300');
            } else {
                hoveredBoard = getHoveredBoardNode(clientX, clientY, null);
            }
        }
    } else if (st.source === 'trash') {
        const trashModal = document.getElementById('trash-modal');
        const overCanvasArea = !trashModal || trashModal.classList.contains('trash-modal-dragging-out');
        if (overCanvasArea) {
            hoveredUnsorted = getHoveredUnsortedTarget(clientX, clientY);
            if (!hoveredUnsorted) hoveredBreadcrumb = getHoveredBreadcrumbTab(clientX, clientY);
            if (!hoveredUnsorted && !hoveredBreadcrumb && overCanvas) {
                hoveredBoard = getHoveredBoardNode(clientX, clientY, null);
            }
        }
    } else if (st.source === 'task') {
        hoveredTrash = getHoveredTrashBtn(clientX, clientY);
        if (!hoveredTrash) hoveredUnsorted = getHoveredUnsortedTarget(clientX, clientY);
        if (!hoveredTrash && !hoveredUnsorted) hoveredBreadcrumb = getHoveredBreadcrumbTab(clientX, clientY);
        if (!hoveredTrash && !hoveredUnsorted && !hoveredBreadcrumb && overCanvas) {
            hoveredTaskCard = getHoveredTaskCard(clientX, clientY, null);
            if (hoveredTaskCard) {
                const rowInfo = getHoveredTaskRowInfo(hoveredTaskCard, clientY);
                hoveredTaskInsertIdx = rowInfo.insertIdx;
                hoveredTaskCard.classList.add('ring-1', 'ring-zinc-400');
                if (rowInfo.rowEl) rowInfo.rowEl.classList.add('border-t-2', 'border-zinc-300');
            } else {
                hoveredBoard = getHoveredBoardNode(clientX, clientY, null);
            }
        }
    }

    if (hoveredTrash) hoveredTrash.classList.add('trash-drop-active');
    if (hoveredUnsorted) hoveredUnsorted.classList.add('unsorted-drop-active');
    if (hoveredBreadcrumb) hoveredBreadcrumb.classList.add('breadcrumb-drop-active');
    if (hoveredBoard) hoveredBoard.classList.add('board-drop-target');

    st.hoveredTrash = hoveredTrash;
    st.hoveredUnsorted = hoveredUnsorted;
    st.hoveredBreadcrumb = hoveredBreadcrumb;
    st.hoveredBoard = hoveredBoard;
    st.hoveredTaskCard = hoveredTaskCard;
    st.hoveredTaskInsertIdx = hoveredTaskInsertIdx;
    st.isInteractiveTarget = Boolean(hoveredTrash || hoveredUnsorted || hoveredBreadcrumb || hoveredBoard || hoveredTaskCard);

    if (st.isInteractiveTarget) {
        st.cardFrame.style.opacity = '0.72';
    } else if (st.source === 'toolbar' && !overCanvas) {
        st.cardFrame.style.opacity = '0.68';
    } else {
        st.cardFrame.style.opacity = '0.85';
    }
}

export function cancelFloatingPhysicsDrag() {
    S.pendingFloatingDrag = null;
    if (!S.floatingDragState) return;
    const st = S.floatingDragState;
    S.floatingDragState = null;
    if (st.rafId) cancelAnimationFrame(st.rafId);
    st.ghostContainer.classList.add('hidden');
    st.ghostContainer.innerHTML = '';
    st.sourceEls.forEach(sEl => {
        if (sEl) sEl.style.opacity = '';
    });
    const trashModal = document.getElementById('trash-modal');
    if (trashModal) trashModal.classList.remove('trash-modal-dragging-out');
    clearDropTargetHighlights();
    clearTaskDropHighlights();
    S.internalDragPayload = null;
    S.draggedTaskPayload = null;
    document.body.classList.remove('is-canvas-interacting');
    if (typeof st.onDragEnd === 'function') st.onDragEnd();
}

export async function finishFloatingPhysicsDrag(clientX, clientY) {
    S.pendingFloatingDrag = null;
    if (!S.floatingDragState) return;
    updateFloatingPhysicsDragPosition(clientX, clientY);
    const st = S.floatingDragState;
    S.floatingDragState = null;
    if (st.rafId) cancelAnimationFrame(st.rafId);

    st.ghostContainer.classList.add('hidden');
    st.ghostContainer.innerHTML = '';
    st.sourceEls.forEach(sEl => {
        if (sEl) sEl.style.opacity = '';
    });
    const trashModal = document.getElementById('trash-modal');
    const wasDraggedOutOfTrashModal = Boolean(trashModal && trashModal.classList.contains('trash-modal-dragging-out'));
    if (trashModal) trashModal.classList.remove('trash-modal-dragging-out');

    clearDropTargetHighlights();
    clearTaskDropHighlights();
    document.body.classList.remove('is-canvas-interacting');

    const vp = document.getElementById('canvas-viewport');
    const vpRect = vp ? vp.getBoundingClientRect() : null;
    const mouseCanvasX = vpRect ? (clientX - vpRect.left - S.canvasPanX) / S.canvasScale : 100;
    const mouseCanvasY = vpRect ? (clientY - vpRect.top - S.canvasPanY) / S.canvasScale : 100;

    try {
        if (st.source === 'toolbar') {
            const type = st.payload.type;
            if (type === 'image') {
                if (st.overCanvas) triggerImageUpload();
            } else if (st.hoveredUnsorted) {
                await createCardAt(type, 100, 100, 'unsorted');
                await renderUnsortedDrawer(true);
                playCozySound('unsorted');
                showToast(t('addedToUnsorted'));
            } else if (st.hoveredBreadcrumb) {
                const targetBoardId = st.hoveredBreadcrumb.dataset.breadcrumbBoardId;
                await createCardAt(type, 160, 140, targetBoardId);
                flashBreadcrumbDropTab(targetBoardId);
                playCozySound('tabDrop');
                showToast(t('cardMovedToBoard'));
            } else if (st.hoveredBoard) {
                const targetBoardId = st.hoveredBoard.dataset.id;
                await createCardAt(type, 160, 140, targetBoardId);
                playBoardPoofEffect(targetBoardId);
                playCozySound('boardDrop');
                showToast(t('cardMovedToBoard'));
            } else if (st.overCanvas) {
                const dims = getToolPreviewDimensions(type);
                await createCardAt(type, mouseCanvasX - (dims.w / 2), mouseCanvasY - (dims.h / 2));
                playCozySound('pop');
            }
        } else if (st.source === 'unsorted') {
            const cardIds = st.payload.cardIds || [];
            if (st.hoveredTrash) {
                await pushUndoSnapshot();
                let trashedAny = false;
                for (const cardId of cardIds) {
                    const c = await dbGet('cards', cardId);
                    if (c && !c.isTrash) {
                        c.isTrash = true;
                        c.deletedAt = Date.now();
                        await dbPut('cards', c);
                        S.selectedUnsortedCardIds.delete(cardId);
                        trashedAny = true;
                    }
                }
                if (trashedAny) {
                    await fetchAndRenderCards();
                    await updateTrashBadge();
                    const all = await dbGetAll('cards');
                    const unsortedCount = all.filter(c => c.boardId === 'unsorted' && !c.isTrash).length;
                    if (unsortedCount === 0 && S.isSidebarOpen && window.innerWidth >= 768) toggleSidebar();
                    playCozySound('trash');
                    showToast(t('movedToTrash'));
                }
            } else if (st.hoveredBreadcrumb) {
                await moveCardsToBoard(cardIds, st.hoveredBreadcrumb.dataset.breadcrumbBoardId, { isBreadcrumb: true });
            } else if (st.hoveredTaskCard) {
                await pushUndoSnapshot();
                await importExternalCardsAsTasks(cardIds, st.hoveredTaskCard.dataset.id, st.hoveredTaskInsertIdx);
                playCozySound('check');
            } else if (st.hoveredBoard) {
                await moveCardsToBoard(cardIds, st.hoveredBoard.dataset.id);
            } else if (st.overCanvas) {
                await pushUndoSnapshot();
                let offsetX = 0, offsetY = 0;
                let nextZ = getNextTopZIndex();
                const ratioX = typeof st.payload.grabRatioX === 'number' ? st.payload.grabRatioX : 0.5;
                const ratioY = typeof st.payload.grabRatioY === 'number' ? st.payload.grabRatioY : 0.5;
                for (const cardId of cardIds) {
                    const card = await dbGet('cards', cardId);
                    if (card) {
                        const targetW = card.width || (card.type === 'subboard' ? 140 : card.type === 'document' ? 96 : card.type === 'table' ? 380 : card.type === 'comment' ? 256 : 270);
                        const targetH = card.height || (card.type === 'subboard' ? 140 : card.type === 'document' ? 144 : card.type === 'table' ? 180 : card.type === 'comment' ? 132 : 170);
                        card.boardId = S.currentBoardId;
                        card.x = Math.round(mouseCanvasX - ratioX * targetW + offsetX);
                        card.y = Math.round(mouseCanvasY - ratioY * targetH + offsetY);
                        card.zIndex = nextZ++;
                        await dbPut('cards', card);
                        offsetX += 20;
                        offsetY += 20;
                    }
                }
                S.selectedUnsortedCardIds.clear();
                await fetchAndRenderCards();
                const allCards = await dbGetAll('cards');
                const unsortedCount = allCards.filter(c => c.boardId === 'unsorted' && !c.isTrash).length;
                if (unsortedCount === 0 && S.isSidebarOpen) toggleSidebar();
                playCozySound('pop');
            }
        } else if (st.source === 'trash') {
            const card = await dbGet('cards', st.payload.cardId);
            if (card && wasDraggedOutOfTrashModal && (st.hoveredUnsorted || st.hoveredBreadcrumb || st.hoveredBoard || st.overCanvas)) {
                await pushUndoSnapshot();
                card.isTrash = false;
                card.deletedAt = null;
                if (st.hoveredUnsorted) {
                    card.boardId = 'unsorted';
                    await dbPut('cards', card);
                    await fetchAndRenderCards();
                    await renderUnsortedDrawer(true);
                    playCozySound('unsorted');
                } else if (st.hoveredBreadcrumb) {
                    const targetBoardId = st.hoveredBreadcrumb.dataset.breadcrumbBoardId;
                    card.boardId = targetBoardId;
                    await dbPut('cards', card);
                    await fetchAndRenderCards();
                    flashBreadcrumbDropTab(targetBoardId);
                    playCozySound('tabDrop');
                } else if (st.hoveredBoard) {
                    const targetBoardId = st.hoveredBoard.dataset.id;
                    card.boardId = targetBoardId;
                    await dbPut('cards', card);
                    await fetchAndRenderCards();
                    playBoardPoofEffect(targetBoardId);
                    playCozySound('boardDrop');
                } else {
                    const targetW = card.width || (card.type === 'subboard' ? 140 : card.type === 'document' ? 96 : card.type === 'table' ? 380 : card.type === 'comment' ? 256 : 270);
                    const targetH = card.height || (card.type === 'subboard' ? 140 : card.type === 'document' ? 144 : card.type === 'table' ? 180 : card.type === 'comment' ? 132 : 170);
                    const ratioX = typeof st.payload.grabRatioX === 'number' ? st.payload.grabRatioX : 0.5;
                    const ratioY = typeof st.payload.grabRatioY === 'number' ? st.payload.grabRatioY : 0.5;
                    card.boardId = S.currentBoardId;
                    card.zIndex = getNextTopZIndex();
                    card.x = Math.round(mouseCanvasX - ratioX * targetW);
                    card.y = Math.round(mouseCanvasY - ratioY * targetH);
                    await dbPut('cards', card);
                    await fetchAndRenderCards();
                    playCozySound('restore');
                }
                await renderTrashList();
                await updateTrashBadge();
                const allCards = await dbGetAll('cards');
                if (allCards.filter(c => c.isTrash).length === 0) closeTrashModal();
                showToast(t('itemRestored'));
            }
        } else if (st.source === 'task') {
            const { cardId, taskIdx } = st.payload;
            const sourceCard = await dbGet('cards', cardId);
            if (sourceCard && sourceCard.tasks && sourceCard.tasks[taskIdx]) {
                if (st.hoveredTrash) {
                    await pushUndoSnapshot();
                    const [removedTask] = sourceCard.tasks.splice(taskIdx, 1);
                    await dbPut('cards', sourceCard);
                    await dbPut('cards', {
                        id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                        boardId: S.currentBoardId,
                        type: 'task',
                        title: removedTask.text || t('labelTask'),
                        tasks: [removedTask],
                        x: 100, y: 100, width: 270, height: 170,
                        isTrash: true, deletedAt: Date.now(), createdAt: Date.now()
                    });
                    await fetchAndRenderCards();
                    await updateTrashBadge();
                    playCozySound('trash');
                    showToast(t('movedToTrash'));
                } else if (st.hoveredUnsorted) {
                    await pushUndoSnapshot();
                    const [removedTask] = sourceCard.tasks.splice(taskIdx, 1);
                    await dbPut('cards', sourceCard);
                    await dbPut('cards', {
                        id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                        boardId: 'unsorted',
                        type: 'task',
                        title: removedTask.text || t('labelTask'),
                        tasks: [removedTask],
                        x: 100, y: 100, width: 270, height: 170,
                        zIndex: getNextTopZIndex(),
                        isTrash: false, createdAt: Date.now()
                    });
                    if (!S.isSidebarOpen) {
                        S.isSidebarOpen = true;
                        S.hasExplicitSidebarPref = true;
                        applySidebarDomState();
                        saveUIState();
                    }
                    await fetchAndRenderCards();
                    playCozySound('unsorted');
                    showToast(t('movedToUnsortedToast'));
                } else if (st.hoveredBreadcrumb) {
                    await pushUndoSnapshot();
                    const targetBoardId = st.hoveredBreadcrumb.dataset.breadcrumbBoardId;
                    const [removedTask] = sourceCard.tasks.splice(taskIdx, 1);
                    await dbPut('cards', sourceCard);
                    await dbPut('cards', {
                        id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                        boardId: targetBoardId,
                        type: 'task',
                        title: t('labelTask'),
                        tasks: [removedTask],
                        x: 100, y: 100, width: 270, height: 170,
                        zIndex: getNextTopZIndex(),
                        isTrash: false, createdAt: Date.now()
                    });
                    await fetchAndRenderCards();
                    flashBreadcrumbDropTab(targetBoardId);
                    playCozySound('tabDrop');
                    showToast(t('cardMovedToBoard'));
                } else if (st.hoveredTaskCard) {
                    await pushUndoSnapshot();
                    await moveTaskToCard(cardId, taskIdx, st.hoveredTaskCard.dataset.id, st.hoveredTaskInsertIdx);
                    playCozySound('check');
                } else if (st.hoveredBoard) {
                    await pushUndoSnapshot();
                    const targetBoardId = st.hoveredBoard.dataset.id;
                    const [removedTask] = sourceCard.tasks.splice(taskIdx, 1);
                    await dbPut('cards', sourceCard);
                    await dbPut('cards', {
                        id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                        boardId: targetBoardId,
                        type: 'task',
                        title: t('labelTask'),
                        tasks: [removedTask],
                        x: 100, y: 100, width: 270, height: 170,
                        zIndex: getNextTopZIndex(),
                        isTrash: false, createdAt: Date.now()
                    });
                    await fetchAndRenderCards();
                    playBoardPoofEffect(targetBoardId);
                    playCozySound('boardDrop');
                    showToast(t('cardMovedToBoard'));
                } else if (st.overCanvas) {
                    await pushUndoSnapshot();
                    const [removedTask] = sourceCard.tasks.splice(taskIdx, 1);
                    await dbPut('cards', sourceCard);
                    await dbPut('cards', {
                        id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                        boardId: S.currentBoardId,
                        type: 'task',
                        title: t('labelTask'),
                        tasks: [removedTask],
                        x: Math.round(mouseCanvasX - 135),
                        y: Math.round(mouseCanvasY - 85),
                        width: 270, height: 170, zIndex: getNextTopZIndex(),
                        isTrash: false, createdAt: Date.now()
                    });
                    await fetchAndRenderCards();
                    playCozySound('pop');
                    showToast(t('taskMovedNewCard'));
                }
            }
        }
    } finally {
        S.internalDragPayload = null;
        S.draggedTaskPayload = null;
        if (typeof st.onDragEnd === 'function') st.onDragEnd();
    }
}
