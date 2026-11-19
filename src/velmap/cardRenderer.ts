import { setActiveEmbedCard, startCardDrag, startImageResize } from './canvasInteractions';
import { addExternalTextAsTasks, appendNewTask, focusTaskInput, importExternalCardsAsTasks, insertTaskAfter, moveTaskToCard, openDocumentModal, removeTaskAndFocusPrev, renderUnsortedDrawer, updateCardContent, updateCardTitle, updateTableBodyCell, updateTableHeaderCell, updateTaskText, updateTaskTextLive } from './cardActions';
import { attachConnectionDots, drawConnections } from './connections';
import { dbGetAll } from './db';
import { buildTaskDragGhostEl, queueFloatingPhysicsDrag } from './dragDrop';
import { openSubBoard } from './homeView';
import { t } from './i18n';
import { getAssetObjectUrl } from './mediaAndLinks';
import { getContrastTextColor, getInitials, normalizeHexColor } from './profileSettings';
import { S } from './state';
import { enterCardEditMode, escapeHtml } from './uiState';

export async function fetchAndRenderCards() {
    S.allSystemCards = await dbGetAll('cards');
    S.cards = S.allSystemCards.filter(c => c.boardId === S.currentBoardId && !c.isTrash);
    
    // Carrega conexões que pertencem a este board
    const allConns = await dbGetAll('connections');
    const cardIds = new Set(S.cards.map(c => c.id));
    S.connections = allConns.filter(c => cardIds.has(c.fromId) && cardIds.has(c.toId));

    if (S.searchQuery.trim() !== '') {
        const q = S.searchQuery.toLowerCase();
        S.cards = S.cards.filter(c => {
            if (c.title && c.title.toLowerCase().includes(q)) return true;
            if (c.content && c.content.toLowerCase().includes(q)) return true;
            if (c.authorName && c.authorName.toLowerCase().includes(q)) return true;
            if (c.tableData) {
                const headersMatch = Array.isArray(c.tableData.headers) && c.tableData.headers.some(h => String(h || '').toLowerCase().includes(q));
                const rowsMatch = Array.isArray(c.tableData.rows) && c.tableData.rows.some(r => Array.isArray(r) && r.some(cell => String(cell || '').toLowerCase().includes(q)));
                if (headersMatch || rowsMatch) return true;
            }
            return false;
        });
    }

    await renderCanvasCards();
    await renderUnsortedDrawer();
}

