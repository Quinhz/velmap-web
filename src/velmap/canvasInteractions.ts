import { openDocumentModal, renderUnsortedDrawer, updateTrashBadge } from './cardActions';
import { fetchAndRenderCards } from './cardRenderer';
import { buildConnectionGeometry, drawConnections, getAnchorFromCanvasPoint, getBestAutoAnchors, getEventPoint, resolveAnchorPoint, startConnectionDraw } from './connections';
import { openContextMenuAt } from './contextMenu';
import { dbGet, dbPut } from './db';
import { bringCardsToFrontOnDragStart, clearDropTargetHighlights, getHoveredBoardNode, getHoveredBreadcrumbTab, getHoveredTrashBtn, getHoveredUnsortedTarget, moveCardsToBoard, setDraggedCardsElevated, updateCanvasCardDragElevationAndFeedback } from './dragDrop';
import { captureWorkspaceSnapshot, pushUndoSnapshot } from './history';
import { openSubBoard } from './homeView';
import { t } from './i18n';
import { playCozySound } from './sound';
import { S } from './state';
import { setTool, syncSelectionVisuals } from './toolbar';
import { applySidebarDomState, enterCardEditMode, exitCardEditMode, saveUIState, scheduleSaveUIState, showToast } from './uiState';

export function startDragPhysics(cardIds) {
    if (S.dragPhysicsRaf) cancelAnimationFrame(S.dragPhysicsRaf);
    S.dragVelocityX = 0;
    S.dragCurrentTilt = 0;
    S.dragCurrentScale = 1.015;
    S.isDragOverInteractiveArea = false;
    cardIds.forEach(id => {
        const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
        if (el) {
            el.classList.remove('is-settling-card');
            el.classList.add('is-dragging-card');
        }
    });
    const stepPhysics = () => {
        if (!S.isDraggingCards) {
            S.dragPhysicsRaf = null;
            return;
        }
        const targetTilt = Math.max(-3.6, Math.min(3.6, S.dragVelocityX * 0.22));
        S.dragCurrentTilt += (targetTilt - S.dragCurrentTilt) * 0.28;
        S.dragVelocityX *= 0.78;
        const targetScale = S.isDragOverInteractiveArea ? 0.84 : 1.015;
        S.dragCurrentScale += (targetScale - S.dragCurrentScale) * 0.25;
        S.initialCardPositions.forEach((_, id) => {
            const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
            if (el) {
                el.style.transform = `translate3d(0, -3px, 0) scale(${S.dragCurrentScale.toFixed(3)}) rotate(${S.dragCurrentTilt.toFixed(2)}deg)`;
            }
        });
        S.dragPhysicsRaf = requestAnimationFrame(stepPhysics);
    };
    S.dragPhysicsRaf = requestAnimationFrame(stepPhysics);
}

export function stopDragPhysics() {
    if (S.dragPhysicsRaf) {
        cancelAnimationFrame(S.dragPhysicsRaf);
        S.dragPhysicsRaf = null;
    }
    S.dragVelocityX = 0;
    S.dragCurrentTilt = 0;
    S.dragCurrentScale = 1.015;
    S.isDragOverInteractiveArea = false;
    setDraggedCardsElevated(false);
    S.initialCardPositions.forEach((_, id) => {
        const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
        if (el) {
            el.classList.remove('is-dragging-card');
            el.classList.add('is-settling-card');
            el.style.transform = '';
            el.style.opacity = '';
            setTimeout(() => el.classList.remove('is-settling-card'), 360);
        }
    });
}

