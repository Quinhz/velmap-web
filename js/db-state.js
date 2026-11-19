// ==========================================
// 1. CONFIGURAÇÃO E BANCO DE DADOS
// ==========================================
const DB_NAME = 'MilanoteExcalidrawDB';
const DB_VERSION = 4; // Versão 4 adiciona store 'kv' para handles persistidos
let db = null;
const blobUrlCache = new Map();

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (event) => reject('IndexedDB Error: ' + event.target.errorCode);
        request.onsuccess = (event) => { db = event.target.result; resolve(db); };
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains('boards')) {
                database.createObjectStore('boards', { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains('cards')) {
                const cardStore = database.createObjectStore('cards', { keyPath: 'id' });
                cardStore.createIndex('boardId', 'boardId', { unique: false });
                cardStore.createIndex('isTrash', 'isTrash', { unique: false });
            }
            if (!database.objectStoreNames.contains('assets')) {
                database.createObjectStore('assets', { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains('connections')) {
                database.createObjectStore('connections', { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains('kv')) {
                database.createObjectStore('kv', { keyPath: 'id' });
            }
        };
    });
}

function dbPut(store, item, skipTouch = false) {
    if (!skipTouch && item && typeof item === 'object' && store !== 'assets') {
        item.updatedAt = Date.now();
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction([store], 'readwrite');
        const req = tx.objectStore(store).put(item);
        req.onsuccess = () => {
            if (!skipTouch) scheduleSyncMutation();
            resolve(req.result);
        };
        req.onerror = (e) => reject(e);
    });
}
function dbGet(store, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([store], 'readonly');
        const req = tx.objectStore(store).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e);
    });
}
function dbGetAll(store) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([store], 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e);
    });
}
function dbDelete(store, id, skipTouch = false) {
    if (!skipTouch && (store === 'boards' || store === 'cards' || store === 'connections')) {
        recordTombstone(store, id);
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction([store], 'readwrite');
        const req = tx.objectStore(store).delete(id);
        req.onsuccess = () => {
            if (!skipTouch) scheduleSyncMutation();
            resolve();
        };
        req.onerror = (e) => reject(e);
    });
}

// ==========================================
// 2. ESTADO DA APLICAÇÃO
// ==========================================
let currentBoardId = 'root';
let breadcrumbs = [{ id: 'root', title: 'Home' }];
let activeTool = 'select';
let isSpacePressed = false;
let canvasScale = 1;
let canvasPanX = 0;
let canvasPanY = 0;

let isPanning = false;
let startPanX = 0;
let startPanY = 0;

let isMarqueeSelecting = false;
let marqueeStartX = 0;
let marqueeStartY = 0;

let cards = [];
let allSystemCards = [];
let connections = []; // Estado das conexões
let selectedCardIds = new Set();
let selectedUnsortedCardIds = new Set(); // NOVO: Seleção do painel Unsorted
let searchQuery = '';
let isSidebarOpen = window.innerWidth >= 768;

let isDraggingCards = false;
let pendingCardDrag = null;
let dragStartMouseX = 0;
let dragStartMouseY = 0;
let initialCardPositions = new Map();
let pendingMediaClick = null;
let activeEmbedCardId = null;
let dragLastClientX = 0;
let dragVelocityX = 0;
let dragCurrentTilt = 0;
let dragCurrentScale = 1.015;
let isDragOverInteractiveArea = false;
let areDraggedCardsElevated = false;
let dragPhysicsRaf = null;

let floatingDragState = null;
let pendingFloatingDrag = null;
let suppressNextToolClick = false;

let internalDragPayload = null;
let draggedTaskPayload = null;
let externalImageUrl = null;

const MAX_UNDO_HISTORY = 40;
let undoStack = [];
let redoStack = [];
let isApplyingHistory = false;
let pendingDragUndoSnapshot = null;
let pendingResizeUndoSnapshot = null;
let pendingControlUndoSnapshot = null;