export async function renderCanvasCards() {
    const contentLayer = document.getElementById('canvas-content');
    const emptyPrompt = document.getElementById('empty-canvas-prompt');
    
    contentLayer.querySelectorAll('.interactive-card').forEach(el => el.remove());

    if (S.cards.length === 0) emptyPrompt.classList.remove('hidden');
    else emptyPrompt.classList.add('hidden');

    const orderedCards = S.cards.slice().sort((a, b) => {
        const za = typeof a.zIndex === 'number' ? a.zIndex : 10;
        const zb = typeof b.zIndex === 'number' ? b.zIndex : 10;
        if (za !== zb) return za - zb;
        return (a.createdAt || 0) - (b.createdAt || 0);
    });

    for (const card of orderedCards) {
        const isSelected = S.selectedCardIds.has(card.id);
        const cardZIndex = typeof card.zIndex === 'number' ? card.zIndex : 10;

        // --- FIRST-RUN PREFERENCES PRESENTATION CARD ---
        if (card.type === 'onboarding_prefs') {
            const cardEl = document.createElement('div');
            cardEl.className = `interactive-card milanote-card absolute rounded-[8px] flex flex-col pointer-events-auto group ${isSelected ? 'card-selected' : ''}`;
            cardEl.style.left = `${card.x}px`;
            cardEl.style.top = `${card.y}px`;
            cardEl.style.width = `${card.width || 320}px`;
            cardEl.dataset.id = card.id;
            cardEl.dataset.type = card.type;
            cardEl.style.zIndex = String(cardZIndex);

            cardEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand') return;
                if (e.target.closest('input, button, label, .connection-dot, .resize-handle')) return;
                startCardDrag(e, card.id);
            });

            const activeColor = normalizeHexColor(S.userProfile.color);
            const initials = getInitials(S.userProfile.name);
            const palette = ['#52525b', '#4f6b8a', '#4f8a5f', '#8a7d4f', '#8a4f4f', '#6b538c'];
            const isCustomActive = !palette.includes(activeColor);

            const swatchesHtml = palette.map(col => `
                <button type="button" onclick="setProfileColor('${col}')" data-color="${col}" class="onboard-color-swatch w-5 h-5 rounded-full border border-white/25 hover:scale-110 transition-transform ${activeColor === col ? 'ring-2 ring-white ring-offset-2 ring-offset-[#202024]' : ''}" style="background-color:${col}" title="${col}"></button>
            `).join('');

            cardEl.innerHTML = `
                <div class="h-9 px-3 flex items-center justify-between cursor-grab active:cursor-grabbing border-b border-white/[0.06] shrink-0">
                    <div class="flex items-center gap-2 min-w-0">
                        <svg class="w-3.5 h-3.5 text-zinc-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                        <span class="text-xs font-semibold text-zinc-100 truncate">${escapeHtml(t('onboardPrefsTitle'))}</span>
                    </div>
                    <span class="px-1.5 py-0.5 rounded text-[9.5px] font-medium uppercase tracking-wider bg-white/[0.06] text-zinc-400">${escapeHtml(t('onboardPrefsBadge'))}</span>
                </div>

                <div class="p-3.5 space-y-3.5 text-xs" onmousedown="event.stopPropagation()">
                    <!-- Live Avatar & Nickname -->
                    <div class="flex items-center gap-3">
                        <button type="button" onclick="triggerPfpUpload()" class="relative group/pfp w-11 h-11 rounded-full shrink-0 focus:outline-none" title="${escapeHtml(t('changePfpTitle'))}">
                            <div id="onboard-avatar-preview" class="w-11 h-11 rounded-full font-semibold text-xs flex items-center justify-center overflow-hidden transition-all" style="background-color:${activeColor}; color:${getContrastTextColor(activeColor)}; box-shadow: 0 0 0 2px #202024, 0 0 0 4px ${activeColor};">${S.userProfile.avatar ? `<img src="${S.userProfile.avatar}" class="w-full h-full object-cover rounded-full pointer-events-none" alt="">` : escapeHtml(initials)}</div>
                        </button>
                        <div class="flex-1 min-w-0">
                            <label for="onboard-name-input" class="block text-[10.5px] font-medium text-zinc-400 mb-1">${escapeHtml(t('onboardNickLabel'))}</label>
                            <input type="text" id="onboard-name-input" maxlength="40" value="${escapeHtml(S.userProfile.name)}" placeholder="${escapeHtml(t('yourNamePlaceholder'))}" oninput="setProfileName(this.value)" class="w-full bg-[#141416] text-xs text-zinc-100 px-2.5 py-1.5 rounded-lg border border-white/[0.08] focus:outline-none focus:border-white/30 placeholder-zinc-600">
                        </div>
                    </div>

                    <!-- Language Switch -->
                    <div class="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.05]">
                        <span class="text-[11px] font-medium text-zinc-400">${escapeHtml(t('onboardLangLabel'))}</span>
                        <div class="flex items-center bg-[#141416] border border-white/[0.08] rounded-lg p-0.5 shrink-0">
                            <button type="button" onclick="setLanguage('en')" class="px-2 py-1 rounded-md text-[10.5px] font-medium transition-colors ${S.currentLang === 'en' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-200'}">English</button>
                            <button type="button" onclick="setLanguage('pt-BR')" class="px-2 py-1 rounded-md text-[10.5px] font-medium transition-colors ${S.currentLang === 'pt-BR' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-200'}">PT-BR</button>
                        </div>
                    </div>

                    <!-- Profile Color Swatches -->
                    <div class="space-y-1.5 pt-1 border-t border-white/[0.05]">
                        <div class="flex items-center justify-between">
                            <span class="text-[11px] font-medium text-zinc-400">${escapeHtml(t('onboardProfileColorLabel'))}</span>
                            <span id="onboard-color-hex" class="text-[10px] font-mono text-zinc-500 uppercase">${escapeHtml(activeColor)}</span>
                        </div>
                        <div class="flex items-center justify-between gap-1.5" id="onboard-color-options">
                            ${swatchesHtml}
                            <label id="onboard-custom-color-label" class="relative w-5 h-5 rounded-full border border-white/30 overflow-hidden cursor-pointer hover:scale-110 transition-transform flex items-center justify-center ${isCustomActive ? 'ring-2 ring-white ring-offset-2 ring-offset-[#202024]' : ''}" style="background-color:${isCustomActive ? activeColor : '#27272a'}" title="Custom Color">
                                <input type="color" id="onboard-custom-color-input" value="${escapeHtml(activeColor)}" oninput="setProfileColor(this.value)" onchange="setProfileColor(this.value)" class="opacity-0 absolute inset-0 w-full h-full cursor-pointer">
                                <svg class="w-3 h-3 text-zinc-100 pointer-events-none drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </label>
                        </div>
                    </div>

                    <!-- Quick Workspace Toggles -->
                    <div class="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.05]">
                        <span class="text-[11px] font-medium text-zinc-400">${escapeHtml(t('onboardUnsortedDefaultLabel'))}</span>
                        <button type="button" id="onboard-unsorted-toggle" onclick="toggleSidebar(); syncOnboardingPrefsWidgets();" class="w-9 h-5 rounded-full transition-colors p-0.5 flex items-center ${S.isSidebarOpen ? 'bg-emerald-500/80 justify-end' : 'bg-white/10 justify-start'}">
                            <span class="w-4 h-4 rounded-full bg-white shadow-sm"></span>
                        </button>
                    </div>

                    <!-- Actions -->
                    <div class="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                        <button type="button" onclick="openSyncModal()" class="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.06] hover:bg-white/[0.11] text-zinc-200 border border-white/[0.08] transition-colors flex items-center justify-center gap-1.5">
                            <svg class="w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                            <span>${escapeHtml(t('onboardQuickSyncBtn'))}</span>
                        </button>
                        <button type="button" onclick="dismissOnboardingPrefsCard('${card.id}')" class="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-100 hover:bg-white text-zinc-900 transition-colors shrink-0">
                            ${escapeHtml(t('onboardHideCardBtn'))}
                        </button>
                    </div>
                </div>
            `;

            attachConnectionDots(cardEl, card.id);
            contentLayer.appendChild(cardEl);
            continue;
        }

        // --- SUB-BOARD (SQUIRCLE) ---
        if (card.type === 'subboard') {
            const childCount = S.allSystemCards.filter(c => c.boardId === card.id && !c.isTrash).length;
            const boardNode = document.createElement('div');
            boardNode.className = `interactive-card board-node absolute flex flex-col items-center pointer-events-auto select-none group ${isSelected ? 'board-node-selected' : ''}`;
            boardNode.style.left = `${card.x}px`;
            boardNode.style.top = `${card.y}px`;
            boardNode.style.width = '140px';
            boardNode.dataset.id = card.id;
            boardNode.dataset.type = card.type;
            boardNode.style.zIndex = String(cardZIndex);

            boardNode.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand') return;
                if (e.target.closest('.connection-dot, input, button')) return;
                if (boardNode.classList.contains('is-editing')) return;
                startCardDrag(e, card.id);
            });

            // Squircle principal
            const squircle = document.createElement('div');
            squircle.className = 'board-squircle board-squircle-gloss relative w-24 h-24 rounded-[26px] flex items-center justify-center cursor-grab active:cursor-grabbing';
            squircle.style.backgroundColor = card.color || '#78787a';
            squircle.ondblclick = (e) => { e.stopPropagation(); openSubBoard(card.id, card.title || t('newBoardTitle')); };
            
            // Ícone dentro do board (suporta Asset persistido no IndexedDB, URL externa ou SVG)
            if (card.iconAssetId) {
                const iconUrl = await getAssetObjectUrl(card.iconAssetId);
                if (iconUrl) {
                    const imgContainer = document.createElement('div');
                    imgContainer.className = 'absolute inset-0 rounded-[26px] overflow-hidden pointer-events-none';
                    imgContainer.innerHTML = `<img src="${iconUrl}" class="w-full h-full object-cover" />`;
                    squircle.appendChild(imgContainer);
                }
            } else if (card.icon) {
                if (card.icon.includes('<img')) {
                    const srcMatch = card.icon.match(/src="([^"]+)"/);
                    if (srcMatch && !srcMatch[1].startsWith('blob:')) {
                        const imgContainer = document.createElement('div');
                        imgContainer.className = 'absolute inset-0 rounded-[26px] overflow-hidden pointer-events-none';
                        imgContainer.innerHTML = `<img src="${srcMatch[1]}" class="w-full h-full object-cover" />`;
                        squircle.appendChild(imgContainer);
                    }
                } else {
                    // É um SVG, fica centralizado e com opacidade
                    const iconEl = document.createElement('div');
                    iconEl.className = 'absolute inset-0 flex items-center justify-center pointer-events-none opacity-40';
                    iconEl.innerHTML = card.icon;
                    squircle.appendChild(iconEl);
                }
            }

            attachConnectionDots(squircle, card.id);

            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.value = card.title || t('newBoardTitle');
            titleInput.className = 'board-title-input mt-6 px-2 py-1 rounded text-sm font-semibold text-zinc-200 bg-[#1c1c1f] text-center w-36 focus:outline-none transition-colors';
            titleInput.onmousedown = (e) => e.stopPropagation();
            titleInput.onchange = (e) => updateCardTitle(card.id, e.target.value);

            const countLabel = document.createElement('div');
            countLabel.className = 'text-xs text-zinc-400 mt-1 cursor-pointer hover:text-zinc-200';
            countLabel.textContent = `${childCount} ${childCount === 1 ? t('cardSingular') : t('cardPlural')}`;

            boardNode.appendChild(squircle);
            boardNode.appendChild(titleInput);
            boardNode.appendChild(countLabel);
            contentLayer.appendChild(boardNode);
            continue;
        }

        // --- IMAGE CARDS (FLAT) ---
        if (card.type === 'image') {
            const cardEl = document.createElement('div');
            cardEl.className = `interactive-card absolute pointer-events-auto group ${isSelected ? 'image-selected' : ''}`;
            cardEl.style.left = `${card.x}px`;
            cardEl.style.top = `${card.y}px`;
            cardEl.style.width = `${card.width || 270}px`;
            cardEl.style.height = 'auto';
            cardEl.dataset.id = card.id;
            cardEl.dataset.type = card.type;
            cardEl.style.zIndex = String(cardZIndex);

            cardEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand') return;
                if (e.target.closest('.connection-dot, .resize-handle')) return;
                startCardDrag(e, card.id);
            });

            const imgUrl = card.assetId ? await getAssetObjectUrl(card.assetId) : card.content;
            const imgContainer = document.createElement('div');
            imgContainer.className = 'relative w-full h-auto block';
            
            if (imgUrl) {
                const img = document.createElement('img');
                img.src = imgUrl;
                img.draggable = false;
                img.referrerPolicy = 'no-referrer';
                // Imagem sem fundo, sem arredondamento, proporção natural
                img.className = 'w-full h-auto object-contain select-none pointer-events-none block';
                imgContainer.appendChild(img);
            }

            // Alça de Redimensionamento (Canto Inferior Direito)
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-white drop-shadow-md"><path d="M21 15l-6 6M21 9l-12 12M21 3L3 21" /></svg>`;
            resizeHandle.onmousedown = (e) => startImageResize(e, card.id);
            resizeHandle.ontouchstart = (e) => startImageResize(e, card.id);
            imgContainer.appendChild(resizeHandle);

            attachConnectionDots(imgContainer, card.id);

            cardEl.appendChild(imgContainer);
            contentLayer.appendChild(cardEl);
            continue;
        }

        // --- VIDEO CARDS (WEB OR LOCAL) ---
        if (card.type === 'video') {
            const cardEl = document.createElement('div');
            cardEl.className = `interactive-card absolute bg-[#1c1c20] border border-white/[0.08] rounded-[6px] shadow-md flex flex-col pointer-events-auto group ${isSelected ? 'card-selected' : ''}`;
            cardEl.style.left = `${card.x}px`;
            cardEl.style.top = `${card.y}px`;
            cardEl.style.width = `${card.width || 320}px`;
            cardEl.style.height = 'auto';
            cardEl.dataset.id = card.id;
            cardEl.dataset.type = card.type;
            cardEl.style.zIndex = String(cardZIndex);

            cardEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand') return;
                if (e.target.closest('.connection-dot, .resize-handle, a, button, input')) return;
                if (e.target.tagName === 'VIDEO' && !e.target.closest('.video-drag-overlay')) return;
                setActiveEmbedCard(null);
                if (e.target.closest('.video-drag-overlay')) {
                    S.pendingMediaClick = { type: 'video', cardId: card.id, startX: e.clientX, startY: e.clientY };
                }
                startCardDrag(e, card.id);
            });

            const videoUrl = card.assetId ? await getAssetObjectUrl(card.assetId) : card.content;
            const extLinkHtml = (!card.assetId && card.content)
                ? `<a href="${escapeHtml(card.content)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="text-zinc-500 hover:text-zinc-200 p-1 rounded transition-colors shrink-0" title="${escapeHtml(t('openLink'))}"><svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>`
                : '';

            cardEl.innerHTML = `
                <div class="w-full flex flex-col overflow-hidden rounded-[6px]">
                    <div class="h-8 px-2.5 flex items-center justify-between gap-2 bg-[#1c1c20] border-b border-white/[0.06] cursor-grab active:cursor-grabbing">
                        <div class="flex items-center gap-1.5 min-w-0 flex-1">
                            <svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                            <input type="text" value="${escapeHtml(card.title || t('labelVideo'))}" placeholder="${escapeHtml(t('titlePlaceholder'))}" onchange="updateCardTitle('${card.id}', this.value)" onmousedown="event.stopPropagation()" class="bg-transparent text-[11px] font-medium text-zinc-200 focus:outline-none w-full truncate placeholder-zinc-500">
                        </div>
                        ${extLinkHtml}
                    </div>
                    <div class="w-full bg-black relative">
                        ${videoUrl
                            ? `<video src="${escapeHtml(videoUrl)}" controls playsinline preload="metadata" class="w-full h-auto max-h-[420px] block bg-black"></video>
                               <div class="video-drag-overlay absolute top-0 left-0 right-0 bottom-[42px] z-10 cursor-grab active:cursor-grabbing"></div>`
                            : `<div class="h-36 flex items-center justify-center text-xs text-zinc-500">${escapeHtml(t('noPreview'))}</div>`}
                    </div>
                </div>
            `;

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-white drop-shadow-md"><path d="M21 15l-6 6M21 9l-12 12M21 3L3 21" /></svg>`;
            resizeHandle.onmousedown = (e) => startImageResize(e, card.id);
            resizeHandle.ontouchstart = (e) => startImageResize(e, card.id);
            cardEl.appendChild(resizeHandle);

            attachConnectionDots(cardEl, card.id);

            contentLayer.appendChild(cardEl);
            continue;
        }

        // --- EMBED CARDS (YOUTUBE, VIMEO, IFRAME EMBED CODE) ---
        if (card.type === 'embed') {
            const cardEl = document.createElement('div');
            const isEmbedActive = S.activeEmbedCardId === card.id;
            cardEl.className = `interactive-card embed-card ${isEmbedActive ? 'embed-active' : ''} absolute bg-[#1c1c20] border border-white/[0.08] rounded-[6px] shadow-md flex flex-col pointer-events-auto group ${isSelected ? 'card-selected' : ''}`;
            cardEl.style.left = `${card.x}px`;
            cardEl.style.top = `${card.y}px`;
            cardEl.style.width = `${card.width || 340}px`;
            cardEl.style.height = `${card.height || 232}px`;
            cardEl.style.minHeight = `${card.height || 232}px`;
            cardEl.dataset.id = card.id;
            cardEl.dataset.type = card.type;
            cardEl.style.zIndex = String(cardZIndex);

            cardEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand') return;
                if (e.target.closest('.connection-dot, .resize-handle, a, button, input')) return;
                if (S.activeEmbedCardId && S.activeEmbedCardId !== card.id) setActiveEmbedCard(null);
                if (e.target.closest('.embed-drag-overlay')) {
                    S.pendingMediaClick = { type: 'embed', cardId: card.id, startX: e.clientX, startY: e.clientY };
                } else if (S.activeEmbedCardId === card.id) {
                    setActiveEmbedCard(null);
                }
                startCardDrag(e, card.id);
            });

            const safeSourceUrl = (card.content && card.content.startsWith('http')) ? card.content : '';
            const extLinkBtn = safeSourceUrl
                ? `<a href="${escapeHtml(safeSourceUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="text-zinc-500 hover:text-zinc-200 p-1 rounded transition-colors shrink-0" title="${escapeHtml(t('openLink'))}"><svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>`
                : '';

            cardEl.innerHTML = `
                <div class="w-full h-full flex flex-col overflow-hidden rounded-[6px]">
                    <div class="h-8 px-2.5 flex items-center justify-between gap-1.5 bg-[#1c1c20] border-b border-white/[0.06] cursor-grab active:cursor-grabbing shrink-0">
                        <div class="flex items-center gap-1.5 min-w-0 flex-1">
                            <svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                            <input type="text" value="${escapeHtml(card.title || card.domain || t('labelEmbed'))}" placeholder="${escapeHtml(t('titlePlaceholder'))}" onchange="updateCardTitle('${card.id}', this.value)" onmousedown="event.stopPropagation()" class="bg-transparent text-[11px] font-medium text-zinc-200 focus:outline-none w-full truncate placeholder-zinc-500">
                        </div>
                        <div class="flex items-center gap-0.5 shrink-0">
                            <button type="button" onclick="event.stopPropagation(); toggleEmbedInteract('${card.id}')" class="touch-visible ${isEmbedActive ? 'opacity-100 text-indigo-300 bg-indigo-500/20' : 'opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-200'} p-1 rounded transition-all" title="${escapeHtml(t('toggleEmbedInteract'))}">
                                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            </button>
                            <button type="button" onclick="event.stopPropagation(); editLinkUrl('${card.id}')" class="touch-visible opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-200 p-1 rounded transition-all" title="${escapeHtml(t('editEmbedOrUrl'))}">
                                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            ${extLinkBtn}
                        </div>
                    </div>
                    <div class="flex-1 w-full bg-black relative min-h-[140px]">
                        <iframe src="${escapeHtml(card.embedUrl || '')}" class="w-full h-full border-0 block" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>
                        <div class="embed-drag-overlay absolute inset-0 z-10 cursor-grab active:cursor-grabbing"></div>
                    </div>
                </div>
            `;

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-white drop-shadow-md"><path d="M21 15l-6 6M21 9l-12 12M21 3L3 21" /></svg>`;
            resizeHandle.onmousedown = (e) => startImageResize(e, card.id);
            resizeHandle.ontouchstart = (e) => startImageResize(e, card.id);
            cardEl.appendChild(resizeHandle);

            attachConnectionDots(cardEl, card.id);

            contentLayer.appendChild(cardEl);
            continue;
        }

        // --- DOCUMENT CARD ---
        if (card.type === 'document') {
            const cardEl = document.createElement('div');
            cardEl.className = `interactive-card doc-node absolute pointer-events-auto group flex flex-col items-center cursor-pointer select-none ${isSelected ? 'doc-node-selected' : ''}`;
            cardEl.style.left = `${card.x}px`;
            cardEl.style.top = `${card.y}px`;
            cardEl.style.width = '96px';
            cardEl.dataset.id = card.id;
            cardEl.dataset.type = card.type;
            cardEl.style.zIndex = String(cardZIndex);

            cardEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand') return;
                if (e.target.closest('.connection-dot')) return;
                startCardDrag(e, card.id);
            });

            cardEl.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                openDocumentModal(card.id);
            });

            const plainDocText = (card.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const wordCount = plainDocText ? plainDocText.split(' ').length : 0;

            cardEl.innerHTML = `
                <div class="doc-sheet-wrap relative inline-block">
                    <div class="doc-sheet w-[88px] h-[108px] rounded-[6px] bg-[#202024] flex flex-col p-2.5 shadow-lg relative overflow-hidden">
                        <div class="w-4 h-4 rounded-bl bg-white/[0.06] absolute top-0 right-0"></div>
                        <div class="text-[9px] font-semibold text-zinc-300 truncate pr-3 mb-1.5">${escapeHtml(card.title || t('newDocTitle'))}</div>
                        ${plainDocText
                            ? `<div class="text-[8.5px] leading-[1.35] text-zinc-500 line-clamp-4">${escapeHtml(plainDocText.slice(0, 120))}</div>`
                            : `<div class="space-y-1.5 mt-1"><div class="h-1 w-full rounded bg-white/[0.06]"></div><div class="h-1 w-4/5 rounded bg-white/[0.05]"></div><div class="h-1 w-3/5 rounded bg-white/[0.04]"></div></div>`}
                    </div>
                </div>
                <div class="doc-title-label mt-6 px-2 py-0.5 rounded text-xs font-semibold text-zinc-200 text-center w-36 truncate transition-colors">${escapeHtml(card.title || t('newDocTitle'))}</div>
                <div class="text-[10px] text-zinc-500 mt-0.5 whitespace-nowrap">${wordCount} ${wordCount === 1 ? t('wordSingular') : t('wordPlural')}</div>
            `;

            const docSheetWrap = cardEl.querySelector('.doc-sheet-wrap');
            attachConnectionDots(docSheetWrap || cardEl, card.id);

            contentLayer.appendChild(cardEl);
            continue;
        }

        // --- LINK CARDS (MILANOTE-STYLE RICH PREVIEW) ---
        if (card.type === 'link') {
            const cardEl = document.createElement('div');
            cardEl.className = `interactive-card absolute bg-[#212125] border border-white/[0.08] rounded-[6px] shadow-md flex flex-col pointer-events-auto group ${isSelected ? 'card-selected' : ''}`;
            cardEl.style.left = `${card.x}px`;
            cardEl.style.top = `${card.y}px`;
            cardEl.style.width = `${card.width || 270}px`;
            cardEl.style.minHeight = `${card.height || 170}px`;
            cardEl.dataset.id = card.id;
            cardEl.dataset.type = card.type;
            cardEl.style.zIndex = String(cardZIndex);

            let linkDownPos = null;
            cardEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand') return;
                if (e.target.closest('.connection-dot, .resize-handle, .link-open-btn, input, button')) return;
                if (e.target.closest('a')) {
                    linkDownPos = { x: e.clientX, y: e.clientY };
                } else {
                    linkDownPos = null;
                }
                startCardDrag(e, card.id);
            });

            if (!card.content) {
                cardEl.innerHTML = `
                    <div class="p-3 w-full h-full flex flex-col justify-center">
                        <div class="flex items-center space-x-2">
                            <svg class="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                            <input type="text" placeholder="${escapeHtml(t('pasteUrlPlaceholder'))}" class="bg-[#1c1c1f] text-xs text-zinc-200 p-2 rounded w-full focus:outline-none placeholder-zinc-600" onchange="updateLinkUrl('${card.id}', this.value)" onkeydown="if(event.key==='Enter') this.blur()">
                        </div>
                    </div>
                `;
            } else {
                const domain = card.domain || (() => { try { return new URL(card.content).hostname.replace(/^www\./, ''); } catch (_) { return 'website'; } })();
                const siteLabel = card.siteName || domain;
                const linkTitle = (card.title && card.title !== card.content) ? card.title : domain;
                const faviconUrl = card.logoUrl || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
                const safeDesc = card.description ? `<p class="text-[11px] text-zinc-400 leading-relaxed line-clamp-2 mt-1">${escapeHtml(card.description)}</p>` : '';

                let coverHtml = '';
                if (card.videoUrl) {
                    coverHtml = `
                        <div class="w-full bg-black relative overflow-hidden border-b border-white/[0.06] shrink-0">
                            <video src="${escapeHtml(card.videoUrl)}" ${card.imageUrl ? `poster="${escapeHtml(card.imageUrl)}"` : ''} controls muted playsinline preload="metadata" class="w-full max-h-[240px] object-cover block bg-black"></video>
                            <div class="video-drag-overlay absolute top-0 left-0 right-0 bottom-[40px] z-10 cursor-grab active:cursor-grabbing"></div>
                        </div>`;
                } else if (card.imageUrl) {
                    const videoBadge = card.isVideoLink
                        ? `<div class="absolute inset-0 flex items-center justify-center pointer-events-none"><div class="w-10 h-10 rounded-full bg-black/60 backdrop-blur-xs border border-white/25 flex items-center justify-center shadow-lg"><svg class="w-4 h-4 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg></div></div>`
                        : '';
                    coverHtml = `
                        <div class="w-full max-h-[240px] aspect-[16/10] bg-[#18181b] relative overflow-hidden border-b border-white/[0.06] shrink-0">
                            <img src="${escapeHtml(card.imageUrl)}" draggable="false" referrerpolicy="no-referrer" class="w-full h-full object-cover pointer-events-none block" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center bg-[#18181b]\\'><img src=\\'${escapeHtml(faviconUrl)}\\' draggable=\\'false\\' class=\\'w-10 h-10 rounded opacity-60 pointer-events-none\\'></div>'">
                            ${videoBadge}
                        </div>`;
                } else {
                    coverHtml = `
                        <div class="h-24 bg-[#18181b] flex items-center justify-center relative overflow-hidden border-b border-white/[0.06] shrink-0">
                            <img src="${escapeHtml(faviconUrl)}" draggable="false" class="w-10 h-10 rounded object-contain opacity-65 pointer-events-none" onerror="this.style.display='none'">
                        </div>`;
                }

                cardEl.innerHTML = `
                    <div class="w-full flex flex-col overflow-hidden rounded-[6px] h-full">
                        ${coverHtml}
                        <div class="p-3 flex-1 flex flex-col justify-between gap-2 relative bg-[#212125]">
                            <div class="min-w-0">
                                <a href="${escapeHtml(card.content)}" target="_blank" rel="noopener noreferrer" draggable="false" class="link-card-anchor text-[12.5px] font-semibold text-zinc-100 hover:text-white leading-snug line-clamp-2 block pointer-events-auto transition-colors cursor-grab active:cursor-grabbing">${escapeHtml(linkTitle)}</a>
                                ${safeDesc}
                            </div>
                            <div class="flex items-center justify-between gap-2 pt-1.5 border-t border-white/[0.05]">
                                <a href="${escapeHtml(card.content)}" target="_blank" rel="noopener noreferrer" draggable="false" class="link-card-anchor flex items-center gap-1.5 min-w-0 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors pointer-events-auto cursor-grab active:cursor-grabbing">
                                    <img src="${escapeHtml(faviconUrl)}" draggable="false" class="w-3.5 h-3.5 rounded-[2px] object-contain shrink-0 pointer-events-none" onerror="this.style.display='none'">
                                    <span class="truncate">${escapeHtml(siteLabel)}</span>
                                </a>
                                <div class="flex items-center gap-1 shrink-0">
                                    <button type="button" onclick="event.stopPropagation(); refreshLinkPreview('${card.id}')" class="touch-visible opacity-0 group-hover:opacity-100 bg-[#18181b] hover:bg-[#2a2a2d] border border-white/[0.08] rounded p-1 text-zinc-400 hover:text-zinc-200 transition-all" title="${escapeHtml(t('refreshPreview'))}">
                                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                                    </button>
                                    <button type="button" onclick="event.stopPropagation(); editLinkUrl('${card.id}')" class="touch-visible opacity-0 group-hover:opacity-100 bg-[#18181b] hover:bg-[#2a2a2d] border border-white/[0.08] rounded p-1 text-zinc-400 hover:text-zinc-200 transition-all" title="${escapeHtml(t('editEmbedOrUrl'))}">
                                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                    </button>
                                    <a href="${escapeHtml(card.content)}" target="_blank" rel="noopener noreferrer" draggable="false" onclick="event.stopPropagation()" class="link-open-btn text-zinc-500 hover:text-zinc-200 p-0.5 pointer-events-auto transition-colors" title="${escapeHtml(t('openLink'))}">
                                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                `;

                cardEl.querySelectorAll('a').forEach(aEl => {
                    aEl.addEventListener('dragstart', (ev) => ev.preventDefault());
                });
                cardEl.querySelectorAll('.link-card-anchor').forEach(aEl => {
                    aEl.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        if (linkDownPos && Math.hypot(ev.clientX - linkDownPos.x, ev.clientY - linkDownPos.y) >= 5) {
                            ev.preventDefault();
                        }
                        linkDownPos = null;
                    });
                });
            }

            // Alça de Redimensionamento e Conexão
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-white drop-shadow-md"><path d="M21 15l-6 6M21 9l-12 12M21 3L3 21" /></svg>`;
            resizeHandle.onmousedown = (e) => startImageResize(e, card.id);
            resizeHandle.ontouchstart = (e) => startImageResize(e, card.id);
            cardEl.appendChild(resizeHandle);

            attachConnectionDots(cardEl, card.id);

            contentLayer.appendChild(cardEl);
            continue;
        }

        // --- COMMENT CARD ---
        if (card.type === 'comment') {
            const cardEl = document.createElement('div');
            const accentColor = normalizeHexColor(card.authorColor || S.userProfile.color);
            const authorName = card.authorName || S.userProfile.name || 'Workspace';
            const isResolved = !!card.resolved;
            cardEl.className = `interactive-card milanote-card absolute rounded-[8px] flex flex-col pointer-events-auto group ${isResolved ? 'opacity-65' : ''} ${isSelected ? 'card-selected' : ''}`;
            cardEl.style.left = `${card.x}px`;
            cardEl.style.top = `${card.y}px`;
            cardEl.style.width = `${card.width || 256}px`;
            cardEl.style.minHeight = `${card.height || 132}px`;
            cardEl.style.borderLeft = `3px solid ${accentColor}`;
            cardEl.dataset.id = card.id;
            cardEl.dataset.type = card.type;
            cardEl.style.zIndex = String(cardZIndex);

            cardEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand') return;
                if (e.target.closest('input, textarea, button, .connection-dot, .resize-handle')) return;
                if (cardEl.classList.contains('is-editing')) return;
                startCardDrag(e, card.id);
            });
            cardEl.addEventListener('dblclick', (e) => {
                if (e.target.closest('button, .connection-dot, .resize-handle')) return;
                const ta = cardEl.querySelector('textarea');
                enterCardEditMode(cardEl, ta);
            });

            const timeStr = new Date(card.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            cardEl.innerHTML = `
                <div class="w-full h-full flex flex-col flex-1 overflow-hidden rounded-[8px]">
                    <div class="h-9 px-3 flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing border-b border-white/[0.05] bg-white/[0.02]">
                        <div class="flex items-center gap-2 min-w-0">
                            <div class="w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center shrink-0" style="background-color:${accentColor}; color:${getContrastTextColor(accentColor)}">${escapeHtml(getInitials(authorName))}</div>
                            <span class="text-xs font-semibold text-zinc-200 truncate">${escapeHtml(authorName)}</span>
                            <span class="text-[10px] text-zinc-500 shrink-0">${escapeHtml(timeStr)}</span>
                        </div>
                        <button type="button" onclick="event.stopPropagation(); toggleCommentResolved('${card.id}')" class="p-1 rounded-md transition-colors ${isResolved ? 'text-emerald-400 bg-emerald-500/15' : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06]'}" title="${escapeHtml(t('resolveComment'))}">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </button>
                    </div>
                    <div class="p-3 flex-1 flex flex-col">
                        <textarea placeholder="${escapeHtml(t('commentPlaceholder'))}" class="w-full flex-1 bg-transparent text-xs text-zinc-200 resize-none focus:outline-none min-h-[68px] leading-relaxed placeholder-zinc-600 pointer-events-none ${isResolved ? 'line-through text-zinc-400' : ''}">${escapeHtml(card.content || '')}</textarea>
                    </div>
                </div>
            `;
            const ta = cardEl.querySelector('textarea');
            ta.oninput = (e) => updateCardContent(card.id, e.target.value);

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-white drop-shadow-md"><path d="M21 15l-6 6M21 9l-12 12M21 3L3 21" /></svg>`;
            resizeHandle.onmousedown = (e) => startImageResize(e, card.id);
            resizeHandle.ontouchstart = (e) => startImageResize(e, card.id);
            cardEl.appendChild(resizeHandle);
            attachConnectionDots(cardEl, card.id);
            contentLayer.appendChild(cardEl);
            continue;
        }

        // --- TABLE CARD ---
        if (card.type === 'table') {
            const cardEl = document.createElement('div');
            cardEl.className = `interactive-card milanote-card absolute rounded-[6px] flex flex-col pointer-events-auto group ${isSelected ? 'card-selected' : ''}`;
            cardEl.style.left = `${card.x}px`;
            cardEl.style.top = `${card.y}px`;
            cardEl.style.width = `${card.width || 380}px`;
            cardEl.style.minHeight = `${card.height || 180}px`;
            cardEl.dataset.id = card.id;
            cardEl.dataset.type = card.type;
            cardEl.style.zIndex = String(cardZIndex);

            const tableData = (card.tableData && Array.isArray(card.tableData.headers) && Array.isArray(card.tableData.rows))
                ? card.tableData
                : {
                    headers: [`${t('tableColPrefix')} 1`, `${t('tableColPrefix')} 2`, `${t('tableColPrefix')} 3`],
                    rows: [['', '', ''], ['', '', '']]
                };

            cardEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand') return;
                if (e.target.closest('input:not(.pointer-events-none), textarea:not(.pointer-events-none), button, .connection-dot, .resize-handle')) return;
                if (cardEl.classList.contains('is-editing')) return;
                startCardDrag(e, card.id);
            });

            cardEl.addEventListener('dblclick', (e) => {
                if (e.target.closest('button, .connection-dot, .resize-handle')) return;
                const cellInp = e.target.closest('td, th')?.querySelector('.table-cell-input') || cardEl.querySelector('.table-cell-input');
                enterCardEditMode(cardEl, cellInp);
            });

            const headerRowHtml = tableData.headers.map((hVal, cIdx) => `
                <th class="border-b border-r last:border-r-0 border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-left min-w-[72px]">
                    <input type="text" value="${escapeHtml(hVal)}" data-col-idx="${cIdx}" class="table-cell-input table-header-input bg-transparent text-[11px] font-semibold text-zinc-200 focus:outline-none w-full pointer-events-none placeholder-zinc-600" placeholder="${escapeHtml(t('tableColPrefix'))} ${cIdx + 1}">
                </th>
            `).join('');

            const bodyRowsHtml = tableData.rows.map((row, rIdx) => `
                <tr class="border-b last:border-b-0 border-white/[0.06]">
                    ${tableData.headers.map((_, cIdx) => `
                        <td class="border-r last:border-r-0 border-white/[0.06] px-2 py-1.5 min-w-[72px]">
                            <input type="text" value="${escapeHtml((row && row[cIdx]) || '')}" data-row-idx="${rIdx}" data-col-idx="${cIdx}" class="table-cell-input table-body-input bg-transparent text-xs text-zinc-300 focus:outline-none w-full pointer-events-none placeholder-zinc-600" placeholder="...">
                        </td>
                    `).join('')}
                </tr>
            `).join('');

            cardEl.innerHTML = `
                <div class="h-9 px-3 flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing border-b border-white/[0.05]">
                    <div class="flex items-center space-x-2 overflow-hidden flex-1 pr-1">
                        <svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
                        <input type="text" value="${escapeHtml(card.title || t('labelTable'))}" placeholder="${escapeHtml(t('titlePlaceholder'))}" onchange="updateCardTitle('${card.id}', this.value)" onmousedown="event.stopPropagation()" class="bg-transparent text-xs font-semibold text-zinc-200 focus:outline-none w-full placeholder-zinc-500">
                    </div>
                    <div class="touch-visible opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 transition-opacity">
                        <button type="button" onclick="event.stopPropagation(); modifyCardTable('${card.id}', 'addRow')" class="px-1.5 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.12] text-[10px] text-zinc-300 transition-colors">${escapeHtml(t('addRowBtn'))}</button>
                        <button type="button" onclick="event.stopPropagation(); modifyCardTable('${card.id}', 'addCol')" class="px-1.5 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.12] text-[10px] text-zinc-300 transition-colors">${escapeHtml(t('addColBtn'))}</button>
                        ${tableData.rows.length > 1 ? `<button type="button" onclick="event.stopPropagation(); modifyCardTable('${card.id}', 'removeRow')" class="px-1 py-0.5 rounded bg-white/[0.04] hover:bg-red-500/20 text-[10px] text-zinc-400 hover:text-red-300 transition-colors" title="${escapeHtml(t('removeRowTitle'))}">-R</button>` : ''}
                        ${tableData.headers.length > 1 ? `<button type="button" onclick="event.stopPropagation(); modifyCardTable('${card.id}', 'removeCol')" class="px-1 py-0.5 rounded bg-white/[0.04] hover:bg-red-500/20 text-[10px] text-zinc-400 hover:text-red-300 transition-colors" title="${escapeHtml(t('removeColTitle'))}">-C</button>` : ''}
                    </div>
                </div>
                <div class="p-2.5 flex-1 overflow-x-auto">
                    <table class="w-full border-collapse border border-white/[0.08] rounded overflow-hidden">
                        <thead><tr>${headerRowHtml}</tr></thead>
                        <tbody>${bodyRowsHtml}</tbody>
                    </table>
                </div>
            `;

            cardEl.querySelectorAll('.table-header-input').forEach(inp => {
                inp.addEventListener('change', (e) => updateTableHeaderCell(card.id, Number(inp.dataset.colIdx), e.target.value));
            });
            cardEl.querySelectorAll('.table-body-input').forEach(inp => {
                inp.addEventListener('change', (e) => updateTableBodyCell(card.id, Number(inp.dataset.rowIdx), Number(inp.dataset.colIdx), e.target.value));
            });

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-white drop-shadow-md"><path d="M21 15l-6 6M21 9l-12 12M21 3L3 21" /></svg>`;
            resizeHandle.onmousedown = (e) => startImageResize(e, card.id);
            resizeHandle.ontouchstart = (e) => startImageResize(e, card.id);
            cardEl.appendChild(resizeHandle);
            attachConnectionDots(cardEl, card.id);
            contentLayer.appendChild(cardEl);
            continue;
        }

        // --- OUTROS CARDS ---
        const cardEl = document.createElement('div');
        cardEl.className = `interactive-card milanote-card absolute rounded-[6px] flex flex-col pointer-events-auto group ${isSelected ? 'card-selected' : ''}`;
        cardEl.style.left = `${card.x}px`;
        cardEl.style.top = `${card.y}px`;
        cardEl.style.width = `${card.width || 270}px`;
        cardEl.style.minHeight = `${card.height || 170}px`;
        cardEl.dataset.id = card.id;
        cardEl.dataset.type = card.type;
        cardEl.style.zIndex = String(cardZIndex);

        cardEl.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || S.isSpacePressed || S.activeTool === 'hand') return;
            // Se clicou em inputs/botões, ou card em edição, não arrasta o card
            if (e.target.closest('input, textarea, button, .connection-dot, .resize-handle, .task-drag-handle')) return;
            if (cardEl.classList.contains('is-editing')) return;
            startCardDrag(e, card.id);
        });

        // Duplo clique para entrar em modo de edição
        cardEl.addEventListener('dblclick', (e) => {
            if (e.target.closest('.connection-dot, .resize-handle, button, input[type="checkbox"], .task-drag-handle')) return;
            const taskRow = e.target.closest('.task-row');
            if (taskRow) {
                const taskInp = taskRow.querySelector('.task-input');
                if (taskInp) {
                    enterCardEditMode(cardEl, taskInp);
                    return;
                }
            }
            if (card.type === 'task') {
                const addInp = cardEl.querySelector('.add-task-input');
                if (addInp) {
                    enterCardEditMode(cardEl, addInp);
                    return;
                }
            }
            const directTarget = e.target.closest?.('textarea, input[type="text"]');
            const fallbackTarget = cardEl.querySelector('textarea') || cardEl.querySelector('input[type="text"]');
            enterCardEditMode(cardEl, directTarget || fallbackTarget);
        });

        const header = document.createElement('div');
        header.className = 'h-9 px-3 flex items-center justify-between cursor-grab active:cursor-grabbing border-b border-white/[0.04]';
        
        let iconSvg = '';
        if (card.type === 'sticky') iconSvg = '<svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
        else if (card.type === 'task') iconSvg = '<svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>';
        else if (card.type === 'link') iconSvg = '<svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
        else if (card.type === 'column') iconSvg = '<svg class="w-3.5 h-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>';
        
        header.innerHTML = `
            <div class="flex items-center space-x-2 overflow-hidden flex-1 pr-1">
                ${iconSvg}
                <input type="text" value="${escapeHtml(card.title)}" placeholder="${t('titlePlaceholder')}" onchange="updateCardTitle('${card.id}', this.value)" onmousedown="event.stopPropagation()" class="bg-transparent text-xs font-semibold text-zinc-200 focus:outline-none w-full placeholder-zinc-500">
            </div>
        `;
        if (card.type === 'task') {
            const titleInp = header.querySelector('input');
            titleInp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    updateCardTitle(card.id, titleInp.value);
                    if (card.tasks && card.tasks.length > 0) focusTaskInput(card.id, 0);
                    else {
                        const addInp = cardEl.querySelector('.add-task-input');
                        if (addInp) addInp.focus();
                    }
                }
            });
        }
        cardEl.appendChild(header);

        const body = document.createElement('div');
        body.className = 'p-3 flex-1 flex flex-col space-y-2';

        if (card.type === 'sticky') {
            const textarea = document.createElement('textarea');
            textarea.className = 'w-full flex-1 bg-transparent text-xs text-zinc-300 resize-none focus:outline-none min-h-[112px] leading-relaxed placeholder-zinc-600 pointer-events-none';
            textarea.placeholder = t('startTyping');
            textarea.value = card.content || '';
            textarea.oninput = (e) => updateCardContent(card.id, e.target.value);
            body.appendChild(textarea);
        } else if (card.type === 'column') {
            const colTextarea = document.createElement('textarea');
            colTextarea.className = 'w-full flex-1 bg-white/[0.015] rounded border border-dashed border-white/[0.06] p-2.5 text-xs text-zinc-300 resize-none focus:outline-none min-h-[112px] leading-relaxed placeholder-zinc-600 pointer-events-none';
            colTextarea.placeholder = t('columnNotesPlaceholder');
            colTextarea.value = card.content || '';
            colTextarea.oninput = (e) => updateCardContent(card.id, e.target.value);
            body.appendChild(colTextarea);
        } else if (card.type === 'task') {
            const taskListContainer = document.createElement('div');
            taskListContainer.className = 'space-y-1.5 flex-1';

            // Suporte a drag-and-drop de tasks entre cards ou vindas de fora para dentro deste card
            cardEl.addEventListener('dragover', (e) => {
                const hasTaskPayload = S.draggedTaskPayload || e.dataTransfer.types.includes('application/x-milanote-task');
                const hasInternal = S.internalDragPayload && (S.internalDragPayload.source === 'unsorted' || S.internalDragPayload.source === 'canvas');
                const hasPlainText = e.dataTransfer.types.includes('text/plain') && !S.internalDragPayload;
                if (hasTaskPayload || hasInternal || hasPlainText) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    cardEl.classList.add('ring-1', 'ring-zinc-400');
                }
            });
            cardEl.addEventListener('dragleave', (e) => {
                if (!cardEl.contains(e.relatedTarget)) {
                    cardEl.classList.remove('ring-1', 'ring-zinc-400');
                }
            });
            cardEl.addEventListener('drop', async (e) => {
                cardEl.classList.remove('ring-1', 'ring-zinc-400');
                const taskStr = e.dataTransfer.getData('application/x-milanote-task');
                const taskPayload = taskStr ? JSON.parse(taskStr) : S.draggedTaskPayload;
                if (taskPayload) {
                    e.preventDefault();
                    e.stopPropagation();
                    await moveTaskToCard(taskPayload.cardId, taskPayload.taskIdx, card.id, null);
                    return;
                }
                if (S.internalDragPayload && S.internalDragPayload.source === 'unsorted') {
                    e.preventDefault();
                    e.stopPropagation();
                    await importExternalCardsAsTasks(S.internalDragPayload.cardIds, card.id, null);
                    return;
                }
                if (!S.internalDragPayload) {
                    const plainText = e.dataTransfer.getData('text/plain');
                    if (plainText && plainText.trim()) {
                        e.preventDefault();
                        e.stopPropagation();
                        await addExternalTextAsTasks(card.id, plainText, null);
                    }
                }
            });

            (card.tasks || []).forEach((task, tIdx) => {
                const taskRow = document.createElement('div');
                taskRow.className = 'task-row flex items-center space-x-2 group/task rounded px-0.5 transition-colors';
                taskRow.dataset.taskIndex = tIdx;
                taskRow.ondragover = (e) => {
                    const hasTaskPayload = S.draggedTaskPayload || e.dataTransfer.types.includes('application/x-milanote-task');
                    const hasInternal = S.internalDragPayload && S.internalDragPayload.source === 'unsorted';
                    const hasPlainText = e.dataTransfer.types.includes('text/plain') && !S.internalDragPayload;
                    if (hasTaskPayload || hasInternal || hasPlainText) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        taskRow.classList.add('border-t-2', 'border-zinc-300');
                    }
                };
                taskRow.ondragleave = () => {
                    taskRow.classList.remove('border-t-2', 'border-zinc-300');
                };
                taskRow.ondrop = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    taskRow.classList.remove('border-t-2', 'border-zinc-300');
                    cardEl.classList.remove('ring-1', 'ring-zinc-400');

                    const taskStr = e.dataTransfer.getData('application/x-milanote-task');
                    const taskPayload = taskStr ? JSON.parse(taskStr) : S.draggedTaskPayload;
                    if (taskPayload) {
                        await moveTaskToCard(taskPayload.cardId, taskPayload.taskIdx, card.id, tIdx);
                        return;
                    }
                    if (S.internalDragPayload && S.internalDragPayload.source === 'unsorted') {
                        await importExternalCardsAsTasks(S.internalDragPayload.cardIds, card.id, tIdx);
                        return;
                    }
                    if (!S.internalDragPayload) {
                        const plainText = e.dataTransfer.getData('text/plain');
                        if (plainText && plainText.trim()) {
                            await addExternalTextAsTasks(card.id, plainText, tIdx);
                        }
                    }
                };
                taskRow.innerHTML = `
                  <div class="relative flex items-center justify-center w-3.5 h-3.5 shrink-0">
                      <input type="checkbox" ${task.completed ? 'checked' : ''} onchange="toggleTask('${card.id}', ${tIdx})" class="peer appearance-none w-3.5 h-3.5 border border-zinc-500 rounded-[2px] bg-transparent checked:bg-zinc-400 checked:border-zinc-400 cursor-pointer transition-colors focus:outline-none m-0">
                      <svg class="absolute w-2.5 h-2.5 text-[#141416] pointer-events-none hidden peer-checked:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                  <input type="text" value="${escapeHtml(task.text)}" placeholder="${t('taskPlaceholder')}" class="bg-transparent text-xs ${task.completed ? 'line-through text-zinc-500' : 'text-zinc-300'} focus:outline-none w-full pointer-events-none task-input placeholder-zinc-600">
                  
                  <!-- Ícone de Reordenar -->
                  <div class="task-drag-handle touch-visible cursor-grab text-zinc-600 hover:text-zinc-300 opacity-0 group-hover/task:opacity-100 transition-opacity p-1 flex items-center justify-center">
                        <svg class="w-3.5 h-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>
                  </div>
                `;

                const taskDragHandle = taskRow.querySelector('.task-drag-handle');
                if (taskDragHandle) {
                    const beginTaskPress = (ev, isTouch) => {
                        ev.stopPropagation();
                        if (!isTouch && ev.button !== 0) return;
                        const pt = isTouch ? ev.touches[0] : ev;
                        const rowRect = taskRow.getBoundingClientRect();
                        queueFloatingPhysicsDrag({
                            source: 'task',
                            payload: {
                                cardId: card.id,
                                taskIdx: tIdx,
                                taskText: task.text || t('taskDefault')
                            },
                            startX: pt.clientX,
                            startY: pt.clientY,
                            grabX: Math.max(18, Math.min(rowRect.width - 18, pt.clientX - rowRect.left)),
                            grabY: Math.max(12, Math.min(rowRect.height - 6, pt.clientY - rowRect.top)),
                            isTouch,
                            createPreview: () => buildTaskDragGhostEl(task.text || t('taskDefault'), Math.max(190, Math.min(260, rowRect.width))),
                            sourceEls: [taskRow]
                        });
                    };
                    taskDragHandle.addEventListener('mousedown', (ev) => beginTaskPress(ev, false));
                    taskDragHandle.addEventListener('touchstart', (ev) => {
                        if (ev.touches.length === 1) beginTaskPress(ev, true);
                    }, { passive: true });
                }

                const taskInput = taskRow.querySelector('.task-input');
                taskInput.addEventListener('input', (e) => {
                    updateTaskTextLive(card.id, tIdx, e.target.value);
                });
                taskInput.addEventListener('change', (e) => {
                    updateTaskText(card.id, tIdx, e.target.value);
                });
                taskInput.addEventListener('keydown', async (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        await insertTaskAfter(card.id, tIdx, taskInput.value);
                    } else if (e.key === 'Backspace' && taskInput.value === '') {
                        e.preventDefault();
                        e.stopPropagation();
                        await removeTaskAndFocusPrev(card.id, tIdx);
                    } else if (e.key === 'ArrowUp' && tIdx > 0) {
                        e.preventDefault();
                        focusTaskInput(card.id, tIdx - 1);
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (tIdx < (card.tasks || []).length - 1) focusTaskInput(card.id, tIdx + 1);
                        else {
                            const addInp = cardEl.querySelector('.add-task-input');
                            if (addInp) addInp.focus();
                        }
                    }
                });

                taskListContainer.appendChild(taskRow);
            });

            // Input inline estilo Milanote para adicionar novas tasks dinamicamente
            const addTaskRow = document.createElement('div');
            addTaskRow.className = 'flex items-center space-x-2 pt-1 opacity-70 focus-within:opacity-100 hover:opacity-100 transition-opacity';
            addTaskRow.innerHTML = `
                <svg class="w-3.5 h-3.5 text-zinc-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <input type="text" placeholder="${t('addTaskPlaceholder')}" onmousedown="event.stopPropagation()" class="add-task-input bg-transparent text-xs text-zinc-300 placeholder-zinc-500 focus:outline-none w-full">
            `;
            const addInput = addTaskRow.querySelector('.add-task-input');
            addInput.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    const text = addInput.value.trim();
                    if (text !== '') {
                        await appendNewTask(card.id, text, true);
                    }
                } else if (e.key === 'ArrowUp' && (card.tasks || []).length > 0) {
                    e.preventDefault();
                    focusTaskInput(card.id, card.tasks.length - 1);
                }
            });
            taskListContainer.appendChild(addTaskRow);

            body.appendChild(taskListContainer);
        }

        // Alça de Redimensionamento para TODOS os cards
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        resizeHandle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-white drop-shadow-md"><path d="M21 15l-6 6M21 9l-12 12M21 3L3 21" /></svg>`;
        resizeHandle.onmousedown = (e) => startImageResize(e, card.id);
        resizeHandle.ontouchstart = (e) => startImageResize(e, card.id);
        cardEl.appendChild(resizeHandle);

        // Bolinha de Conexão para TODOS os cards
        attachConnectionDots(cardEl, card.id);

        cardEl.appendChild(body);
        contentLayer.appendChild(cardEl);
    }

    // Desenha as linhas depois de renderizar os cards
    drawConnections();
}