export function setupCanvasInteractions() {
    const viewport = document.getElementById('canvas-viewport');
    const marquee = document.getElementById('marquee-box');

    function handlePointerMove(clientX, clientY) {
        if (S.pendingCardDrag && !S.isDraggingCards) {
            const distMoved = Math.hypot(clientX - S.pendingCardDrag.startX, clientY - S.pendingCardDrag.startY);
            if (distMoved >= 4) {
                const dragInfo = S.pendingCardDrag;
                S.pendingCardDrag = null;
                const dragIds = dragInfo.wasAlreadySelected ? Array.from(S.selectedCardIds) : [dragInfo.cardId];
                S.pendingDragUndoSnapshot = captureWorkspaceSnapshot();
                S.isDraggingCards = true;
                document.body.classList.add('is-canvas-interacting');
                S.dragStartMouseX = dragInfo.startX;
                S.dragStartMouseY = dragInfo.startY;
                S.dragLastClientX = clientX;
                S.initialCardPositions.clear();
                dragIds.forEach(id => {
                    const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
                    if (el) S.initialCardPositions.set(id, { x: parseFloat(el.style.left), y: parseFloat(el.style.top) });
                });
                bringCardsToFrontOnDragStart(dragIds);
                startDragPhysics(dragIds);
                S.internalDragPayload = { source: 'canvas', cardIds: dragIds };
            }
        }
        if (S.isPanning) { S.canvasPanX = clientX - S.startPanX; S.canvasPanY = clientY - S.startPanY; updateCanvasTransform(); }
        else if (S.isMarqueeSelecting) {
            const rect = viewport.getBoundingClientRect();
            const cX = clientX - rect.left; const cY = clientY - rect.top;
            const l = Math.min(S.marqueeStartX, cX); const t = Math.min(S.marqueeStartY, cY);
            const w = Math.abs(cX - S.marqueeStartX); const h = Math.abs(cY - S.marqueeStartY);
            marquee.style.left = `${l}px`; marquee.style.top = `${t}px`; marquee.style.width = `${w}px`; marquee.style.height = `${h}px`;

            const wL = (l - S.canvasPanX) / S.canvasScale; const wT = (t - S.canvasPanY) / S.canvasScale;
            const wR = (l + w - S.canvasPanX) / S.canvasScale; const wB = (t + h - S.canvasPanY) / S.canvasScale;
            document.querySelectorAll('.interactive-card').forEach(el => {
                const cL = parseFloat(el.style.left); const cT = parseFloat(el.style.top);
                if (!(cL + el.offsetWidth < wL || cL > wR || cT + el.offsetHeight < wT || cT > wB)) S.selectedCardIds.add(el.dataset.id);
            });
            syncSelectionVisuals();
        } 
        else if (S.isDraggingCards) {
            S.dragVelocityX = Math.max(-35, Math.min(35, clientX - S.dragLastClientX));
            S.dragLastClientX = clientX;
            const dx = (clientX - S.dragStartMouseX) / S.canvasScale; const dy = (clientY - S.dragStartMouseY) / S.canvasScale;
            S.initialCardPositions.forEach((pos, id) => {
                const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
                if (el) { el.style.left = `${Math.round(pos.x + dx)}px`; el.style.top = `${Math.round(pos.y + dy)}px`; }
            });
            clearDropTargetHighlights();
            const hoveredTrash = getHoveredTrashBtn(clientX, clientY);
            const hoveredUnsorted = hoveredTrash ? null : getHoveredUnsortedTarget(clientX, clientY);
            const hoveredBreadcrumb = (!hoveredTrash && !hoveredUnsorted) ? getHoveredBreadcrumbTab(clientX, clientY) : null;
            const hoveredBoard = (!hoveredTrash && !hoveredUnsorted && !hoveredBreadcrumb) ? getHoveredBoardNode(clientX, clientY, S.initialCardPositions) : null;
            if (hoveredTrash) hoveredTrash.classList.add('trash-drop-active');
            if (hoveredUnsorted) hoveredUnsorted.classList.add('unsorted-drop-active');
            if (hoveredBreadcrumb) hoveredBreadcrumb.classList.add('breadcrumb-drop-active');
            if (hoveredBoard) hoveredBoard.classList.add('board-drop-target');
            updateCanvasCardDragElevationAndFeedback(clientX, clientY, hoveredTrash, hoveredUnsorted, hoveredBoard, hoveredBreadcrumb);
            drawConnections();
        }
        else if (S.isResizingImage && S.resizeCardId) {
            const dx = (clientX - S.resizeStartX) / S.canvasScale;
            const dy = (clientY - S.resizeStartY) / S.canvasScale;
            const el = document.querySelector(`.interactive-card[data-id="${S.resizeCardId}"]`);
            const cardData = S.cards.find(c => c.id === S.resizeCardId);
            const isAutoHeightMedia = cardData && (cardData.type === 'image' || cardData.type === 'video');
            if (el) {
                if (isAutoHeightMedia) {
                    const newW = Math.max(cardData.type === 'video' ? 180 : 50, S.resizeStartW + dx);
                    el.style.width = `${newW}px`;
                    const img = el.querySelector('img');
                    if (img) img.style.width = `${newW}px`;
                } else {
                    const minW = cardData?.type === 'embed' ? 200 : 100;
                    const minH = cardData?.type === 'embed' ? 150 : 100;
                    const newW = Math.max(minW, S.resizeStartW + dx);
                    const newH = Math.max(minH, S.resizeStartH + dy);
                    el.style.width = `${newW}px`;
                    el.style.height = `${newH}px`;
                    el.style.minHeight = `${newH}px`;
                }
            }
        }
        else if (S.isDraggingControlPoint) {
            const dx = (clientX - S.dragStartMouseX) / S.canvasScale;
            const dy = (clientY - S.dragStartMouseY) / S.canvasScale;
            const conn = S.connections.find(c => c.id === S.dragControlConnId);
            if (conn) {
                conn.dx_mid = S.initialDxMid + dx;
                conn.dy_mid = S.initialDyMid + dy;
                drawConnections();
            }
        }
        else if (S.isDrawingConnection && S.connectionSourceId) {
            const fromEl = document.querySelector<HTMLElement>(`.interactive-card[data-id="${S.connectionSourceId}"]`);
            if (fromEl && S.tempConnectionLine) {
                const rect = viewport.getBoundingClientRect();
                const mouseCanvasX = (clientX - rect.left - S.canvasPanX) / S.canvasScale;
                const mouseCanvasY = (clientY - rect.top - S.canvasPanY) / S.canvasScale;
                const startPt = resolveAnchorPoint(fromEl, S.connectionFromAnchor || { side: 'right', t: 0.5 });

                const hoveredEl = document.elementsFromPoint(clientX, clientY).find(el => el.classList.contains('interactive-card') && (el as HTMLElement).dataset.id !== S.connectionSourceId) as HTMLElement | undefined;
                let endPt;
                if (hoveredEl) {
                    const snapAnchor = getAnchorFromCanvasPoint(hoveredEl, mouseCanvasX, mouseCanvasY);
                    endPt = resolveAnchorPoint(hoveredEl, snapAnchor);
                    if (S.tempConnectionSnapDot) {
                        S.tempConnectionSnapDot.setAttribute('cx', endPt.x);
                        S.tempConnectionSnapDot.setAttribute('cy', endPt.y);
                        S.tempConnectionSnapDot.classList.remove('hidden');
                    }
                } else {
                    endPt = { x: mouseCanvasX, y: mouseCanvasY, nx: -startPt.nx, ny: -startPt.ny };
                    if (S.tempConnectionSnapDot) S.tempConnectionSnapDot.classList.add('hidden');
                }
                const geom = buildConnectionGeometry(startPt, endPt, 0, 0, false, false);
                S.tempConnectionLine.setAttribute('d', geom.linePath);
            }
        }
        else if (S.isReconnectingEndpoint) {
            const conn = S.connections.find(c => c.id === S.reconnectConnId);
            if (conn) {
                const rect = viewport.getBoundingClientRect();
                const mouseCanvasX = (clientX - rect.left - S.canvasPanX) / S.canvasScale;
                const mouseCanvasY = (clientY - rect.top - S.canvasPanY) / S.canvasScale;
                const fromEl = document.querySelector(`.interactive-card[data-id="${conn.fromId}"]`);
                const toEl = document.querySelector(`.interactive-card[data-id="${conn.toId}"]`);
                if (fromEl && toEl) {
                    const autoAnchors = (!conn.fromAnchor || !conn.toAnchor) ? getBestAutoAnchors(fromEl, toEl) : null;
                    const hoveredEl = document.elementsFromPoint(clientX, clientY).find(el => {
                        if (!el.classList.contains('interactive-card')) return false;
                        return S.reconnectSide === 'from' ? (el as HTMLElement).dataset.id !== conn.toId : (el as HTMLElement).dataset.id !== conn.fromId;
                    });
                    let startPt, endPt;
                    if (S.reconnectSide === 'from') {
                        endPt = resolveAnchorPoint(toEl, conn.toAnchor || autoAnchors.to);
                        if (hoveredEl) {
                            startPt = resolveAnchorPoint(hoveredEl, getAnchorFromCanvasPoint(hoveredEl, mouseCanvasX, mouseCanvasY));
                        } else {
                            startPt = { x: mouseCanvasX, y: mouseCanvasY, nx: -endPt.nx, ny: -endPt.ny };
                        }
                    } else {
                        startPt = resolveAnchorPoint(fromEl, conn.fromAnchor || autoAnchors.from);
                        if (hoveredEl) {
                            endPt = resolveAnchorPoint(hoveredEl, getAnchorFromCanvasPoint(hoveredEl, mouseCanvasX, mouseCanvasY));
                        } else {
                            endPt = { x: mouseCanvasX, y: mouseCanvasY, nx: -startPt.nx, ny: -startPt.ny };
                        }
                    }
                    const geom = buildConnectionGeometry(startPt, endPt, conn.dx_mid || 0, conn.dy_mid || 0, conn.startMarker === 'arrow', conn.endMarker !== 'none');
                    const path = document.querySelector(`.conn-line[data-id="${conn.id}"]`);
                    if (path) path.setAttribute('d', geom.linePath);
                    const endpoints = document.querySelectorAll('.conn-endpoint');
                    if (endpoints.length === 2) {
                        if (S.reconnectSide === 'from') { endpoints[0].setAttribute('cx', startPt.x); endpoints[0].setAttribute('cy', startPt.y); }
                        else { endpoints[1].setAttribute('cx', endPt.x); endpoints[1].setAttribute('cy', endPt.y); }
                    }
                }
            }
        }
    }

    async function handlePointerUp(clientX, clientY) {
        document.body.classList.remove('is-canvas-interacting');
        if (S.pendingCardDrag) {
            const clickDrag = S.pendingCardDrag;
            S.pendingCardDrag = null;
            if (!S.isDraggingCards) {
                if (clickDrag.shiftKey) {
                    if (S.selectedCardIds.has(clickDrag.cardId)) S.selectedCardIds.delete(clickDrag.cardId);
                    else S.selectedCardIds.add(clickDrag.cardId);
                } else {
                    S.selectedCardIds.clear();
                    S.selectedCardIds.add(clickDrag.cardId);
                }
                if (S.selectedConnectionId) {
                    S.selectedConnectionId = null;
                    drawConnections();
                }
                syncSelectionVisuals();
            }
        }
        if (S.pendingMediaClick) {
            const clickInfo = S.pendingMediaClick;
            S.pendingMediaClick = null;
            const movedDist = Math.hypot((clientX || 0) - clickInfo.startX, (clientY || 0) - clickInfo.startY);
            if (movedDist < 5) {
                const targetEl = document.querySelector(`.interactive-card[data-id="${clickInfo.cardId}"]`);
                if (clickInfo.type === 'video' && targetEl) {
                    const vid = targetEl.querySelector('video');
                    if (vid) {
                        if (vid.paused) vid.play().catch(() => {});
                        else vid.pause();
                    }
                } else if (clickInfo.type === 'embed') {
                    setActiveEmbedCard(clickInfo.cardId);
                }
            }
        }
        if (S.isPanning) {
            S.isPanning = false;
            saveUIState();
        }
        if (S.isMarqueeSelecting) { S.isMarqueeSelecting = false; marquee.classList.add('hidden'); }
        if (S.isDraggingCards) {
            S.isDraggingCards = false;
            S.internalDragPayload = null;
            stopDragPhysics();
            const hoveredTrash = getHoveredTrashBtn(clientX, clientY);
            const hoveredUnsorted = hoveredTrash ? null : getHoveredUnsortedTarget(clientX, clientY);
            const hoveredBreadcrumb = (!hoveredTrash && !hoveredUnsorted) ? getHoveredBreadcrumbTab(clientX, clientY) : null;
            const hoveredBoard = (!hoveredTrash && !hoveredUnsorted && !hoveredBreadcrumb) ? getHoveredBoardNode(clientX, clientY, S.initialCardPositions) : null;
            clearDropTargetHighlights();
            const dragSnapPromise = S.pendingDragUndoSnapshot;
            S.pendingDragUndoSnapshot = null;
            if (hoveredTrash) {
                if (dragSnapPromise) await pushUndoSnapshot(await dragSnapPromise);
                for (const id of S.initialCardPositions.keys()) {
                    const c = await dbGet('cards', id);
                    if (c && !c.isTrash) {
                        c.isTrash = true;
                        c.deletedAt = Date.now();
                        await dbPut('cards', c);
                    }
                    S.selectedCardIds.delete(id);
                }
                S.initialCardPositions.clear();
                await fetchAndRenderCards();
                await updateTrashBadge();
                playCozySound('trash');
                showToast(t('movedToTrash'));
            } else if (hoveredUnsorted) {
                if (dragSnapPromise) await pushUndoSnapshot(await dragSnapPromise);
                for (const id of S.initialCardPositions.keys()) {
                    const c = await dbGet('cards', id);
                    if (c) {
                        c.boardId = 'unsorted';
                        await dbPut('cards', c);
                    }
                    S.selectedCardIds.delete(id);
                }
                S.initialCardPositions.clear();
                if (!S.isSidebarOpen) {
                    S.isSidebarOpen = true;
                    S.hasExplicitSidebarPref = true;
                    applySidebarDomState();
                    saveUIState();
                }
                await fetchAndRenderCards();
                await renderUnsortedDrawer(false);
                playCozySound('unsorted');
                showToast(t('movedToUnsortedToast'));
            } else if (hoveredBreadcrumb) {
                const targetBoardId = (hoveredBreadcrumb as HTMLElement).dataset.breadcrumbBoardId;
                const movedIds = Array.from(S.initialCardPositions.keys());
                S.initialCardPositions.clear();
                const preUndo = dragSnapPromise ? await dragSnapPromise : null;
                await moveCardsToBoard(movedIds, targetBoardId, { isBreadcrumb: true, preCapturedUndo: preUndo });
            } else if (hoveredBoard) {
                const targetBoardId = (hoveredBoard as HTMLElement).dataset.id;
                const movedIds = Array.from(S.initialCardPositions.keys());
                S.initialCardPositions.clear();
                const preUndo = dragSnapPromise ? await dragSnapPromise : null;
                await moveCardsToBoard(movedIds, targetBoardId, { preCapturedUndo: preUndo });
            } else {
                let anyPositionChanged = false;
                S.initialCardPositions.forEach((pos, id) => {
                    const el = document.querySelector<HTMLElement>(`.interactive-card[data-id="${id}"]`);
                    if (el) {
                        const nx = parseFloat(el.style.left);
                        const ny = parseFloat(el.style.top);
                        if (Math.abs(nx - pos.x) >= 1 || Math.abs(ny - pos.y) >= 1) anyPositionChanged = true;
                    }
                });
                if (anyPositionChanged && dragSnapPromise) {
                    await pushUndoSnapshot(await dragSnapPromise);
                }
                for (const id of S.initialCardPositions.keys()) {
                    const el = document.querySelector<HTMLElement>(`.interactive-card[data-id="${id}"]`);
                    if (el) {
                        const c = await dbGet('cards', id);
                        if (c) {
                            c.x = parseFloat(el.style.left);
                            c.y = parseFloat(el.style.top);
                            const memCard = S.cards.find(cd => cd.id === id);
                            if (memCard && typeof memCard.zIndex === 'number') {
                                c.zIndex = memCard.zIndex;
                            }
                            await dbPut('cards', c);
                            if (memCard) { memCard.x = c.x; memCard.y = c.y; }
                        }
                    }
                }
                S.initialCardPositions.clear();
            }
        }
        if (S.isResizingImage) {
            S.isResizingImage = false;
            const resizeSnapPromise = S.pendingResizeUndoSnapshot;
            S.pendingResizeUndoSnapshot = null;
            if (S.resizeCardId) {
                const el = document.querySelector<HTMLElement>(`.interactive-card[data-id="${S.resizeCardId}"]`);
                if (el) {
                    const c = await dbGet('cards', S.resizeCardId);
                    if (c) {
                        const nextW = parseFloat(el.style.width);
                        const cardData = S.cards.find(cd => cd.id === S.resizeCardId);
                        const nextH = (cardData && (cardData.type === 'image' || cardData.type === 'video')) ? null : (parseFloat(el.style.height) || parseFloat(el.style.minHeight));
                        if (nextW !== c.width || nextH !== c.height) {
                            if (resizeSnapPromise) await pushUndoSnapshot(await resizeSnapPromise);
                            c.width = nextW;
                            c.height = nextH;
                            await dbPut('cards', c);
                        }
                    }
                }
            }
            S.resizeCardId = null;
        }
        if (S.isDraggingControlPoint) {
            S.isDraggingControlPoint = false;
            const ctrlSnapPromise = S.pendingControlUndoSnapshot;
            S.pendingControlUndoSnapshot = null;
            if (S.dragControlConnId) {
                const conn = S.connections.find(c => c.id === S.dragControlConnId);
                if (conn) {
                    if (ctrlSnapPromise) await pushUndoSnapshot(await ctrlSnapPromise);
                    await dbPut('connections', conn);
                }
            }
            S.dragControlConnId = null;
        }
        if (S.isDrawingConnection) {
            S.isDrawingConnection = false;
            if (S.tempConnectionLine) { S.tempConnectionLine.remove(); S.tempConnectionLine = null; }
            if (S.tempConnectionSnapDot) { S.tempConnectionSnapDot.remove(); S.tempConnectionSnapDot = null; }
            const elements = document.elementsFromPoint(clientX, clientY);
            const targetCardEl = elements.find(el => el.classList.contains('interactive-card') && (el as HTMLElement).dataset.id !== S.connectionSourceId) as HTMLElement | undefined;
            if (targetCardEl) {
                await pushUndoSnapshot();
                const rect = viewport.getBoundingClientRect();
                const mouseCanvasX = (clientX - rect.left - S.canvasPanX) / S.canvasScale;
                const mouseCanvasY = (clientY - rect.top - S.canvasPanY) / S.canvasScale;
                const toAnchor = getAnchorFromCanvasPoint(targetCardEl, mouseCanvasX, mouseCanvasY);
                const targetId = targetCardEl.dataset.id;
                await dbPut('connections', {
                    id: 'conn_' + Date.now(),
                    fromId: S.connectionSourceId,
                    toId: targetId,
                    fromAnchor: S.connectionFromAnchor || { side: 'right', t: 0.5 },
                    toAnchor,
                    startMarker: 'none',
                    endMarker: 'arrow'
                });
                await fetchAndRenderCards();
                showToast(t('connectedToast'));
                if (S.activeTool === 'line') setTool('select');
            }
            S.connectionSourceId = null;
            S.connectionFromAnchor = null;
        }
        if (S.isReconnectingEndpoint) {
            S.isReconnectingEndpoint = false;
            const ctrlSnapPromise = S.pendingControlUndoSnapshot;
            S.pendingControlUndoSnapshot = null;
            const elements = document.elementsFromPoint(clientX, clientY);
            const targetCardEl = elements.find(el => el.classList.contains('interactive-card')) as HTMLElement | undefined;
            if (targetCardEl) {
                const conn = S.connections.find(c => c.id === S.reconnectConnId);
                if (conn) {
                    const rect = viewport.getBoundingClientRect();
                    const mouseCanvasX = (clientX - rect.left - S.canvasPanX) / S.canvasScale;
                    const mouseCanvasY = (clientY - rect.top - S.canvasPanY) / S.canvasScale;
                    const targetId = targetCardEl.dataset.id;
                    const nextAnchor = getAnchorFromCanvasPoint(targetCardEl, mouseCanvasX, mouseCanvasY);
                    if ((S.reconnectSide === 'from' && targetId !== conn.toId) || (S.reconnectSide === 'to' && targetId !== conn.fromId)) {
                        if (ctrlSnapPromise) await pushUndoSnapshot(await ctrlSnapPromise);
                        if (S.reconnectSide === 'from') {
                            conn.fromId = targetId;
                            conn.fromAnchor = nextAnchor;
                        } else {
                            conn.toId = targetId;
                            conn.toAnchor = nextAnchor;
                        }
                        await dbPut('connections', conn);
                    }
                }
            }
            await fetchAndRenderCards();
            S.reconnectConnId = null; S.reconnectSide = null;
        }
    }

    viewport.addEventListener('mousedown', (e: any) => {
        if (S.activeTool === 'line' && e.button === 0 && !e.target?.closest?.('#context-menu')) {
            const cardEl = e.target?.closest?.('.interactive-card') as HTMLElement | null;
            if (cardEl) {
                e.preventDefault();
                e.stopPropagation();
                const rect = viewport.getBoundingClientRect();
                const mx = (e.clientX - rect.left - S.canvasPanX) / S.canvasScale;
                const my = (e.clientY - rect.top - S.canvasPanY) / S.canvasScale;
                const anchor = getAnchorFromCanvasPoint(cardEl, mx, my);
                startConnectionDraw(e, cardEl.dataset.id, anchor);
                return;
            } else {
                setTool('select');
            }
        }
    }, true);

    viewport.addEventListener('mousedown', (e: any) => {
        S.lastMouseClientX = e.clientX;
        S.lastMouseClientY = e.clientY;
        if (e.target?.closest?.('#context-menu')) return;
        const isBg = (e.target === viewport || e.target?.id === 'canvas-content' || e.target?.id === 'empty-canvas-prompt' || e.target?.tagName === 'svg');

        if (e.button === 1 || (e.button === 0 && (S.isSpacePressed || S.activeTool === 'hand'))) {
            e.preventDefault(); S.isPanning = true; document.body.classList.add('is-canvas-interacting'); S.startPanX = e.clientX - S.canvasPanX; S.startPanY = e.clientY - S.canvasPanY; return;
        }

        if (e.button === 0 && isBg) {
            const activeEl = document.activeElement as HTMLElement | null;
            if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
                activeEl.blur();
            }
            exitCardEditMode();
            if (!e.shiftKey) {
                clearSelection();
                S.selectedConnectionId = null;
                drawConnections();
            }
            S.isMarqueeSelecting = true;
            document.body.classList.add('is-canvas-interacting');
            const rect = viewport.getBoundingClientRect();
            S.marqueeStartX = e.clientX - rect.left; S.marqueeStartY = e.clientY - rect.top;
            marquee.style.left = `${S.marqueeStartX}px`; marquee.style.top = `${S.marqueeStartY}px`; marquee.style.width = '0px'; marquee.style.height = '0px';
            marquee.classList.remove('hidden');
        }
    });

    window.addEventListener('mousemove', (e) => handlePointerMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', (e) => handlePointerUp(e.clientX, e.clientY));

    // MOBILE & TOUCH GESTURES (1-finger pan/drag, 2-finger pinch zoom, long-press context menu, double-tap edit)
    let touchMode = null;
    let touchStartX = 0, touchStartY = 0;
    let touchTargetCardEl = null;
    let touchOriginalTarget = null;
    let touchMoved = false;
    let longPressTimer = null;
    let longPressedTriggered = false;
    let pinchStartDist = 0, pinchStartScale = 1, lastPinchMidX = 0, lastPinchMidY = 0;
    let lastTapTime = 0, lastTapCardId = null;

    function cancelLongPress() {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }

    function triggerCardTouchDoubleTap(cardEl, targetEl) {
        const cardId = cardEl.dataset.id;
        const card = S.cards.find(c => c.id === cardId);
        if (!card) return;
        if (card.type === 'subboard') {
            openSubBoard(card.id, card.title || t('newBoardTitle'));
        } else if (card.type === 'document') {
            openDocumentModal(card.id);
        } else if (card.type === 'video') {
            const vid = cardEl.querySelector('video');
            if (vid) {
                if (vid.paused) vid.play().catch(() => {});
                else vid.pause();
            }
        } else if (card.type === 'embed') {
            toggleEmbedInteract(card.id);
        } else if (card.type === 'task') {
            const taskRow = targetEl && targetEl.closest ? targetEl.closest('.task-row') : null;
            if (taskRow) {
                const taskInp = taskRow.querySelector('.task-input');
                if (taskInp) {
                    enterCardEditMode(cardEl, taskInp);
                    return;
                }
            }
            const addInp = cardEl.querySelector('.add-task-input');
            enterCardEditMode(cardEl, addInp);
        } else {
            const editable = cardEl.querySelector('textarea, input[type="text"]');
            if (editable) {
                enterCardEditMode(cardEl, editable);
            }
        }
    }

    viewport.addEventListener('touchstart', (e: any) => {
        if (e.target?.closest?.('#context-menu')) return;
        cancelLongPress();
        longPressedTriggered = false;

        if (e.touches.length === 2) {
            e.preventDefault();
            touchMode = 'pinch';
            S.isPanning = false;
            S.isDraggingCards = false;
            S.initialCardPositions.clear();
            const t0 = e.touches[0], t1 = e.touches[1];
            pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
            pinchStartScale = S.canvasScale;
            lastPinchMidX = (t0.clientX + t1.clientX) / 2;
            lastPinchMidY = (t0.clientY + t1.clientY) / 2;
            return;
        }

        if (e.touches.length !== 1) return;
        if (S.isResizingImage || S.isDraggingControlPoint || S.isDrawingConnection || S.isReconnectingEndpoint) {
            e.preventDefault();
            return;
        }

        // Permite interação nativa com inputs já ativos, botões, links, checkboxes e alças de task
        if (e.target?.closest?.('input:not(.pointer-events-none), textarea:not(.pointer-events-none), button, a, input[type="checkbox"], .task-drag-handle')) {
            touchMode = null;
            return;
        }

        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        touchMoved = false;
        touchOriginalTarget = e.target;
        touchTargetCardEl = e.target?.closest?.('.interactive-card');

        if (S.activeTool === 'line') {
            if (touchTargetCardEl) {
                e.preventDefault();
                const rect = viewport.getBoundingClientRect();
                const mx = (t.clientX - rect.left - S.canvasPanX) / S.canvasScale;
                const my = (t.clientY - rect.top - S.canvasPanY) / S.canvasScale;
                const anchor = getAnchorFromCanvasPoint(touchTargetCardEl, mx, my);
                startConnectionDraw(e, touchTargetCardEl.dataset.id, anchor);
                touchMode = null;
                return;
            } else {
                setTool('select');
            }
        }

        if (touchTargetCardEl && S.activeTool !== 'hand') {
            const cardId = touchTargetCardEl.dataset.id;
            const wasAlreadySelected = S.selectedCardIds.has(cardId);
            if (wasAlreadySelected && e.target?.tagName === 'VIDEO' && !e.target?.closest?.('.video-drag-overlay')) {
                touchMode = null;
                return;
            }
            e.preventDefault();
            if (wasAlreadySelected) {
                touchMode = 'pending-card';
                longPressTimer = setTimeout(() => {
                    if (!touchMoved && touchMode === 'pending-card') {
                        longPressedTriggered = true;
                        touchMode = null;
                        openContextMenuAt(touchStartX, touchStartY, touchTargetCardEl);
                    }
                }, 480);
            } else {
                // Mobile: exigir tocar primeiro para selecionar antes de permitir arrastar
                touchMode = 'pending-unselected-card';
                S.startPanX = t.clientX - S.canvasPanX;
                S.startPanY = t.clientY - S.canvasPanY;
                longPressTimer = setTimeout(() => {
                    if (!touchMoved && touchMode === 'pending-unselected-card') {
                        longPressedTriggered = true;
                        touchMode = null;
                        S.selectedCardIds.clear();
                        S.selectedCardIds.add(cardId);
                        S.selectedConnectionId = null;
                        syncSelectionVisuals();
                        drawConnections();
                        openContextMenuAt(touchStartX, touchStartY, touchTargetCardEl);
                    }
                }, 480);
            }
        } else {
            e.preventDefault();
            const activeEl = document.activeElement as HTMLElement | null;
            if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
                activeEl.blur();
            }
            touchMode = 'pending-bg';
            S.startPanX = t.clientX - S.canvasPanX;
            S.startPanY = t.clientY - S.canvasPanY;
            longPressTimer = setTimeout(() => {
                if (!touchMoved && touchMode === 'pending-bg') {
                    longPressedTriggered = true;
                    touchMode = null;
                    openContextMenuAt(touchStartX, touchStartY, touchOriginalTarget);
                }
            }, 480);
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (touchMode === 'pinch' && e.touches.length === 2) {
            e.preventDefault();
            const t0 = e.touches[0], t1 = e.touches[1];
            const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
            const midX = (t0.clientX + t1.clientX) / 2;
            const midY = (t0.clientY + t1.clientY) / 2;

            const rect = viewport.getBoundingClientRect();
            const localMidX = midX - rect.left;
            const localMidY = midY - rect.top;
            const worldX = (localMidX - S.canvasPanX) / S.canvasScale;
            const worldY = (localMidY - S.canvasPanY) / S.canvasScale;

            const nextScale = Math.min(Math.max(pinchStartScale * (dist / pinchStartDist), 0.25), 2.5);
            S.canvasScale = nextScale;
            S.canvasPanX = localMidX - worldX * S.canvasScale + (midX - lastPinchMidX);
            S.canvasPanY = localMidY - worldY * S.canvasScale + (midY - lastPinchMidY);
            lastPinchMidX = midX;
            lastPinchMidY = midY;

            document.getElementById('zoom-level').textContent = Math.round(S.canvasScale * 100) + '%';
            updateCanvasTransform();
            return;
        }

        if (e.touches.length !== 1) return;
        const t = e.touches[0];

        if (S.isResizingImage || S.isDraggingControlPoint || S.isDrawingConnection || S.isReconnectingEndpoint) {
            e.preventDefault();
            handlePointerMove(t.clientX, t.clientY);
            return;
        }

        if (touchMode === 'pending-card' || touchMode === 'pending-unselected-card' || touchMode === 'pending-bg') {
            const distMoved = Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY);
            if (distMoved > 6) {
                touchMoved = true;
                cancelLongPress();
                if (touchMode === 'pending-card' && touchTargetCardEl) {
                    touchMode = 'drag';
                    S.isDraggingCards = true;
                    document.body.classList.add('is-canvas-interacting');
                    S.pendingDragUndoSnapshot = captureWorkspaceSnapshot();
                    S.dragStartMouseX = touchStartX;
                    S.dragStartMouseY = touchStartY;
                    S.dragLastClientX = t.clientX;
                    S.initialCardPositions.clear();
                    S.selectedCardIds.forEach(id => {
                        const el = document.querySelector<HTMLElement>(`.interactive-card[data-id="${id}"]`);
                        if (el) S.initialCardPositions.set(id, { x: parseFloat(el.style.left), y: parseFloat(el.style.top) });
                    });
                    bringCardsToFrontOnDragStart(Array.from(S.selectedCardIds));
                    startDragPhysics(Array.from(S.selectedCardIds));
                } else {
                    touchMode = 'pan';
                    S.isPanning = true;
                    document.body.classList.add('is-canvas-interacting');
                }
            }
        }

        if (touchMode === 'pan' || touchMode === 'drag') {
            e.preventDefault();
            handlePointerMove(t.clientX, t.clientY);
        }
    }, { passive: false });

    const finishTouch = async (e) => {
        cancelLongPress();
        const pt = getEventPoint(e);

        if (touchMode === 'pinch') {
            if (e.touches && e.touches.length === 1) {
                touchMode = 'pan';
                S.isPanning = true;
                S.startPanX = e.touches[0].clientX - S.canvasPanX;
                S.startPanY = e.touches[0].clientY - S.canvasPanY;
            } else {
                touchMode = null;
                saveUIState();
            }
            return;
        }

        if (!longPressedTriggered) {
            if (touchMode === 'pending-bg' && !touchMoved) {
                clearSelection();
                S.selectedConnectionId = null;
                drawConnections();
            } else if (touchMode === 'pending-unselected-card' && !touchMoved && touchTargetCardEl) {
                const tappedId = touchTargetCardEl.dataset.id;
                S.selectedCardIds.clear();
                S.selectedCardIds.add(tappedId);
                S.selectedConnectionId = null;
                syncSelectionVisuals();
                drawConnections();
                lastTapTime = Date.now();
                lastTapCardId = tappedId;
            } else if (touchMode === 'pending-card' && !touchMoved && touchTargetCardEl) {
                const now = Date.now();
                const tappedId = touchTargetCardEl.dataset.id;
                if (lastTapCardId === tappedId && (now - lastTapTime) < 340) {
                    lastTapTime = 0;
                    lastTapCardId = null;
                    triggerCardTouchDoubleTap(touchTargetCardEl, touchOriginalTarget);
                } else {
                    lastTapTime = now;
                    lastTapCardId = tappedId;
                }
            }
        }

        touchMode = null;
        touchTargetCardEl = null;
        touchOriginalTarget = null;
        await handlePointerUp(pt.clientX || 0, pt.clientY || 0);
    };

    window.addEventListener('touchend', finishTouch, { passive: false });
    window.addEventListener('touchcancel', finishTouch, { passive: false });

    function zoomCanvasAtClientPoint(clientX, clientY, deltaY) {
        const rect = viewport.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const worldX = (mouseX - S.canvasPanX) / S.canvasScale;
        const worldY = (mouseY - S.canvasPanY) / S.canvasScale;

        const clampedDelta = Math.max(-120, Math.min(120, deltaY));
        const factor = Math.exp(-clampedDelta * 0.0014);
        const nextScale = Math.min(Math.max(S.canvasScale * factor, 0.25), 2.5);

        S.canvasScale = nextScale;
        S.canvasPanX = mouseX - worldX * S.canvasScale;
        S.canvasPanY = mouseY - worldY * S.canvasScale;
        document.getElementById('zoom-level').textContent = Math.round(S.canvasScale * 100) + '%';
        updateCanvasTransform();
        scheduleSaveUIState();
    }

    window.addEventListener('wheel', (e: any) => {
        if (e.target?.closest && e.target.closest('#pfp-crop-stage')) return;
        if (e.ctrlKey || e.metaKey) {
            // Impede o navegador de aplicar zoom na página inteira mesmo sobre vídeos/embeds/toolbars
            e.preventDefault();
            const insideModalOrSidebar = e.target?.closest && e.target.closest('#document-modal, #trash-modal, #settings-modal, #sync-modal, #pfp-crop-modal, #right-sidebar, #home-view');
            if (insideModalOrSidebar) return;
            const rect = viewport.getBoundingClientRect();
            const insideViewport = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (insideViewport) {
                zoomCanvasAtClientPoint(e.clientX, e.clientY, e.deltaY);
            }
        }
    }, { passive: false });

    viewport.addEventListener('wheel', (e: any) => {
        // Zoom SOMENTE com Ctrl + Scroll (tratado globalmente no listener de window acima)
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            return;
        }

        // Se estiver rolando dentro de um textarea ativo com barra de rolagem, preserva a rolagem interna
        const scrollableTextarea = e.target?.closest?.('textarea');
        if (scrollableTextarea && !scrollableTextarea.classList.contains('pointer-events-none') && scrollableTextarea.scrollHeight > scrollableTextarea.clientHeight) {
            const atTop = scrollableTextarea.scrollTop <= 0 && e.deltaY < 0;
            const atBottom = scrollableTextarea.scrollTop + scrollableTextarea.clientHeight >= scrollableTextarea.scrollHeight - 1 && e.deltaY > 0;
            if (!atTop && !atBottom) return;
        }

        // Scroll normal rola para cima/baixo e esquerda/direita (Shift+Scroll ou deltaX)
        e.preventDefault();
        const dx = (e.shiftKey && e.deltaX === 0) ? e.deltaY : e.deltaX;
        const dy = (e.shiftKey && e.deltaX === 0) ? 0 : e.deltaY;
        S.canvasPanX -= dx;
        S.canvasPanY -= dy;
        updateCanvasTransform();
        scheduleSaveUIState();
    }, { passive: false });
}

