// ==========================================
// 9. INTERAÇÕES DO CANVAS (PAN, ZOOM, CONNECTION)
// ==========================================
function startDragPhysics(cardIds) {
    if (dragPhysicsRaf) cancelAnimationFrame(dragPhysicsRaf);
    dragVelocityX = 0;
    dragCurrentTilt = 0;
    dragCurrentScale = 1.015;
    isDragOverInteractiveArea = false;
    cardIds.forEach(id => {
        const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
        if (el) {
            el.classList.remove('is-settling-card');
            el.classList.add('is-dragging-card');
        }
    });
    const stepPhysics = () => {
        if (!isDraggingCards) {
            dragPhysicsRaf = null;
            return;
        }
        const targetTilt = Math.max(-3.6, Math.min(3.6, dragVelocityX * 0.22));
        dragCurrentTilt += (targetTilt - dragCurrentTilt) * 0.28;
        dragVelocityX *= 0.78;
        const targetScale = isDragOverInteractiveArea ? 0.84 : 1.015;
        dragCurrentScale += (targetScale - dragCurrentScale) * 0.25;
        initialCardPositions.forEach((_, id) => {
            const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
            if (el) {
                el.style.transform = `translate3d(0, -3px, 0) scale(${dragCurrentScale.toFixed(3)}) rotate(${dragCurrentTilt.toFixed(2)}deg)`;
            }
        });
        dragPhysicsRaf = requestAnimationFrame(stepPhysics);
    };
    dragPhysicsRaf = requestAnimationFrame(stepPhysics);
}

