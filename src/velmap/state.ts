import { LANG_STORAGE_KEY } from './i18n';
import { loadSoundsEnabled } from './sound';

export const DB_NAME = 'MilanoteExcalidrawDB';

export const DB_VERSION = 4;

export const blobUrlCache = new Map();

export const MAX_UNDO_HISTORY = 40;

export const VELMAP_CLIPBOARD_PREFIX = 'VELMAP_CLIPBOARD_V1:';

export const BOARD_BG_PRESETS = [
    { id: 'obsidian', color: '#131316', pattern: 'dots', label: 'Obsidian' },
    { id: 'charcoal', color: '#1b1a18', pattern: 'dots', label: 'Warm Charcoal' },
    { id: 'slate', color: '#111622', pattern: 'dots', label: 'Midnight Slate' },
    { id: 'forest', color: '#101915', pattern: 'dots', label: 'Deep Pine' },
    { id: 'plum', color: '#19131f', pattern: 'dots', label: 'Dusk Plum' },
    { id: 'steel', color: '#1d2026', pattern: 'grid', label: 'Cool Steel' }
];

export const UI_STATE_STORAGE_KEY = 'velmap_ui_state';

export const SOUNDS_STORAGE_KEY = 'velmap_sounds_enabled_v1';

export const ONBOARDING_STORAGE_KEY = 'velmap_onboarded_v1';

export const BOARD_ICONS = [
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

export const PROFILE_STORAGE_KEY = 'velmap_user_profile';

export const LEGACY_PROFILE_KEY = 'velnote_user_profile';

export const TOMBSTONE_STORAGE_KEY = 'velmap_sync_tombstones';

export const DEVICE_IDENTITY_KEY = 'velmap_device_identity';

export const PAIRED_DEVICES_KEY = 'velmap_paired_devices';

export const REVOKED_DEVICES_KEY = 'velmap_revoked_devices';

export const incomingChunkBuffers = new Map();

export const roomLastSeq = new Map();

export const onlinePeersByRoom = new Map();

export const pendingOfferByRoom = new Map();

export const S: Record<string, any> = {
  currentLang: localStorage.getItem(LANG_STORAGE_KEY) || 'en',
  db: null,
  currentBoardId: 'root',
  breadcrumbs: [{ id: 'root', title: 'Home' }],
  activeTool: 'select',
  isSpacePressed: false,
  canvasScale: 1,
  canvasPanX: 0,
  canvasPanY: 0,
  isPanning: false,
  startPanX: 0,
  startPanY: 0,
  isMarqueeSelecting: false,
  marqueeStartX: 0,
  marqueeStartY: 0,
  cards: [],
  allSystemCards: [],
  connections: [],
  selectedCardIds: new Set(),
  selectedUnsortedCardIds: new Set(),
  searchQuery: '',
  isSidebarOpen: window.innerWidth >= 768,
  isDraggingCards: false,
  pendingCardDrag: null,
  dragStartMouseX: 0,
  dragStartMouseY: 0,
  initialCardPositions: new Map(),
  pendingMediaClick: null,
  activeEmbedCardId: null,
  dragLastClientX: 0,
  dragVelocityX: 0,
  dragCurrentTilt: 0,
  dragCurrentScale: 1.015,
  isDragOverInteractiveArea: false,
  areDraggedCardsElevated: false,
  dragPhysicsRaf: null,
  floatingDragState: null,
  pendingFloatingDrag: null,
  suppressNextToolClick: false,
  internalDragPayload: null,
  draggedTaskPayload: null,
  externalImageUrl: null,
  undoStack: [],
  redoStack: [],
  isApplyingHistory: false,
  pendingDragUndoSnapshot: null,
  pendingResizeUndoSnapshot: null,
  pendingControlUndoSnapshot: null,
  velmapClipboard: null,
  lastMouseClientX: null,
  lastMouseClientY: null,
  lastPasteCursorKey: null,
  lastPasteSameSpotCount: 0,
  editingCardId: null,
  pendingArrowUndoSnapshot: null,
  arrowNudgeTimer: null,
  arrowMovedCardIds: new Set(),
  isDrawingConnection: false,
  connectionSourceId: null,
  connectionFromAnchor: null,
  tempConnectionLine: null,
  tempConnectionSnapDot: null,
  isReconnectingEndpoint: false,
  reconnectConnId: null,
  reconnectSide: null,
  selectedConnectionId: null,
  isDraggingControlPoint: false,
  dragControlConnId: null,
  initialDxMid: 0,
  initialDyMid: 0,
  isResizingImage: false,
  resizeCardId: null,
  resizeStartW: 0,
  resizeStartH: 0,
  resizeStartX: 0,
  resizeStartY: 0,
  isHomeViewOpen: false,
  hasExplicitSidebarPref: false,
  uiViewports: {},
  uiStateSaveTimer: null,
  soundsEnabled: loadSoundsEnabled(),
  cozyAudioCtx: null,
  toastTimeout: undefined,
  activeDocId: null,
  userProfile: { name: 'Workspace', color: '#4f6b8a', avatar: null, updatedAt: 0 },
  pendingClearAction: null,
  pfpCropState: {
            img: null,
            zoom: 1,
            minScale: 1,
            offsetX: 0,
            offsetY: 0,
            isDragging: false,
            startX: 0,
            startY: 0
        },
  localDevice: { deviceId: '', deviceName: '', platform: 'desktop', isPrimary: false },
  pairedDevices: [],
  revokedDevices: {},
  p2pPeer: null,
  p2pChannel: null,
  p2pConnected: false,
  activeRemoteDeviceId: null,
  activeP2PRoomId: null,
  activePairingRoomId: null,
  activePairingCode: null,
  syncPushTimer: null,
  isApplyingRemoteSync: false,
  linkedSyncFileHandle: null,
  qrScannerStream: null,
  qrScannerRaf: null,
  syncBroadcast: null,
  syncPollTimer: null,
  isPollingSignals: false,
  serverRelayAvailable: true,
};

if (S.currentLang !== 'en' && S.currentLang !== 'pt-BR') S.currentLang = 'en';
