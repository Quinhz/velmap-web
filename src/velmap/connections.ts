import { clearSelection } from './canvasInteractions';
import { fetchAndRenderCards } from './cardRenderer';
import { dbDelete, dbPut } from './db';
import { captureWorkspaceSnapshot, pushUndoSnapshot } from './history';
import { t } from './i18n';
import { S } from './state';
import { syncSelectionVisuals } from './toolbar';
import { showToast } from './uiState';

export function getEventPoint(e) {
    if (e.touches && e.touches.length > 0) return e.touches[0];
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0];
    return e;
}

export function clampAnchorT(t) {
    return Math.max(0.08, Math.min(0.92, Number.isFinite(t) ? t : 0.5));
}

export function getCardConnectionBounds(el) {
    if (!el) return { left: 0, top: 0, width: 1, height: 1 };
    const shape = el.classList.contains('board-node')
        ? el.querySelector('.board-squircle')
        : el.classList.contains('doc-node')
            ? (el.querySelector('.doc-sheet') || el.querySelector('.doc-sheet-wrap'))
            : null;
    if (shape) {
        let shapeLeft = shape.offsetLeft;
        let shapeTop = shape.offsetTop;
        if (shape.offsetParent && shape.offsetParent !== el) {
            shapeLeft += shape.offsetParent.offsetLeft;
            shapeTop += shape.offsetParent.offsetTop;
        }
        return {
            left: el.offsetLeft + shapeLeft,
            top: el.offsetTop + shapeTop,
            width: Math.max(1, shape.offsetWidth),
            height: Math.max(1, shape.offsetHeight)
        };
    }
    return {
        left: el.offsetLeft,
        top: el.offsetTop,
        width: Math.max(1, el.offsetWidth),
        height: Math.max(1, el.offsetHeight)
    };
}

export function getAnchorFromCanvasPoint(el, canvasX, canvasY) {
    if (!el) return { side: 'right', t: 0.5 };
    const { left, top, width: w, height: h } = getCardConnectionBounds(el);
    const dists = [
        { side: 'top', d: Math.abs(canvasY - top), t: clampAnchorT((canvasX - left) / w) },
        { side: 'right', d: Math.abs(canvasX - (left + w)), t: clampAnchorT((canvasY - top) / h) },
        { side: 'bottom', d: Math.abs(canvasY - (top + h)), t: clampAnchorT((canvasX - left) / w) },
        { side: 'left', d: Math.abs(canvasX - left), t: clampAnchorT((canvasY - top) / h) }
    ];
    dists.sort((a, b) => a.d - b.d);
    return { side: dists[0].side, t: dists[0].t };
}

export function getBestAutoAnchors(fromEl, toEl) {
    const fb = getCardConnectionBounds(fromEl);
    const tb = getCardConnectionBounds(toEl);
    const fCx = fb.left + fb.width / 2;
    const fCy = fb.top + fb.height / 2;
    const tCx = tb.left + tb.width / 2;
    const tCy = tb.top + tb.height / 2;
    const dx = tCx - fCx;
    const dy = tCy - fCy;
    const normX = Math.abs(dx) / Math.max(1, (fb.width + tb.width) / 2);
    const normY = Math.abs(dy) / Math.max(1, (fb.height + tb.height) / 2);
    if (normX >= normY) {
        return dx >= 0
            ? { from: { side: 'right', t: 0.5 }, to: { side: 'left', t: 0.5 } }
            : { from: { side: 'left', t: 0.5 }, to: { side: 'right', t: 0.5 } };
    }
    return dy >= 0
        ? { from: { side: 'bottom', t: 0.5 }, to: { side: 'top', t: 0.5 } }
        : { from: { side: 'top', t: 0.5 }, to: { side: 'bottom', t: 0.5 } };
}

export function resolveAnchorPoint(el, anchor) {
    const { left, top, width: w, height: h } = getCardConnectionBounds(el);
    const side = anchor?.side || 'right';
    const t = clampAnchorT(anchor?.t ?? 0.5);
    if (side === 'top') return { x: left + w * t, y: top, nx: 0, ny: -1 };
    if (side === 'bottom') return { x: left + w * t, y: top + h, nx: 0, ny: 1 };
    if (side === 'left') return { x: left, y: top + h * t, nx: -1, ny: 0 };
    return { x: left + w, y: top + h * t, nx: 1, ny: 0 };
}