function stopDragPhysics() {
    if (dragPhysicsRaf) {
        cancelAnimationFrame(dragPhysicsRaf);
        dragPhysicsRaf = null;
    }
    dragVelocityX = 0;
    dragCurrentTilt = 0;
    dragCurrentScale = 1.015;
    isDragOverInteractiveArea = false;
    setDraggedCardsElevated(false);
    initialCardPositions.forEach((_, id) => {
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

function promoteDraggedCardsToCanvasSpace(dragIds) {
    const contentLayer = document.getElementById('canvas-content');
    initialCardPositions.clear();
    dragIds.forEach(id => {
        const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
        if (!el) return;
        const bounds = getCanvasRelativeOffset(el);
        const cardData = cards.find(c => c.id === id);
        if (el.closest('.column-stack') && contentLayer) {
            const fallbackW = cardData?.width || (cardData?.type === 'subboard' ? 140 : cardData?.type === 'document' ? 96 : cardData?.type === 'table' ? 380 : cardData?.type === 'comment' ? 256 : 270);
            el.classList.remove('column-child-item', 'py-2');
            el.classList.add('absolute');
            el.style.left = `${Math.round(bounds.left)}px`;
            el.style.top = `${Math.round(bounds.top)}px`;
            if (cardData?.type !== 'subboard' && cardData?.type !== 'document') {
                el.style.width = `${fallbackW}px`;
            } else {
                el.style.width = cardData?.type === 'subboard' ? '140px' : '96px';
            }
            contentLayer.appendChild(el);
        }
        initialCardPositions.set(id, {
            x: parseFloat(el.style.left) || bounds.left,
            y: parseFloat(el.style.top) || bounds.top
        });
    });
}

function findReconnectTargetCard(clientX, clientY, excludedCardId) {
    const direct = document.elementsFromPoint(clientX, clientY).find(el => {
        if (!el.classList || !el.classList.contains('interactive-card')) return false;
        if (el.dataset.id === excludedCardId) return false;
        return el.offsetParent !== null;
    });
    if (direct) return direct;

    const vp = document.getElementById('canvas-viewport');
    if (!vp) return null;
    const rect = vp.getBoundingClientRect();
    const mx = (clientX - rect.left - canvasPanX) / canvasScale;
    const my = (clientY - rect.top - canvasPanY) / canvasScale;
    const snapPad = 16 / Math.max(0.4, canvasScale);

    let bestEl = null;
    let bestDist = snapPad;
    document.querySelectorAll('#canvas-content .interactive-card').forEach(el => {
        if (el.dataset.id === excludedCardId || el.offsetParent === null) return;
        const b = getCardConnectionBounds(el);
        const dx = Math.max(b.left - mx, 0, mx - (b.left + b.width));
        const dy = Math.max(b.top - my, 0, my - (b.top + b.height));
        const dist = Math.hypot(dx, dy);
        if (dist <= bestDist) {
            bestDist = dist;
            bestEl = el;
        }
    });
    return bestEl;
}

function setupCanvasInteractions() {
    const viewport = document.getElementById('canvas-viewport');
    const marquee = document.getElementById('marquee-box');

    function handlePointerMove(clientX, clientY) {
        if (pendingCardDrag && !isDraggingCards) {
            const distMoved = Math.hypot(clientX - pendingCardDrag.startX, clientY - pendingCardDrag.startY);
            if (distMoved >= 4) {
                const dragInfo = pendingCardDrag;
                pendingCardDrag = null;
                const dragIds = dragInfo.wasAlreadySelected ? Array.from(selectedCardIds) : [dragInfo.cardId];
                pendingDragUndoSnapshot = captureWorkspaceSnapshot();
                isDraggingCards = true;
                document.body.classList.add('is-canvas-interacting');
                dragStartMouseX = dragInfo.startX;
                dragStartMouseY = dragInfo.startY;
                dragLastClientX = clientX;
                promoteDraggedCardsToCanvasSpace(dragIds);
                bringCardsToFrontOnDragStart(dragIds);
                startDragPhysics(dragIds);
                internalDragPayload = { source: 'canvas', cardIds: dragIds };
            }
        }
        if (isPanning) { canvasPanX = clientX - startPanX; canvasPanY = clientY - startPanY; updateCanvasTransform(); }
        else if (isMarqueeSelecting) {
            const rect = viewport.getBoundingClientRect();
            const cX = clientX - rect.left; const cY = clientY - rect.top;
            const l = Math.min(marqueeStartX, cX); const t = Math.min(marqueeStartY, cY);
            const w = Math.abs(cX - marqueeStartX); const h = Math.abs(cY - marqueeStartY);
            marquee.style.left = `${l}px`; marquee.style.top = `${t}px`; marquee.style.width = `${w}px`; marquee.style.height = `${h}px`;

            const wL = (l - canvasPanX) / canvasScale; const wT = (t - canvasPanY) / canvasScale;
            const wR = (l + w - canvasPanX) / canvasScale; const wB = (t + h - canvasPanY) / canvasScale;
            document.querySelectorAll('.interactive-card').forEach(el => {
                if (el.offsetParent === null) return;
                const pos = getCanvasRelativeOffset(el);
                const cL = pos.left; const cT = pos.top;
                if (!(cL + el.offsetWidth < wL || cL > wR || cT + el.offsetHeight < wT || cT > wB)) selectedCardIds.add(el.dataset.id);
            });
            syncSelectionVisuals();
        } 
        else if (isDraggingCards) {
            dragVelocityX = Math.max(-35, Math.min(35, clientX - dragLastClientX));
            dragLastClientX = clientX;
            const dx = (clientX - dragStartMouseX) / canvasScale; const dy = (clientY - dragStartMouseY) / canvasScale;
            initialCardPositions.forEach((pos, id) => {
                const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
                if (el) { el.style.left = `${Math.round(pos.x + dx)}px`; el.style.top = `${Math.round(pos.y + dy)}px`; }
            });
            clearDropTargetHighlights();
            const hoveredTrash = getHoveredTrashBtn(clientX, clientY);
            const hoveredUnsorted = hoveredTrash ? null : getHoveredUnsortedTarget(clientX, clientY);
            const hoveredBreadcrumb = (!hoveredTrash && !hoveredUnsorted) ? getHoveredBreadcrumbTab(clientX, clientY) : null;
            const hoveredBoard = (!hoveredTrash && !hoveredUnsorted && !hoveredBreadcrumb) ? getHoveredBoardNode(clientX, clientY, initialCardPositions) : null;
            const hoveredColumn = (!hoveredTrash && !hoveredUnsorted && !hoveredBreadcrumb && !hoveredBoard) ? getHoveredColumnInfo(clientX, clientY, initialCardPositions) : null;
            if (hoveredTrash) hoveredTrash.classList.add('trash-drop-active');
            if (hoveredUnsorted) hoveredUnsorted.classList.add('unsorted-drop-active');
            if (hoveredBreadcrumb) hoveredBreadcrumb.classList.add('breadcrumb-drop-active');
            if (hoveredBoard) hoveredBoard.classList.add('board-drop-target');
            if (hoveredColumn) applyColumnDropIndicator(hoveredColumn);
            updateCanvasCardDragElevationAndFeedback(clientX, clientY, hoveredTrash, hoveredUnsorted, hoveredBoard, hoveredBreadcrumb);
            drawConnections();
        }
        else if (isResizingImage && resizeCardId) {
            const dx = (clientX - resizeStartX) / canvasScale;
            const dy = (clientY - resizeStartY) / canvasScale;
            const el = document.querySelector(`.interactive-card[data-id="${resizeCardId}"]`);
            const cardData = cards.find(c => c.id === resizeCardId);
            const isAutoHeightMedia = cardData && (cardData.type === 'image' || cardData.type === 'video');
            if (el) {
                if (isAutoHeightMedia) {
                    const newW = Math.max(cardData.type === 'video' ? 180 : 50, resizeStartW + dx);
                    el.style.width = `${newW}px`;
                    const img = el.querySelector('img');
                    if (img) img.style.width = `${newW}px`;
                } else {
                    const minW = cardData?.type === 'embed' ? 200 : 100;
                    const minH = cardData?.type === 'embed' ? 150 : 100;
                    const newW = Math.max(minW, resizeStartW + dx);
                    const newH = Math.max(minH, resizeStartH + dy);
                    el.style.width = `${newW}px`;
                    el.style.height = `${newH}px`;
                    el.style.minHeight = `${newH}px`;
                }
            }
        }
        else if (isDraggingControlPoint) {
            const dx = (clientX - dragStartMouseX) / canvasScale;
            const dy = (clientY - dragStartMouseY) / canvasScale;
            const conn = connections.find(c => c.id === dragControlConnId);
            if (conn) {
                conn.dx_mid = initialDxMid + dx;
                conn.dy_mid = initialDyMid + dy;
                drawConnections();
            }
        }
        else if (isDrawingConnection && connectionSourceId) {
            const fromEl = document.querySelector(`.interactive-card[data-id="${connectionSourceId}"]`);
            if (fromEl && tempConnectionLine) {
                const rect = viewport.getBoundingClientRect();
                const mouseCanvasX = (clientX - rect.left - canvasPanX) / canvasScale;
                const mouseCanvasY = (clientY - rect.top - canvasPanY) / canvasScale;
                const startPt = resolveAnchorPoint(fromEl, connectionFromAnchor || { side: 'right', t: 0.5 });

                const hoveredEl = document.elementsFromPoint(clientX, clientY).find(el => el.classList.contains('interactive-card') && el.dataset.id !== connectionSourceId);
                let endPt;
                if (hoveredEl) {
                    const snapAnchor = getAnchorFromCanvasPoint(hoveredEl, mouseCanvasX, mouseCanvasY);
                    endPt = resolveAnchorPoint(hoveredEl, snapAnchor);
                    if (tempConnectionSnapDot) {
                        tempConnectionSnapDot.setAttribute('cx', endPt.x);
                        tempConnectionSnapDot.setAttribute('cy', endPt.y);
                        tempConnectionSnapDot.classList.remove('hidden');
                    }
                } else {
                    endPt = { x: mouseCanvasX, y: mouseCanvasY, nx: -startPt.nx, ny: -startPt.ny };
                    if (tempConnectionSnapDot) tempConnectionSnapDot.classList.add('hidden');
                }
                const geom = buildConnectionGeometry(startPt, endPt, 0, 0, false, false);
                tempConnectionLine.setAttribute('d', geom.linePath);
            }
        }
        else if (isReconnectingEndpoint) {
            const conn = connections.find(c => c.id === reconnectConnId);
            document.querySelectorAll('.conn-reconnect-target').forEach(el => el.classList.remove('conn-reconnect-target'));
            if (conn) {
                const rect = viewport.getBoundingClientRect();
                const mouseCanvasX = (clientX - rect.left - canvasPanX) / canvasScale;
                const mouseCanvasY = (clientY - rect.top - canvasPanY) / canvasScale;
                const fromEl = resolveVisibleConnectionEl(conn.fromId);
                const toEl = resolveVisibleConnectionEl(conn.toId);
                const excludedId = reconnectSide === 'from' ? conn.toId : conn.fromId;
                const hoveredEl = findReconnectTargetCard(clientX, clientY, excludedId);
                const snapDot = ensureTempReconnectSnapDot();
                if (fromEl && toEl) {
                    const autoAnchors = (!conn.fromAnchor || !conn.toAnchor) ? getBestAutoAnchors(fromEl, toEl) : null;
                    let startPt, endPt;
                    if (reconnectSide === 'from') {
                        endPt = resolveAnchorPoint(toEl, conn.toAnchor || autoAnchors.to);
                        if (hoveredEl) {
                            hoveredEl.classList.add('conn-reconnect-target');
                            startPt = resolveAnchorPoint(hoveredEl, getAnchorFromCanvasPoint(hoveredEl, mouseCanvasX, mouseCanvasY));
                            if (snapDot) { snapDot.setAttribute('cx', startPt.x); snapDot.setAttribute('cy', startPt.y); snapDot.classList.remove('hidden'); }
                        } else {
                            startPt = { x: mouseCanvasX, y: mouseCanvasY, nx: -endPt.nx, ny: -endPt.ny };
                            if (snapDot) snapDot.classList.add('hidden');
                        }
                    } else {
                        startPt = resolveAnchorPoint(fromEl, conn.fromAnchor || autoAnchors.from);
                        if (hoveredEl) {
                            hoveredEl.classList.add('conn-reconnect-target');
                            endPt = resolveAnchorPoint(hoveredEl, getAnchorFromCanvasPoint(hoveredEl, mouseCanvasX, mouseCanvasY));
                            if (snapDot) { snapDot.setAttribute('cx', endPt.x); snapDot.setAttribute('cy', endPt.y); snapDot.classList.remove('hidden'); }
                        } else {
                            endPt = { x: mouseCanvasX, y: mouseCanvasY, nx: -startPt.nx, ny: -startPt.ny };
                            if (snapDot) snapDot.classList.add('hidden');
                        }
                    }
                    const geom = buildConnectionGeometry(startPt, endPt, conn.dx_mid || 0, conn.dy_mid || 0, false, false);
                    const path = document.querySelector(`.conn-line[data-id="${conn.id}"]`);
                    if (path) path.setAttribute('d', geom.linePath);
                    const hitbox = document.querySelector(`.conn-hitbox[data-id="${conn.id}"]`);
                    if (hitbox) hitbox.setAttribute('d', geom.hitboxPath);
                    document.querySelectorAll(`.conn-arrow[data-id="${conn.id}"], .conn-control[data-id="${conn.id}"]`).forEach(el => el.classList.add('hidden'));
                    const handleGroup = document.querySelector(`.conn-endpoint-group[data-id="${conn.id}"][data-side="${reconnectSide}"]`);
                    if (handleGroup) {
                        const tx = reconnectSide === 'from' ? startPt.x : endPt.x;
                        const ty = reconnectSide === 'from' ? startPt.y : endPt.y;
                        handleGroup.querySelectorAll('circle').forEach(c => {
                            c.setAttribute('cx', tx);
                            c.setAttribute('cy', ty);
                        });
                    }
                }
            }
        }
    }

    async function handlePointerUp(clientX, clientY) {
        document.body.classList.remove('is-canvas-interacting');
        if (pendingCardDrag) {
            const clickDrag = pendingCardDrag;
            pendingCardDrag = null;
            if (!isDraggingCards) {
                if (clickDrag.shiftKey) {
                    if (selectedCardIds.has(clickDrag.cardId)) selectedCardIds.delete(clickDrag.cardId);
                    else selectedCardIds.add(clickDrag.cardId);
                } else {
                    selectedCardIds.clear();
                    selectedCardIds.add(clickDrag.cardId);
                }
                if (selectedConnectionId) {
                    selectedConnectionId = null;
                    drawConnections();
                }
                syncSelectionVisuals();
            }
        }
        if (pendingMediaClick) {
            const clickInfo = pendingMediaClick;
            pendingMediaClick = null;
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
        if (isPanning) {
            isPanning = false;
            saveUIState();
        }
        if (isMarqueeSelecting) { isMarqueeSelecting = false; marquee.classList.add('hidden'); }
        if (isDraggingCards) {
            isDraggingCards = false;
            internalDragPayload = null;
            stopDragPhysics();
            const hoveredTrash = getHoveredTrashBtn(clientX, clientY);
            const hoveredUnsorted = hoveredTrash ? null : getHoveredUnsortedTarget(clientX, clientY);
            const hoveredBreadcrumb = (!hoveredTrash && !hoveredUnsorted) ? getHoveredBreadcrumbTab(clientX, clientY) : null;
            const hoveredBoard = (!hoveredTrash && !hoveredUnsorted && !hoveredBreadcrumb) ? getHoveredBoardNode(clientX, clientY, initialCardPositions) : null;
            const hoveredColumn = (!hoveredTrash && !hoveredUnsorted && !hoveredBreadcrumb && !hoveredBoard) ? getHoveredColumnInfo(clientX, clientY, initialCardPositions) : null;
            clearDropTargetHighlights();
            const dragSnapPromise = pendingDragUndoSnapshot;
            pendingDragUndoSnapshot = null;
            if (hoveredTrash) {
                if (dragSnapPromise) await pushUndoSnapshot(await dragSnapPromise);
                for (const id of initialCardPositions.keys()) {
                    const c = await dbGet('cards', id);
                    if (c && !c.isTrash) {
                        c.isTrash = true;
                        c.deletedAt = Date.now();
                        c.columnId = null;
                        c.columnOrder = null;
                        await dbPut('cards', c);
                    }
                    selectedCardIds.delete(id);
                }
                initialCardPositions.clear();
                await fetchAndRenderCards();
                await updateTrashBadge();
                playCozySound('trash');
                showToast(t('movedToTrash'));
            } else if (hoveredUnsorted) {
                if (dragSnapPromise) await pushUndoSnapshot(await dragSnapPromise);
                for (const id of initialCardPositions.keys()) {
                    const c = await dbGet('cards', id);
                    if (c) {
                        c.boardId = 'unsorted';
                        c.columnId = null;
                        c.columnOrder = null;
                        await dbPut('cards', c);
                    }
                    selectedCardIds.delete(id);
                }
                initialCardPositions.clear();
                if (!isSidebarOpen) {
                    isSidebarOpen = true;
                    hasExplicitSidebarPref = true;
                    applySidebarDomState();
                    saveUIState();
                }
                await fetchAndRenderCards();
                await renderUnsortedDrawer(false);
                playCozySound('unsorted');
                showToast(t('movedToUnsortedToast'));
            } else if (hoveredBreadcrumb) {
                const targetBoardId = hoveredBreadcrumb.dataset.breadcrumbBoardId;
                const movedIds = Array.from(initialCardPositions.keys());
                initialCardPositions.clear();
                const preUndo = dragSnapPromise ? await dragSnapPromise : null;
                await moveCardsToBoard(movedIds, targetBoardId, { isBreadcrumb: true, preCapturedUndo: preUndo });
            } else if (hoveredBoard) {
                const targetBoardId = hoveredBoard.dataset.id;
                const movedIds = Array.from(initialCardPositions.keys());
                initialCardPositions.clear();
                const preUndo = dragSnapPromise ? await dragSnapPromise : null;
                await moveCardsToBoard(movedIds, targetBoardId, { preCapturedUndo: preUndo });
            } else if (hoveredColumn) {
                const movedIds = Array.from(initialCardPositions.keys());
                initialCardPositions.clear();
                const preUndo = dragSnapPromise ? await dragSnapPromise : null;
                await moveCardsToColumn(movedIds, hoveredColumn.columnId, hoveredColumn.insertIdx, { preCapturedUndo: preUndo });
            } else {
                let anyPositionChanged = false;
                let anyDetachedFromColumn = false;
                initialCardPositions.forEach((pos, id) => {
                    const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
                    if (el) {
                        const nx = parseFloat(el.style.left);
                        const ny = parseFloat(el.style.top);
                        if (Math.abs(nx - pos.x) >= 1 || Math.abs(ny - pos.y) >= 1) anyPositionChanged = true;
                    }
                });
                if (anyPositionChanged && dragSnapPromise) {
                    await pushUndoSnapshot(await dragSnapPromise);
                }
                for (const id of initialCardPositions.keys()) {
                    const el = document.querySelector(`.interactive-card[data-id="${id}"]`);
                    if (el) {
                        const c = await dbGet('cards', id);
                        if (c) {
                            c.x = parseFloat(el.style.left);
                            c.y = parseFloat(el.style.top);
                            if (c.columnId) {
                                c.columnId = null;
                                c.columnOrder = null;
                                anyDetachedFromColumn = true;
                            }
                            const memCard = cards.find(cd => cd.id === id);
                            if (memCard && typeof memCard.zIndex === 'number') {
                                c.zIndex = memCard.zIndex;
                            }
                            await dbPut('cards', c);
                            if (memCard) { memCard.x = c.x; memCard.y = c.y; memCard.columnId = null; }
                        }
                    }
                }
                initialCardPositions.clear();
                if (anyDetachedFromColumn) {
                    await fetchAndRenderCards();
                }
            }
        }
        if (isResizingImage) {
            isResizingImage = false;
            const resizeSnapPromise = pendingResizeUndoSnapshot;
            pendingResizeUndoSnapshot = null;
            if (resizeCardId) {
                const el = document.querySelector(`.interactive-card[data-id="${resizeCardId}"]`);
                if (el) {
                    const c = await dbGet('cards', resizeCardId);
                    if (c) {
                        const nextW = parseFloat(el.style.width);
                        const cardData = cards.find(cd => cd.id === resizeCardId);
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
            resizeCardId = null;
        }
        if (isDraggingControlPoint) {
            isDraggingControlPoint = false;
            const ctrlSnapPromise = pendingControlUndoSnapshot;
            pendingControlUndoSnapshot = null;
            if (dragControlConnId) {
                const conn = connections.find(c => c.id === dragControlConnId);
                if (conn) {
                    if (ctrlSnapPromise) await pushUndoSnapshot(await ctrlSnapPromise);
                    await dbPut('connections', conn);
                }
            }
            dragControlConnId = null;
        }
        if (isDrawingConnection) {
            isDrawingConnection = false;
            if (tempConnectionLine) { tempConnectionLine.remove(); tempConnectionLine = null; }
            if (tempConnectionSnapDot) { tempConnectionSnapDot.remove(); tempConnectionSnapDot = null; }
            const elements = document.elementsFromPoint(clientX, clientY);
            const targetCardEl = elements.find(el => el.classList.contains('interactive-card') && el.dataset.id !== connectionSourceId);
            if (targetCardEl) {
                await pushUndoSnapshot();
                const rect = viewport.getBoundingClientRect();
                const mouseCanvasX = (clientX - rect.left - canvasPanX) / canvasScale;
                const mouseCanvasY = (clientY - rect.top - canvasPanY) / canvasScale;
                const toAnchor = getAnchorFromCanvasPoint(targetCardEl, mouseCanvasX, mouseCanvasY);
                const targetId = targetCardEl.dataset.id;
                await dbPut('connections', {
                    id: 'conn_' + Date.now(),
                    fromId: connectionSourceId,
                    toId: targetId,
                    fromAnchor: connectionFromAnchor || { side: 'right', t: 0.5 },
                    toAnchor,
                    startMarker: 'none',
                    endMarker: 'arrow'
                });
                await fetchAndRenderCards();
                showToast(t('connectedToast'));
                if (activeTool === 'line') setTool('select');
            }
            connectionSourceId = null;
            connectionFromAnchor = null;
        }
        if (isReconnectingEndpoint) {
            isReconnectingEndpoint = false;
            document.querySelectorAll('.conn-reconnect-target').forEach(el => el.classList.remove('conn-reconnect-target'));
            if (tempConnectionSnapDot) { tempConnectionSnapDot.remove(); tempConnectionSnapDot = null; }
            const ctrlSnapPromise = pendingControlUndoSnapshot;
            pendingControlUndoSnapshot = null;
            const conn = connections.find(c => c.id === reconnectConnId);
            if (conn) {
                const excludedId = reconnectSide === 'from' ? conn.toId : conn.fromId;
                const targetCardEl = findReconnectTargetCard(clientX, clientY, excludedId);
                if (targetCardEl) {
                    const rect = viewport.getBoundingClientRect();
                    const mouseCanvasX = (clientX - rect.left - canvasPanX) / canvasScale;
                    const mouseCanvasY = (clientY - rect.top - canvasPanY) / canvasScale;
                    const targetId = targetCardEl.dataset.id;
                    const nextAnchor = getAnchorFromCanvasPoint(targetCardEl, mouseCanvasX, mouseCanvasY);
                    if ((reconnectSide === 'from' && targetId !== conn.toId) || (reconnectSide === 'to' && targetId !== conn.fromId)) {
                        if (ctrlSnapPromise) await pushUndoSnapshot(await ctrlSnapPromise);
                        if (reconnectSide === 'from') {
                            conn.fromId = targetId;
                            conn.fromAnchor = nextAnchor;
                        } else {
                            conn.toId = targetId;
                            conn.toAnchor = nextAnchor;
                        }
                        await dbPut('connections', conn);
                        showToast(t('connectedToast'));
                    }
                }
            }
            await fetchAndRenderCards();
            reconnectConnId = null; reconnectSide = null;
        }
    }

    viewport.addEventListener('mousedown', (e) => {
        if (activeTool === 'line' && e.button === 0 && !e.target.closest('#context-menu')) {
            const cardEl = e.target.closest('.interactive-card');
            if (cardEl) {
                e.preventDefault();
                e.stopPropagation();
                const rect = viewport.getBoundingClientRect();
                const mx = (e.clientX - rect.left - canvasPanX) / canvasScale;
                const my = (e.clientY - rect.top - canvasPanY) / canvasScale;
                const anchor = getAnchorFromCanvasPoint(cardEl, mx, my);
                startConnectionDraw(e, cardEl.dataset.id, anchor);
                return;
            } else {
                setTool('select');
            }
        }
    }, true);

    viewport.addEventListener('mousedown', (e) => {
        lastMouseClientX = e.clientX;
        lastMouseClientY = e.clientY;
        if (e.target.closest('#context-menu')) return;
        const isBg = (e.target === viewport || e.target.id === 'canvas-content' || e.target.id === 'empty-canvas-prompt' || e.target.tagName === 'svg');

        if (e.button === 1 || (e.button === 0 && (isSpacePressed || activeTool === 'hand'))) {
            e.preventDefault(); isPanning = true; document.body.classList.add('is-canvas-interacting'); startPanX = e.clientX - canvasPanX; startPanY = e.clientY - canvasPanY; return;
        }

        if (e.button === 0 && isBg) {
            if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT' || document.activeElement.isContentEditable)) {
                document.activeElement.blur();
            }
            exitCardEditMode();
            if (!e.shiftKey) {
                clearSelection();
                selectedConnectionId = null;
                drawConnections();
            }
            isMarqueeSelecting = true;
            document.body.classList.add('is-canvas-interacting');
            const rect = viewport.getBoundingClientRect();
            marqueeStartX = e.clientX - rect.left; marqueeStartY = e.clientY - rect.top;
            marquee.style.left = `${marqueeStartX}px`; marquee.style.top = `${marqueeStartY}px`; marquee.style.width = '0px'; marquee.style.height = '0px';
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
        const card = cards.find(c => c.id === cardId);
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
            const editable = cardEl.querySelector('.note-md-editor, textarea, input[type="text"]');
            if (editable) {
                enterCardEditMode(cardEl, editable);
            }
        }
    }

    viewport.addEventListener('touchstart', (e) => {
        if (e.target.closest('#context-menu')) return;
        cancelLongPress();
        longPressedTriggered = false;

        if (e.touches.length === 2) {
            e.preventDefault();
            touchMode = 'pinch';
            isPanning = false;
            isDraggingCards = false;
            initialCardPositions.clear();
            const t0 = e.touches[0], t1 = e.touches[1];
            pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
            pinchStartScale = canvasScale;
            lastPinchMidX = (t0.clientX + t1.clientX) / 2;
            lastPinchMidY = (t0.clientY + t1.clientY) / 2;
            return;
        }

        if (e.touches.length !== 1) return;
        if (isResizingImage || isDraggingControlPoint || isDrawingConnection || isReconnectingEndpoint) {
            e.preventDefault();
            return;
        }

        // Permite interação nativa com inputs já ativos, botões, links, checkboxes e alças de task
        if (e.target.closest('input:not(.pointer-events-none), textarea:not(.pointer-events-none), [contenteditable="true"]:not(.pointer-events-none), button, a, input[type="checkbox"], .task-drag-handle')) {
            touchMode = null;
            return;
        }

        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        touchMoved = false;
        touchOriginalTarget = e.target;
        touchTargetCardEl = e.target.closest('.interactive-card');

        if (activeTool === 'line') {
            if (touchTargetCardEl) {
                e.preventDefault();
                const rect = viewport.getBoundingClientRect();
                const mx = (t.clientX - rect.left - canvasPanX) / canvasScale;
                const my = (t.clientY - rect.top - canvasPanY) / canvasScale;
                const anchor = getAnchorFromCanvasPoint(touchTargetCardEl, mx, my);
                startConnectionDraw(e, touchTargetCardEl.dataset.id, anchor);
                touchMode = null;
                return;
            } else {
                setTool('select');
            }
        }

        if (touchTargetCardEl && activeTool !== 'hand') {
            const cardId = touchTargetCardEl.dataset.id;
            const wasAlreadySelected = selectedCardIds.has(cardId);
            if (wasAlreadySelected && e.target.tagName === 'VIDEO' && !e.target.closest('.video-drag-overlay')) {
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
                startPanX = t.clientX - canvasPanX;
                startPanY = t.clientY - canvasPanY;
                longPressTimer = setTimeout(() => {
                    if (!touchMoved && touchMode === 'pending-unselected-card') {
                        longPressedTriggered = true;
                        touchMode = null;
                        selectedCardIds.clear();
                        selectedCardIds.add(cardId);
                        selectedConnectionId = null;
                        syncSelectionVisuals();
                        drawConnections();
                        openContextMenuAt(touchStartX, touchStartY, touchTargetCardEl);
                    }
                }, 480);
            }
        } else {
            e.preventDefault();
            if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT' || document.activeElement.isContentEditable)) {
                document.activeElement.blur();
            }
            touchMode = 'pending-bg';
            startPanX = t.clientX - canvasPanX;
            startPanY = t.clientY - canvasPanY;
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
            const worldX = (localMidX - canvasPanX) / canvasScale;
            const worldY = (localMidY - canvasPanY) / canvasScale;

            const nextScale = Math.min(Math.max(pinchStartScale * (dist / pinchStartDist), 0.25), 2.5);
            canvasScale = nextScale;
            canvasPanX = localMidX - worldX * canvasScale + (midX - lastPinchMidX);
            canvasPanY = localMidY - worldY * canvasScale + (midY - lastPinchMidY);
            lastPinchMidX = midX;
            lastPinchMidY = midY;

            const pct = Math.round(canvasScale * 100) + '%';
            const zl = document.getElementById('zoom-level');
            const mzl = document.getElementById('mobile-zoom-level');
            if (zl) zl.textContent = pct;
            if (mzl) mzl.textContent = pct;
            updateCanvasTransform();
            return;
        }

        if (e.touches.length !== 1) return;
        const t = e.touches[0];

        if (isResizingImage || isDraggingControlPoint || isDrawingConnection || isReconnectingEndpoint) {
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
                    isDraggingCards = true;
                    document.body.classList.add('is-canvas-interacting');
                    pendingDragUndoSnapshot = captureWorkspaceSnapshot();
                    dragStartMouseX = touchStartX;
                    dragStartMouseY = touchStartY;
                    dragLastClientX = t.clientX;
                    const dragIds = Array.from(selectedCardIds);
                    promoteDraggedCardsToCanvasSpace(dragIds);
                    bringCardsToFrontOnDragStart(dragIds);
                    startDragPhysics(dragIds);
                } else {
                    touchMode = 'pan';
                    isPanning = true;
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
                isPanning = true;
                startPanX = e.touches[0].clientX - canvasPanX;
                startPanY = e.touches[0].clientY - canvasPanY;
            } else {
                touchMode = null;
                saveUIState();
            }
            return;
        }

        if (!longPressedTriggered) {
            if (touchMode === 'pending-bg' && !touchMoved) {
                clearSelection();
                selectedConnectionId = null;
                drawConnections();
            } else if (touchMode === 'pending-unselected-card' && !touchMoved && touchTargetCardEl) {
                const tappedId = touchTargetCardEl.dataset.id;
                selectedCardIds.clear();
                selectedCardIds.add(tappedId);
                selectedConnectionId = null;
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
        const worldX = (mouseX - canvasPanX) / canvasScale;
        const worldY = (mouseY - canvasPanY) / canvasScale;

        const clampedDelta = Math.max(-120, Math.min(120, deltaY));
        const factor = Math.exp(-clampedDelta * 0.0014);
        const nextScale = Math.min(Math.max(canvasScale * factor, 0.25), 2.5);

        canvasScale = nextScale;
        canvasPanX = mouseX - worldX * canvasScale;
        canvasPanY = mouseY - worldY * canvasScale;
        const pct = Math.round(canvasScale * 100) + '%';
        const zl = document.getElementById('zoom-level');
        const mzl = document.getElementById('mobile-zoom-level');
        if (zl) zl.textContent = pct;
        if (mzl) mzl.textContent = pct;
        updateCanvasTransform();
        scheduleSaveUIState();
    }

    window.addEventListener('wheel', (e) => {
        if (e.target.closest && e.target.closest('#pfp-crop-stage')) return;
        if (e.ctrlKey || e.metaKey) {
            // Impede o navegador de aplicar zoom na página inteira mesmo sobre vídeos/embeds/toolbars
            e.preventDefault();
            const insideModalOrSidebar = e.target.closest && e.target.closest('#document-modal, #trash-modal, #settings-modal, #sync-modal, #pfp-crop-modal, #right-sidebar, #home-view');
            if (insideModalOrSidebar) return;
            const rect = viewport.getBoundingClientRect();
            const insideViewport = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (insideViewport) {
                zoomCanvasAtClientPoint(e.clientX, e.clientY, e.deltaY);
            }
        }
    }, { passive: false });

    viewport.addEventListener('wheel', (e) => {
        // Zoom SOMENTE com Ctrl + Scroll (tratado globalmente no listener de window acima)
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            return;
        }

        // Se estiver rolando dentro de um textarea ativo com barra de rolagem, preserva a rolagem interna
        const scrollableTextarea = e.target.closest('textarea');
        if (scrollableTextarea && !scrollableTextarea.classList.contains('pointer-events-none') && scrollableTextarea.scrollHeight > scrollableTextarea.clientHeight) {
            const atTop = scrollableTextarea.scrollTop <= 0 && e.deltaY < 0;
            const atBottom = scrollableTextarea.scrollTop + scrollableTextarea.clientHeight >= scrollableTextarea.scrollHeight - 1 && e.deltaY > 0;
            if (!atTop && !atBottom) return;
        }

        // Scroll normal rola para cima/baixo e esquerda/direita (Shift+Scroll ou deltaX)
        e.preventDefault();
        const dx = (e.shiftKey && e.deltaX === 0) ? e.deltaY : e.deltaX;
        const dy = (e.shiftKey && e.deltaX === 0) ? 0 : e.deltaY;
        canvasPanX -= dx;
        canvasPanY -= dy;
        updateCanvasTransform();
        scheduleSaveUIState();
    }, { passive: false });
}

function startImageResize(e, cardId) {
    e.stopPropagation();
    e.preventDefault();
    const pt = getEventPoint(e);
    pendingResizeUndoSnapshot = captureWorkspaceSnapshot();
    isResizingImage = true;
    document.body.classList.add('is-canvas-interacting');
    resizeCardId = cardId;
    const el = document.querySelector(`.interactive-card[data-id="${cardId}"]`);
    if (el) {
        resizeStartW = el.offsetWidth;
        resizeStartH = el.offsetHeight;
        resizeStartX = pt.clientX;
        resizeStartY = pt.clientY;
    }
}

function startCardDrag(e, cardId) {
    if (e.button !== 0 || isSpacePressed || activeTool === 'hand' || activeTool === 'line') return;
    const hostCardEl = document.querySelector(`.interactive-card[data-id="${cardId}"]`);
    if (hostCardEl && hostCardEl.classList.contains('is-editing')) return;
    e.stopPropagation();
    // Verifica se está tentando arrastar um input ativo
    if (e.target.closest('input:not([type="checkbox"]):not(.pointer-events-none), textarea:not(.pointer-events-none), [contenteditable="true"]:not(.pointer-events-none)')) return;
    if (activeEmbedCardId && activeEmbedCardId !== cardId) setActiveEmbedCard(null);
    if (editingCardId && editingCardId !== cardId) {
        if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT' || document.activeElement.isContentEditable)) {
            document.activeElement.blur();
        }
        exitCardEditMode();
    }

    const wasAlreadySelected = selectedCardIds.has(cardId);
    let selectionCleared = false;
    if (selectedConnectionId) {
        selectedConnectionId = null;
        drawConnections();
        selectionCleared = true;
    }
    if (!e.shiftKey && !wasAlreadySelected && selectedCardIds.size > 0) {
        selectedCardIds.clear();
        selectionCleared = true;
    }
    if (selectionCleared) {
        syncSelectionVisuals();
    }

    pendingCardDrag = {
        cardId,
        startX: e.clientX,
        startY: e.clientY,
        shiftKey: !!e.shiftKey,
        wasAlreadySelected
    };
}

function updateCanvasTransform() {
    const content = document.getElementById('canvas-content');
    const viewport = document.getElementById('canvas-viewport');
    content.style.transform = `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasScale})`;
    content.style.transformOrigin = '0 0';
    if (viewport) {
        const gridSize = 24 * canvasScale;
        viewport.style.backgroundPosition = `${canvasPanX}px ${canvasPanY}px`;
        viewport.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    }
}