const VELMAP_CLIPBOARD_PREFIX = 'VELMAP_CLIPBOARD_V1:';
let velmapClipboard = null;
let lastMouseClientX = null;
let lastMouseClientY = null;
let lastPasteCursorKey = null;
let lastPasteSameSpotCount = 0;
let editingCardId = null;
let pendingArrowUndoSnapshot = null;
let arrowNudgeTimer = null;
let arrowMovedCardIds = new Set();

function syncFaviconLogos() {
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

function enterCardEditMode(cardEl, focusTarget = null) {
    if (!cardEl) return;
    const cardId = cardEl.dataset.id;
    if (editingCardId && editingCardId !== cardId) {
        exitCardEditMode(editingCardId);
    }
    let selectionChanged = false;
    if (selectedCardIds.size > 0) {
        selectedCardIds.clear();
        selectionChanged = true;
    }
    if (activeEmbedCardId) {
        setActiveEmbedCard(null);
    }
    if (selectedConnectionId) {
        selectedConnectionId = null;
        drawConnections();
        selectionChanged = true;
    }
    if (selectionChanged) {
        syncSelectionVisuals();
    }
    editingCardId = cardId;
    cardEl.classList.add('is-editing');
    const type = cardEl.dataset.type;
    if (type === 'table') {
        cardEl.querySelectorAll('.table-cell-input').forEach(inp => inp.classList.remove('pointer-events-none'));
    } else if (type === 'sticky') {
        cardEl.querySelectorAll('.note-md-editor').forEach(ed => ed.classList.remove('pointer-events-none'));
    } else if (type === 'comment') {
        cardEl.querySelectorAll('textarea').forEach(ta => ta.classList.remove('pointer-events-none'));
    } else if (type === 'task') {
        cardEl.querySelectorAll('.task-input').forEach(inp => inp.classList.remove('pointer-events-none'));
    }
    if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus();
        if (typeof focusTarget.setSelectionRange === 'function' && typeof focusTarget.value === 'string') {
            const len = focusTarget.value.length;
            try { focusTarget.setSelectionRange(len, len); } catch (_) {}
        } else if (focusTarget.isContentEditable) {
            try {
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(focusTarget);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            } catch (_) {}
        }
    }
}

function exitCardEditMode(cardId = null) {
    const targetId = cardId || editingCardId;
    if (!targetId) return;
    const cardEl = document.querySelector(`.interactive-card[data-id="${targetId}"]`);
    if (cardEl) {
        cardEl.classList.remove('is-editing');
        const type = cardEl.dataset.type;
        if (type === 'table') {
            cardEl.querySelectorAll('.table-cell-input').forEach(inp => inp.classList.add('pointer-events-none'));
        } else if (type === 'sticky') {
            cardEl.querySelectorAll('.note-md-editor').forEach(ed => ed.classList.add('pointer-events-none'));
        } else if (type === 'comment') {
            cardEl.querySelectorAll('textarea').forEach(ta => ta.classList.add('pointer-events-none'));
        } else if (type === 'task') {
            cardEl.querySelectorAll('.task-input').forEach(inp => inp.classList.add('pointer-events-none'));
        }
    }
    if (!cardId || editingCardId === cardId) {
        editingCardId = null;
    }
}

const BOARD_BG_PRESETS = [
    { id: 'obsidian', color: '#131316', pattern: 'dots', label: 'Obsidian' },
    { id: 'charcoal', color: '#1b1a18', pattern: 'dots', label: 'Warm Charcoal' },
    { id: 'slate', color: '#111622', pattern: 'dots', label: 'Midnight Slate' },
    { id: 'forest', color: '#101915', pattern: 'dots', label: 'Deep Pine' },
    { id: 'plum', color: '#19131f', pattern: 'dots', label: 'Dusk Plum' },
    { id: 'steel', color: '#1d2026', pattern: 'grid', label: 'Cool Steel' }
];