export function buildConnectionGeometry(startPt, endPt, dxMid = 0, dyMid = 0, hasStartArrow = false, hasEndArrow = false) {
    const gap = 4;
    const sx = startPt.x + startPt.nx * gap;
    const sy = startPt.y + startPt.ny * gap;
    const ex = endPt.x + endPt.nx * gap;
    const ey = endPt.y + endPt.ny * gap;

    const dist = Math.hypot(ex - sx, ey - sy);
    const tangent = Math.max(32, Math.min(180, dist * 0.45));
    const cx1 = sx + startPt.nx * tangent + dxMid * 1.3333;
    const cy1 = sy + startPt.ny * tangent + dyMid * 1.3333;
    const cx2 = ex + endPt.nx * tangent + dxMid * 1.3333;
    const cy2 = ey + endPt.ny * tangent + dyMid * 1.3333;

    const angleStart = Math.atan2(sy - cy1, sx - cx1);
    const angleEnd = Math.atan2(ey - cy2, ex - cx2);

    const lineSx = hasStartArrow ? sx - Math.cos(angleStart) * 5 : sx;
    const lineSy = hasStartArrow ? sy - Math.sin(angleStart) * 5 : sy;
    const lineEx = hasEndArrow ? ex - Math.cos(angleEnd) * 5 : ex;
    const lineEy = hasEndArrow ? ey - Math.sin(angleEnd) * 5 : ey;

    const midX = 0.125 * sx + 0.375 * cx1 + 0.375 * cx2 + 0.125 * ex;
    const midY = 0.125 * sy + 0.375 * cy1 + 0.375 * cy2 + 0.125 * ey;

    return {
        sx, sy, ex, ey, cx1, cy1, cx2, cy2,
        angleStart, angleEnd, midX, midY,
        hitboxPath: `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${ex} ${ey}`,
        linePath: `M ${lineSx} ${lineSy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${lineEx} ${lineEy}`
    };
}

export function attachConnectionDots(containerEl, cardId) {
    const sides = [
        { side: 'top', arrowPath: 'M6 10V2.5M2.5 5.5L6 2l3.5 3.5' },
        { side: 'right', arrowPath: 'M2 6h7.5M6.5 2.5L10 6l-3.5 3.5' },
        { side: 'bottom', arrowPath: 'M6 2v7.5M2.5 6.5L6 10l3.5-3.5' },
        { side: 'left', arrowPath: 'M10 6H2.5M5.5 2.5L2 6l3.5 3.5' }
    ];
    sides.forEach(({ side, arrowPath }) => {
        const dot = document.createElement('div');
        dot.dataset.anchorSide = side;
        dot.className = `connection-dot connection-dot--${side}`;
        dot.title = t('dragToConnect');
        dot.innerHTML = `<span class="connection-dot-circle"></span><span class="connection-dot-arrow" aria-hidden="true"><svg viewBox="0 0 12 12" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${arrowPath}"/></svg></span>`;
        dot.onmousedown = (e) => startConnectionDraw(e, cardId, { side, t: 0.5 });
        dot.ontouchstart = (e) => startConnectionDraw(e, cardId, { side, t: 0.5 });
        containerEl.appendChild(dot);
    });
}

export function startConnectionDraw(e, cardId, anchor = null) {
    e.stopPropagation();
    e.preventDefault();
    if (e.type === 'mousedown' && e.button !== 0) return;

    S.isDrawingConnection = true;
    S.connectionSourceId = cardId;
    if (anchor && anchor.side) {
        S.connectionFromAnchor = { side: anchor.side, t: clampAnchorT(anchor.t ?? 0.5) };
    } else {
        const fromEl = document.querySelector(`.interactive-card[data-id="${cardId}"]`);
        const vp = document.getElementById('canvas-viewport');
        const pt = getEventPoint(e);
        if (fromEl && vp && pt) {
            const rect = vp.getBoundingClientRect();
            const mx = (pt.clientX - rect.left - S.canvasPanX) / S.canvasScale;
            const my = (pt.clientY - rect.top - S.canvasPanY) / S.canvasScale;
            S.connectionFromAnchor = getAnchorFromCanvasPoint(fromEl, mx, my);
        } else {
            S.connectionFromAnchor = { side: 'right', t: 0.5 };
        }
    }

    const svg = document.getElementById('connections-svg');
    if (S.tempConnectionLine) S.tempConnectionLine.remove();
    if (S.tempConnectionSnapDot) S.tempConnectionSnapDot.remove();

    S.tempConnectionLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    S.tempConnectionLine.setAttribute('stroke', '#a1a1aa');
    S.tempConnectionLine.setAttribute('stroke-width', '2');
    S.tempConnectionLine.setAttribute('fill', 'none');
    S.tempConnectionLine.setAttribute('stroke-dasharray', '5 4');
    svg.appendChild(S.tempConnectionLine);

    S.tempConnectionSnapDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    S.tempConnectionSnapDot.setAttribute('r', '5');
    S.tempConnectionSnapDot.setAttribute('fill', '#ffffff');
    S.tempConnectionSnapDot.setAttribute('stroke', '#141416');
    S.tempConnectionSnapDot.setAttribute('stroke-width', '1.5');
    S.tempConnectionSnapDot.classList.add('hidden');
    svg.appendChild(S.tempConnectionSnapDot);
}