export function startImageResize(e, cardId) {
    e.stopPropagation();
    e.preventDefault();
    const pt = getEventPoint(e);
    S.pendingResizeUndoSnapshot = captureWorkspaceSnapshot();
    S.isResizingImage = true;
    document.body.classList.add('is-canvas-interacting');
    S.resizeCardId = cardId;
    const el = document.querySelector<HTMLElement>(`.interactive-card[data-id="${cardId}"]`);
    if (el) {
        S.resizeStartW = el.offsetWidth;
        S.resizeStartH = el.offsetHeight;
        S.resizeStartX = pt.clientX;
        S.resizeStartY = pt.clientY;
    }
}

export function startCardDrag(e, cardId) {
    if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand' || S.activeTool === 'line') return;
    const hostCardEl = document.querySelector(`.interactive-card[data-id="${cardId}"]`);
    if (hostCardEl && hostCardEl.classList.contains('is-editing')) return;
    e.stopPropagation();
    // Verifica se está tentando arrastar um input ativo
    if (e.target.closest('input:not([type="checkbox"]):not(.pointer-events-none), textarea:not(.pointer-events-none)')) return;
    if (S.activeEmbedCardId && S.activeEmbedCardId !== cardId) setActiveEmbedCard(null);
    if (S.editingCardId && S.editingCardId !== cardId) {
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
            activeEl.blur();
        }
        exitCardEditMode();
    }

    const wasAlreadySelected = S.selectedCardIds.has(cardId);
    let selectionCleared = false;
    if (S.selectedConnectionId) {
        S.selectedConnectionId = null;
        drawConnections();
        selectionCleared = true;
    }
    if (!e.shiftKey && !wasAlreadySelected && S.selectedCardIds.size > 0) {
        S.selectedCardIds.clear();
        selectionCleared = true;
    }
    if (selectionCleared) {
        syncSelectionVisuals();
    }

    S.pendingCardDrag = {
        cardId,
        startX: e.clientX,
        startY: e.clientY,
        shiftKey: !!e.shiftKey,
        wasAlreadySelected
    };
}