// Estado para criar linha de conexão
let isDrawingConnection = false;
let connectionSourceId = null;
let connectionFromAnchor = null;
let tempConnectionLine = null;
let tempConnectionSnapDot = null;

// NOVO: Estado para arrastar as pontas da linha
let isReconnectingEndpoint = false;
let reconnectConnId = null;
let reconnectSide = null; // 'from' ou 'to'

let selectedConnectionId = null;
let isDraggingControlPoint = false;
let dragControlConnId = null;
let initialDxMid = 0;
let initialDyMid = 0;

let isResizingImage = false;
let resizeCardId = null;
let resizeStartW = 0;
let resizeStartH = 0;
let resizeStartX = 0;
let resizeStartY = 0;

// Histórico de navegação (Go Back / Go Forward)
let navHistory = [];
let navHistoryIndex = -1;
let isNavigatingHistory = false;

function stripHtmlToText(html) {
    if (!html) return '';
    const str = String(html);
    if (!/[<>]/.test(str)) return str.replace(/\u200B/g, '');
    const tmp = document.createElement('div');
    tmp.innerHTML = str
        .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<hr\s*\/?>/gi, '\n---\n');
    return (tmp.textContent || tmp.innerText || '')
        .replace(/\u200B/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function escapeHtmlText(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatInlineMarkdownHtml(rawLine) {
    let html = escapeHtmlText(rawLine);
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return html;
}

function markdownToRichHtml(raw) {
    if (!raw) return '';
    const str = String(raw);
    if (/<(p|div|h[1-6]|ul|ol|li|blockquote|strong|em|b|i|u|s|code|pre|br|hr|a|span)\b[^>]*>/i.test(str)) {
        return str;
    }
    const lines = str.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let listType = null;
    const closeList = () => {
        if (listType) {
            out.push(`</${listType}>`);
            listType = null;
        }
    };
    for (const line of lines) {
        const hMatch = line.match(/^(#{1,4})\s+(.*)$/);
        if (hMatch) {
            closeList();
            const lvl = hMatch[1].length;
            const body = formatInlineMarkdownHtml(hMatch[2]);
            out.push(`<h${lvl}>${body || '<br>'}</h${lvl}>`);
            continue;
        }
        const bqMatch = line.match(/^>\s+(.*)$/);
        if (bqMatch) {
            closeList();
            out.push(`<blockquote>${formatInlineMarkdownHtml(bqMatch[1]) || '<br>'}</blockquote>`);
            continue;
        }
        if (/^\s*(?:---|\*\*\*)\s*$/.test(line)) {
            closeList();
            out.push('<hr>');
            continue;
        }
        const ulMatch = line.match(/^[-*]\s+(.*)$/);
        if (ulMatch) {
            if (listType !== 'ul') { closeList(); listType = 'ul'; out.push('<ul>'); }
            out.push(`<li>${formatInlineMarkdownHtml(ulMatch[1]) || '<br>'}</li>`);
            continue;
        }
        const olMatch = line.match(/^\d+\.\s+(.*)$/);
        if (olMatch) {
            if (listType !== 'ol') { closeList(); listType = 'ol'; out.push('<ol>'); }
            out.push(`<li>${formatInlineMarkdownHtml(olMatch[1]) || '<br>'}</li>`);
            continue;
        }
        closeList();
        if (line.trim() === '') {
            if (lines.length > 1) out.push('<p><br></p>');
        } else {
            out.push(`<p>${formatInlineMarkdownHtml(line)}</p>`);
        }
    }
    closeList();
    return out.join('');
}

function getMdDirectBlock(root, node) {
    let cur = node;
    while (cur && cur !== root) {
        if (cur.nodeType === Node.ELEMENT_NODE && cur.parentNode === root) {
            const tag = cur.tagName;
            if (/^(P|DIV|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|LI)$/.test(tag)) return cur;
            if (tag === 'UL' || tag === 'OL') {
                let inner = node;
                while (inner && inner.parentNode !== cur) inner = inner.parentNode;
                return inner && inner.tagName === 'LI' ? inner : cur;
            }
        }
        if (cur.nodeType === Node.ELEMENT_NODE && cur.tagName === 'LI' && root.contains(cur)) {
            return cur;
        }
        cur = cur.parentNode;
    }
    return null;
}

function replaceBlockTag(root, blockEl, newTag, stripCharCount, sel, range) {
    // Strip leading trigger characters from block text while preserving remainder + cursor
    let remainingToStrip = stripCharCount;
    const walker = document.createTreeWalker(blockEl || root, NodeFilter.SHOW_TEXT, null);
    let node;
    const nodesToRemove = [];
    while ((node = walker.nextNode()) && remainingToStrip > 0) {
        if (blockEl === null && getMdDirectBlock(root, node)) continue;
        const len = node.nodeValue.length;
        if (len <= remainingToStrip) {
            remainingToStrip -= len;
            nodesToRemove.push(node);
        } else {
            node.nodeValue = node.nodeValue.slice(remainingToStrip);
            remainingToStrip = 0;
        }
    }
    nodesToRemove.forEach(n => n.remove());

    let newEl;
    if (newTag === 'UL' || newTag === 'OL') {
        const list = document.createElement(newTag);
        const li = document.createElement('li');
        if (blockEl) {
            while (blockEl.firstChild) li.appendChild(blockEl.firstChild);
            blockEl.replaceWith(list);
        } else {
            const frag = document.createDocumentFragment();
            let cur = range.startContainer;
            while (cur && cur.parentNode !== root) cur = cur.parentNode;
            // Collect inline sibling nodes around cur on this top line
            const lineNodes = [];
            let scan = cur;
            while (scan && scan.previousSibling && scan.previousSibling.nodeName !== 'BR' && !/^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR)$/.test(scan.previousSibling.nodeName)) {
                scan = scan.previousSibling;
            }
            while (scan && scan.nodeName !== 'BR' && !/^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR)$/.test(scan.nodeName)) {
                const next = scan.nextSibling;
                lineNodes.push(scan);
                scan = next;
            }
            if (lineNodes.length > 0) {
                root.insertBefore(list, lineNodes[0]);
                lineNodes.forEach(n => li.appendChild(n));
            } else {
                root.appendChild(list);
            }
        }
        if (!li.textContent && !li.querySelector('br')) li.appendChild(document.createElement('br'));
        list.appendChild(li);
        newEl = li;
    } else if (newTag === 'HR') {
        const hr = document.createElement('hr');
        const p = document.createElement('p');
        p.appendChild(document.createElement('br'));
        if (blockEl) {
            blockEl.replaceWith(hr);
            hr.insertAdjacentElement('afterend', p);
        } else {
            root.appendChild(hr);
            root.appendChild(p);
        }
        newEl = p;
    } else {
        newEl = document.createElement(newTag);
        if (blockEl) {
            while (blockEl.firstChild) newEl.appendChild(blockEl.firstChild);
            blockEl.replaceWith(newEl);
        } else {
            let cur = range.startContainer;
            while (cur && cur.parentNode !== root) cur = cur.parentNode;
            const lineNodes = [];
            let scan = cur;
            while (scan && scan.previousSibling && scan.previousSibling.nodeName !== 'BR' && !/^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR)$/.test(scan.previousSibling.nodeName)) {
                scan = scan.previousSibling;
            }
            while (scan && scan.nodeName !== 'BR' && !/^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR)$/.test(scan.nodeName)) {
                const next = scan.nextSibling;
                lineNodes.push(scan);
                scan = next;
            }
            if (lineNodes.length > 0) {
                root.insertBefore(newEl, lineNodes[0]);
                lineNodes.forEach(n => newEl.appendChild(n));
                if (scan && scan.nodeName === 'BR') scan.remove();
            } else {
                root.appendChild(newEl);
            }
        }
        if (!newEl.textContent && !newEl.querySelector('br')) newEl.appendChild(document.createElement('br'));
    }

    try {
        const nextRange = document.createRange();
        const firstText = newEl.firstChild && newEl.firstChild.nodeType === Node.TEXT_NODE ? newEl.firstChild : null;
        if (firstText) {
            nextRange.setStart(firstText, 0);
        } else {
            nextRange.setStart(newEl, 0);
        }
        nextRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(nextRange);
    } catch (_) {}
}