export function drawConnections() {
    const svg = document.getElementById('connections-svg');
    Array.from(svg.querySelectorAll('.conn-line, .conn-control, .conn-endpoint, .conn-hitbox, .conn-label, .conn-arrow')).forEach(el => el.remove());

    S.connections.forEach(conn => {
        const fromEl = document.querySelector(`.interactive-card[data-id="${conn.fromId}"]`);
        const toEl = document.querySelector(`.interactive-card[data-id="${conn.toId}"]`);
        if (!fromEl || !toEl) return;

        const autoAnchors = (!conn.fromAnchor || !conn.toAnchor) ? getBestAutoAnchors(fromEl, toEl) : null;
        const startPt = resolveAnchorPoint(fromEl, conn.fromAnchor || autoAnchors.from);
        const endPt = resolveAnchorPoint(toEl, conn.toAnchor || autoAnchors.to);

        const hasEndArrow = conn.endMarker !== 'none';
        const hasStartArrow = conn.startMarker === 'arrow';
        const geom = buildConnectionGeometry(startPt, endPt, conn.dx_mid || 0, conn.dy_mid || 0, hasStartArrow, hasEndArrow);

        const isSelected = S.selectedConnectionId === conn.id;
        const color = conn.color || '#71717a';
        const strokeColor = isSelected ? '#ffffff' : color;
        const weight = conn.weight || 2;

        const hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitbox.setAttribute('d', geom.hitboxPath);
        hitbox.setAttribute('class', 'conn-hitbox');
        hitbox.dataset.id = conn.id;
        const selectConnHandler = (e) => {
            e.stopPropagation();
            S.selectedConnectionId = conn.id;
            clearSelection();
            drawConnections();
            syncSelectionVisuals();
        };
        hitbox.addEventListener('mousedown', selectConnHandler);
        hitbox.addEventListener('touchstart', selectConnHandler, { passive: true });
        svg.appendChild(hitbox);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', geom.linePath);
        path.setAttribute('stroke', strokeColor);
        path.setAttribute('stroke-width', isSelected ? weight + 1 : weight);
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('fill', 'none');
        path.setAttribute('class', `conn-line pointer-events-none ${isSelected ? 'selected' : ''}`);
        if (conn.isDashed) path.setAttribute('stroke-dasharray', '6 6');
        svg.appendChild(path);

        const arrowSize = 7 + (weight * 1.4);
        function createArrow(x, y, angle, type) {
            if (type === 'none') return null;
            if (type === 'dot') {
                const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                c.setAttribute('cx', x); c.setAttribute('cy', y);
                c.setAttribute('r', String(arrowSize / 2 + 1));
                c.setAttribute('fill', strokeColor);
                c.setAttribute('class', 'conn-arrow pointer-events-none');
                return c;
            }
            const p1 = `${x},${y}`;
            const p2 = `${x - arrowSize * Math.cos(angle - Math.PI / 6)},${y - arrowSize * Math.sin(angle - Math.PI / 6)}`;
            const p3 = `${x - arrowSize * Math.cos(angle + Math.PI / 6)},${y - arrowSize * Math.sin(angle + Math.PI / 6)}`;
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', `${p1} ${p2} ${p3}`);
            poly.setAttribute('fill', strokeColor);
            poly.setAttribute('class', 'conn-arrow pointer-events-none');
            return poly;
        }

        if (hasEndArrow) {
            const endArrow = createArrow(geom.ex, geom.ey, geom.angleEnd, conn.endMarker || 'arrow');
            if (endArrow) svg.appendChild(endArrow);
        }

        if (hasStartArrow) {
            const startArrow = createArrow(geom.sx, geom.sy, geom.angleStart, 'arrow');
            if (startArrow) svg.appendChild(startArrow);
        }

        if (conn.label && conn.label.trim() !== '') {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(geom.midX));
            text.setAttribute('y', String(geom.midY - 8));
            text.setAttribute('fill', '#a1a1aa');
            text.setAttribute('font-size', '11');
            text.setAttribute('font-family', 'Inter, sans-serif');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('class', 'conn-label pointer-events-none select-none');
            text.textContent = conn.label;
            svg.appendChild(text);
        }

        if (isSelected) {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(geom.midX)); circle.setAttribute('cy', String(geom.midY));
            circle.setAttribute('r', '5'); circle.setAttribute('fill', '#ffffff');
            circle.setAttribute('class', 'conn-control pointer-events-auto cursor-move');
            const startCtrlDrag = (e) => {
                e.stopPropagation();
                S.pendingControlUndoSnapshot = captureWorkspaceSnapshot();
                const pt = getEventPoint(e);
                S.isDraggingControlPoint = true; S.dragControlConnId = conn.id;
                S.dragStartMouseX = pt.clientX; S.dragStartMouseY = pt.clientY;
                S.initialDxMid = conn.dx_mid || 0; S.initialDyMid = conn.dy_mid || 0;
            };
            circle.addEventListener('mousedown', startCtrlDrag);
            circle.addEventListener('touchstart', startCtrlDrag, { passive: true });
            svg.appendChild(circle);

            const startDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            startDot.setAttribute('cx', geom.sx); startDot.setAttribute('cy', geom.sy);
            startDot.setAttribute('r', '6'); startDot.setAttribute('fill', '#141416');
            startDot.setAttribute('stroke', '#ffffff'); startDot.setAttribute('stroke-width', '2');
            startDot.setAttribute('class', 'conn-endpoint pointer-events-auto cursor-crosshair');
            const startReconnFrom = (e) => {
                e.stopPropagation();
                S.pendingControlUndoSnapshot = captureWorkspaceSnapshot();
                S.isReconnectingEndpoint = true; S.reconnectConnId = conn.id; S.reconnectSide = 'from';
            };
            startDot.addEventListener('mousedown', startReconnFrom);
            startDot.addEventListener('touchstart', startReconnFrom, { passive: true });
            svg.appendChild(startDot);

            const endDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            endDot.setAttribute('cx', geom.ex); endDot.setAttribute('cy', geom.ey);
            endDot.setAttribute('r', '6'); endDot.setAttribute('fill', '#141416');
            endDot.setAttribute('stroke', '#ffffff'); endDot.setAttribute('stroke-width', '2');
            endDot.setAttribute('class', 'conn-endpoint pointer-events-auto cursor-crosshair');
            const startReconnTo = (e) => {
                e.stopPropagation();
                S.isReconnectingEndpoint = true; S.reconnectConnId = conn.id; S.reconnectSide = 'to';
            };
            endDot.addEventListener('mousedown', startReconnTo);
            endDot.addEventListener('touchstart', startReconnTo, { passive: true });
            svg.appendChild(endDot);
        }
    });
}

