import { deleteSelectedCards, openTrashModal } from './cardActions';
import { fetchAndRenderCards } from './cardRenderer';
import { deleteSelectedConnection } from './connections';
import { dbGet, dbPut } from './db';
import { t } from './i18n';
import { getAssetObjectUrl } from './mediaAndLinks';
import { pruneOrphanAssets } from './profileSettings';
import { BOARD_ICONS, S } from './state';
import { showToast } from './uiState';

export function syncSelectionVisuals() {
    const contentLayer = document.getElementById('canvas-content');
    contentLayer.querySelectorAll<HTMLElement>('.interactive-card').forEach(el => {
        const isBoardNode = el.classList.contains('board-node');
        const isDocNode = el.classList.contains('doc-node');
        const isImage = el.dataset.type === 'image';
        
        if (S.selectedCardIds.has(el.dataset.id)) {
            if (isBoardNode) el.classList.add('board-node-selected');
            else if (isDocNode) el.classList.add('doc-node-selected');
            else if (isImage) el.classList.add('image-selected');
            else el.classList.add('card-selected');
        } else {
            el.classList.remove('board-node-selected', 'doc-node-selected', 'image-selected', 'card-selected');
        }
    });

    // Alterna a Toolbar Esquerda se um subboard for selecionado
    const defaultToolbar = document.getElementById('default-toolbar');
    const contextToolbar = document.getElementById('contextual-toolbar');
    const connToolbar = document.getElementById('connection-toolbar');

    // Se tiver conexão selecionada, mostra a toolbar de conexão (mantendo a lixeira fixa embaixo)
    if (S.selectedConnectionId) {
        defaultToolbar.classList.add('hidden');
        contextToolbar.classList.add('hidden');
        contextToolbar.classList.remove('flex');
        connToolbar.classList.remove('hidden');
        connToolbar.classList.add('flex');
        
        // Sincroniza UI da Toolbar
        const conn = S.connections.find(c => c.id === S.selectedConnectionId);
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

    if (S.selectedCardIds.size === 1) {
        const selectedId = Array.from(S.selectedCardIds)[0];
        const card = S.cards.find(c => c.id === selectedId);
        if (card && card.type === 'subboard') {
            defaultToolbar.classList.add('hidden');
            contextToolbar.classList.remove('hidden');
            contextToolbar.classList.add('flex');
            
            // Atualiza o botão de ícone na toolbar
            const iconBtn = document.getElementById('btn-board-icon');
            if (iconBtn) {
                if (card.iconAssetId) {
                    iconBtn.innerHTML = '<div class="w-3 h-3 bg-zinc-600 rounded-sm"></div>';
                    getAssetObjectUrl(card.iconAssetId).then(url => {
                        if (url && S.selectedCardIds.has(card.id)) {
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
    defaultToolbar.classList.remove('hidden');
    contextToolbar.classList.add('hidden');
    contextToolbar.classList.remove('flex');
}

export async function setBoardColor(color) {
    const selectedId = Array.from(S.selectedCardIds)[0];
    const c = await dbGet('cards', selectedId);
    if (c) {
        c.color = color;
        await dbPut('cards', c);
        await fetchAndRenderCards();
    }
}

export function openIconPicker(e) {
    const popover = document.getElementById('icon-picker-popover');
    const grid = document.getElementById('icon-picker-grid');
    
    // Popula grid
    grid.innerHTML = BOARD_ICONS.slice(1).filter(Boolean).map((icon) => {
        return `<button onclick="setBoardIcon('${encodeURIComponent(icon)}')" class="w-full aspect-square rounded-md bg-[#2a2a2d] hover:bg-[#333338] border border-borderSubtle flex items-center justify-center text-zinc-400 hover:text-white transition-colors">${icon}</button>`;
    }).join('');
    
    // Posiciona respeitando limites da tela
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.min(rect.right + 10, Math.max(8, window.innerWidth - 248));
    const top = Math.min(rect.top, Math.max(8, window.innerHeight - 360));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.classList.remove('hidden');
}

export async function setBoardIcon(encodedIcon) {
    const selectedId = Array.from(S.selectedCardIds)[0];
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

export async function removeBoardIcon() {
    const selectedId = Array.from(S.selectedCardIds)[0];
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

export function triggerIconUpload() { document.getElementById('icon-file-input').click(); }

export async function promptIconUrl() {
    const url = prompt(t('promptIconUrl'));
    if (url) await setBoardIcon(encodeURIComponent(`<img src="${url}" class="w-8 h-8 object-contain" />`));
}

export async function handleIconFileInput(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const selectedId = Array.from(S.selectedCardIds)[0];
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

export function focusSelectedBoardTitle() {
    const selectedId = Array.from(S.selectedCardIds)[0];
    const el = document.querySelector<HTMLElement>(`.interactive-card[data-id="${selectedId}"]`);
    if (el) {
        const input = el.querySelector<HTMLElement>('.board-title-input');
        if (input) input.focus();
    }
}

export function handleGlobalTrashClick() {
    if (S.selectedConnectionId) {
        deleteSelectedConnection();
        return;
    }
    if (S.selectedCardIds.size === 1) {
        const selectedId = Array.from(S.selectedCardIds)[0];
        const card = S.cards.find(c => c.id === selectedId);
        if (card && card.type === 'subboard') {
            deleteSelectedCards();
            return;
        }
    }
    openTrashModal();
}

export function activateLineToolFromMenu() {
    const cm = document.getElementById('context-menu');
    if (cm) cm.style.display = 'none';
    setTool('line');
    showToast(t('lineToolHint'));
}

export function setTool(tool) {
    S.activeTool = tool;
    const selectBtn = document.getElementById('tool-select');
    const handBtn = document.getElementById('tool-hand');
    const lineBtn = document.getElementById('tool-line');
    const vp = document.getElementById('canvas-viewport');
    const activeCls = 'w-full py-1.5 rounded-lg bg-white/10 text-zinc-100 hover:bg-white/15 transition-all border border-white/10 flex flex-col items-center';
    const inactiveCls = 'w-full py-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-all border border-transparent flex flex-col items-center';

    if (selectBtn) selectBtn.className = tool === 'select' ? activeCls : inactiveCls;
    if (handBtn) handBtn.className = tool === 'hand' ? activeCls : inactiveCls;
    if (lineBtn) lineBtn.className = tool === 'line' ? activeCls : inactiveCls;

    document.body.classList.toggle('tool-line-active', tool === 'line');
    if (vp) {
        vp.style.cursor = tool === 'hand' ? 'grab' : tool === 'line' ? 'crosshair' : 'default';
    }
}