function tryApplyInlineMarkdownAtCaret(range, sel) {
    const node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const offset = range.startOffset;
    const before = node.nodeValue.slice(0, offset);
    const after = node.nodeValue.slice(offset);
    const patterns = [
        { regex: /\*\*([^*\n]+)\*\*$/, tag: 'strong' },
        { regex: /~~([^~\n]+)~~$/, tag: 's' },
        { regex: /`([^`\n]+)`$/, tag: 'code' },
        { regex: /(?:^|[^*])\*([^*\n]+)\*$/, tag: 'em', hasPrefixChar: true }
    ];
    for (const p of patterns) {
        const m = before.match(p.regex);
        if (!m) continue;
        let matchStart = before.length - m[0].length;
        if (p.hasPrefixChar && m[0].length > m[1].length + 2) {
            matchStart += 1;
        }
        const prefixText = before.slice(0, matchStart);
        const innerText = m[1];
        const parent = node.parentNode;
        if (!parent || parent.tagName === p.tag.toUpperCase()) return false;

        const inlineEl = document.createElement(p.tag);
        inlineEl.textContent = innerText;
        const afterTextNode = document.createTextNode('\u200B' + after);

        if (prefixText) {
            node.nodeValue = prefixText;
            parent.insertBefore(inlineEl, node.nextSibling);
        } else {
            parent.replaceChild(inlineEl, node);
        }
        parent.insertBefore(afterTextNode, inlineEl.nextSibling);

        const nextRange = document.createRange();
        nextRange.setStart(afterTextNode, 1);
        nextRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(nextRange);
        return true;
    }
    return false;
}

function attachLiveMarkdownEditor(editorEl, { onChange } = {}) {
    if (!editorEl) return;
    if (editorEl.dataset.mdAttached === '1') return;
    editorEl.dataset.mdAttached = '1';

    editorEl.addEventListener('keydown', (e) => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!editorEl.contains(range.startContainer)) return;

        const blockEl = getMdDirectBlock(editorEl, range.startContainer);
        if (!blockEl) return;
        const tag = blockEl.tagName;

        if (e.key === 'Enter' && !e.shiftKey && /^(H[1-4]|BLOCKQUOTE)$/.test(tag)) {
            e.preventDefault();
            const tailRange = document.createRange();
            tailRange.setStart(range.startContainer, range.startOffset);
            tailRange.setEnd(blockEl, blockEl.childNodes.length);
            const frag = tailRange.extractContents();
            const p = document.createElement('p');
            p.appendChild(frag);
            if (!p.textContent.replace(/\u200B/g, '').trim() && !p.querySelector('br')) {
                p.innerHTML = '<br>';
            }
            if (!blockEl.textContent.replace(/\u200B/g, '').trim() && !blockEl.querySelector('br')) {
                blockEl.innerHTML = '<br>';
            }
            blockEl.insertAdjacentElement('afterend', p);
            const nr = document.createRange();
            nr.setStart(p, 0);
            nr.collapse(true);
            sel.removeAllRanges();
            sel.addRange(nr);
            if (onChange) onChange();
            return;
        }

        if (e.key === 'Backspace' && range.collapsed && /^(H[1-4]|BLOCKQUOTE)$/.test(tag)) {
            const preRange = document.createRange();
            preRange.setStart(blockEl, 0);
            preRange.setEnd(range.startContainer, range.startOffset);
            if (preRange.toString().replace(/\u200B/g, '').length === 0) {
                e.preventDefault();
                const p = document.createElement('p');
                while (blockEl.firstChild) p.appendChild(blockEl.firstChild);
                if (!p.childNodes.length) p.innerHTML = '<br>';
                blockEl.replaceWith(p);
                const nr = document.createRange();
                nr.setStart(p, 0);
                nr.collapse(true);
                sel.removeAllRanges();
                sel.addRange(nr);
                if (onChange) onChange();
            }
        }
    });

    editorEl.addEventListener('input', () => {
        if (editorEl.innerHTML === '<br>' || editorEl.innerHTML === '<p><br></p>') {
            // Keep placeholder crisp when completely cleared
            if (editorEl.textContent.replace(/\u200B/g, '').length === 0 && !editorEl.querySelector('hr, ul, ol, h1, h2, h3, h4, blockquote')) {
                editorEl.innerHTML = '';
                if (onChange) onChange();
                return;
            }
        }

        const sel = window.getSelection();
        if (sel && sel.rangeCount && sel.isCollapsed) {
            const range = sel.getRangeAt(0);
            if (editorEl.contains(range.startContainer)) {
                const blockEl = getMdDirectBlock(editorEl, range.startContainer);
                const isRootOrSimpleBlock = !blockEl || blockEl.tagName === 'P' || blockEl.tagName === 'DIV';
                if (isRootOrSimpleBlock) {
                    const preRange = document.createRange();
                    if (blockEl) {
                        preRange.setStart(blockEl, 0);
                    } else {
                        let scan = range.startContainer;
                        while (scan && scan.parentNode !== editorEl) scan = scan.parentNode;
                        while (scan && scan.previousSibling && scan.previousSibling.nodeName !== 'BR' && !/^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR)$/.test(scan.previousSibling.nodeName)) {
                            scan = scan.previousSibling;
                        }
                        if (scan && scan.parentNode === editorEl) preRange.setStartBefore(scan);
                        else preRange.setStart(editorEl, 0);
                    }
                    preRange.setEnd(range.startContainer, range.startOffset);
                    const prefix = preRange.toString().replace(/\u00A0/g, ' ').replace(/\u200B/g, '');
                    const blockTriggers = [
                        { regex: /^#### $/, tag: 'h4', len: 5 },
                        { regex: /^### $/, tag: 'h3', len: 4 },
                        { regex: /^## $/, tag: 'h2', len: 3 },
                        { regex: /^# $/, tag: 'h1', len: 2 },
                        { regex: /^> $/, tag: 'blockquote', len: 2 },
                        { regex: /^[-*] $/, tag: 'UL', len: 2 },
                        { regex: /^1\. $/, tag: 'OL', len: 3 },
                        { regex: /^--- $/, tag: 'HR', len: 4 }
                    ];
                    let triggered = false;
                    for (const trig of blockTriggers) {
                        if (trig.regex.test(prefix)) {
                            replaceBlockTag(editorEl, blockEl, trig.tag, trig.len, sel, range);
                            triggered = true;
                            break;
                        }
                    }
                    if (!triggered) {
                        tryApplyInlineMarkdownAtCaret(range, sel);
                    }
                } else {
                    tryApplyInlineMarkdownAtCaret(range, sel);
                }
            }
        }

        if (onChange) onChange();
    });

    editorEl.addEventListener('blur', () => {
        if (editorEl.textContent.replace(/\u200B/g, '').trim() === '' && !editorEl.querySelector('hr, img, ul, ol, h1, h2, h3, h4, blockquote')) {
            editorEl.innerHTML = '';
        }
        if (onChange) onChange();
    });
}