export function updateCanvasTransform() {
    const content = document.getElementById('canvas-content');
    const viewport = document.getElementById('canvas-viewport');
    content.style.transform = `translate(${S.canvasPanX}px, ${S.canvasPanY}px) scale(${S.canvasScale})`;
    content.style.transformOrigin = '0 0';
    if (viewport) {
        const gridSize = 24 * S.canvasScale;
        viewport.style.backgroundPosition = `${S.canvasPanX}px ${S.canvasPanY}px`;
        viewport.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    }
}

export function setActiveEmbedCard(cardId) {
    S.activeEmbedCardId = cardId || null;
    document.querySelectorAll<HTMLElement>('.embed-card').forEach(el => {
        const isActive = S.activeEmbedCardId === el.dataset.id;
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

export function toggleEmbedInteract(cardId) {
    setActiveEmbedCard(S.activeEmbedCardId === cardId ? null : cardId);
}

export function clearSelection() { S.selectedCardIds.clear(); setActiveEmbedCard(null); syncSelectionVisuals(); }

export function applyZoomAroundCenter(nextScale) {
    const vp = document.getElementById('canvas-viewport');
    const clamped = Math.min(Math.max(nextScale, 0.25), 2.5);
    if (vp) {
        const cx = vp.clientWidth / 2;
        const cy = vp.clientHeight / 2;
        const worldX = (cx - S.canvasPanX) / S.canvasScale;
        const worldY = (cy - S.canvasPanY) / S.canvasScale;
        S.canvasScale = clamped;
        S.canvasPanX = cx - worldX * S.canvasScale;
        S.canvasPanY = cy - worldY * S.canvasScale;
    } else {
        S.canvasScale = clamped;
    }
    document.getElementById('zoom-level').textContent = Math.round(S.canvasScale * 100) + '%';
    updateCanvasTransform();
    saveUIState();
}

export function zoomIn() { applyZoomAroundCenter(S.canvasScale * 1.15); }

export function zoomOut() { applyZoomAroundCenter(S.canvasScale / 1.15); }

export function resetZoom() { applyZoomAroundCenter(1); }