export async function deleteSelectedConnection() {
    if (!S.selectedConnectionId) return;
    await pushUndoSnapshot();
    await dbDelete('connections', S.selectedConnectionId);
    S.selectedConnectionId = null;
    await fetchAndRenderCards(); // Redesenha os cards e linhas
    syncSelectionVisuals();
    showToast(t('connectionDeleted'));
}

export async function toggleConnectionDashed() {
    if (!S.selectedConnectionId) return;
    const conn = S.connections.find(c => c.id === S.selectedConnectionId);
    if (conn) {
        conn.isDashed = !conn.isDashed;
        await dbPut('connections', conn);
        drawConnections();
    }
}

export async function setConnColor(color) {
    if (!S.selectedConnectionId) return;
    const conn = S.connections.find(c => c.id === S.selectedConnectionId);
    if (conn) {
        conn.color = color;
        await dbPut('connections', conn);
        drawConnections();
    }
}

export async function toggleStartMarker() {
    if (!S.selectedConnectionId) return;
    const conn = S.connections.find(c => c.id === S.selectedConnectionId);
    if (conn) {
        conn.startMarker = conn.startMarker === 'arrow' ? 'none' : 'arrow';
        await dbPut('connections', conn);
        drawConnections();
        syncSelectionVisuals();
    }
}

export async function toggleEndMarker() {
    if (!S.selectedConnectionId) return;
    const conn = S.connections.find(c => c.id === S.selectedConnectionId);
    if (conn) {
        conn.endMarker = conn.endMarker === 'none' ? 'arrow' : 'none';
        await dbPut('connections', conn);
        drawConnections();
        syncSelectionVisuals();
    }
}

export async function cycleConnWeight() {
    if (!S.selectedConnectionId) return;
    const conn = S.connections.find(c => c.id === S.selectedConnectionId);
    if (conn) {
        const weights = [1, 2, 4];
        const curr = conn.weight || 2;
        conn.weight = weights[(weights.indexOf(curr) + 1) % weights.length];
        await dbPut('connections', conn);
        drawConnections();
        syncSelectionVisuals();
    }
}

export async function promptConnLabel() {
    if (!S.selectedConnectionId) return;
    const conn = S.connections.find(c => c.id === S.selectedConnectionId);
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

export function clearConnectionSelection() {
    S.selectedConnectionId = null;
    drawConnections();
    syncSelectionVisuals();
}
