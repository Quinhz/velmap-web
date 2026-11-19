import { setupCanvasInteractions } from './canvasInteractions';
import { closeDocumentModal, saveDocument, setupSearch, updateDocWordCount } from './cardActions';
import { setupContextMenu } from './contextMenu';
import { dbGet, dbGetAll, dbPut, initDB } from './db';
import { finishFloatingPhysicsDrag, handleFloatingTouchEnd, setupClipboardAndDragDrop, setupTrashInteractions, setupUnsortedDropInteractions, startFloatingPhysicsDrag, updateFloatingPhysicsDragPosition } from './dragDrop';
import { setupKeyboardShortcuts } from './history';
import { loadBoard, openHomeView } from './homeView';
import { applyTranslations, t } from './i18n';
import { loadUserProfile, renderPfpCropCanvas } from './profileSettings';
import { syncSoundsUI } from './sound';
import { ONBOARDING_STORAGE_KEY, S, SOUNDS_STORAGE_KEY } from './state';
import { initDeviceSyncSubsystem } from './sync';
import { handleIconFileInput, setTool } from './toolbar';
import { applySidebarDomState, centerCanvasInitial, enterCardEditMode, exitCardEditMode, loadUIState, saveUIState, seedFirstRunExperience, showToast, syncFaviconLogos } from './uiState';
import { applyZoomAroundCenter, clearSelection, resetZoom, setActiveEmbedCard, startCardDrag, startDragPhysics, startImageResize, stopDragPhysics, toggleEmbedInteract, updateCanvasTransform, zoomIn, zoomOut } from './canvasInteractions';
import { addExternalTextAsTasks, appendNewTask, closeTrashModal, convertSelectedToDocument, convertToDocument, deleteCard, deleteSelectedCards, editLinkUrl, emptyTrash, focusTaskInput, handleFileInput, importExternalCardsAsTasks, insertTaskAfter, modifyCardTable, moveSelectedToUnsorted, moveTaskToCard, moveToUnsorted, moveUnsortedCardToCanvas, openDocumentModal, openTrashModal, permanentDelete, promptDocLink, quickCaptureSubmit, removeTaskAndFocusPrev, renderTrashList, renderUnsortedDrawer, reorderTask, restoreCard, syncUnsortedSelectionVisuals, toggleCommentResolved, toggleSidebar, toggleTask, triggerImageUpload, updateCardContent, updateCardTitle, updateLinkUrl, updateTableBodyCell, updateTableHeaderCell, updateTaskText, updateTaskTextLive, updateTrashBadge } from './cardActions';
import { fetchAndRenderCards, renderCanvasCards } from './cardRenderer';
import { attachConnectionDots, buildConnectionGeometry, clampAnchorT, clearConnectionSelection, cycleConnWeight, deleteSelectedConnection, drawConnections, getAnchorFromCanvasPoint, getBestAutoAnchors, getCardConnectionBounds, getEventPoint, promptConnLabel, resolveAnchorPoint, setConnColor, startConnectionDraw, toggleConnectionDashed, toggleEndMarker, toggleStartMarker } from './connections';
import { bringSelectedToFront, bringToFront, getNextTopZIndex, openContextMenuAt, openSelectedBoardMoreMenu, openSubBoardById, reorderCardLayer, selectAllCards, sendSelectedToBack, sendToBack } from './contextMenu';
import { dbDelete } from './db';
import { bringCardsToFrontOnDragStart, buildTaskDragGhostEl, buildToolDragGhostEl, buildTrashDragGhostEl, buildUnsortedDragGhostEl, cancelFloatingPhysicsDrag, clearDropTargetHighlights, clearTaskDropHighlights, clearTrashHoverHighlight, flashBreadcrumbDropTab, getHoveredBoardNode, getHoveredBreadcrumbTab, getHoveredTaskCard, getHoveredTaskRowInfo, getHoveredTrashBtn, getHoveredUnsortedTarget, getToolPreviewDimensions, moveCardsToBoard, playBoardPoofEffect, queueFloatingPhysicsDrag, setDraggedCardsElevated, syncCanvasDragOverlayTransform, updateCanvasCardDragElevationAndFeedback, updateTrashHoverHighlight } from './dragDrop';
import { applyBoardBackground, applyWorkspaceSnapshot, buildClipboardPayloadForSelection, captureWorkspaceSnapshot, cloneCardsAndConnectionsToBoard, closeBoardBgPopover, copySelectedCards, cutSelectedCards, duplicateSelectedCards, flushArrowNudgeCommit, openBoardBgPopover, pasteVelmapClipboard, pushUndoSnapshot, redoAction, refreshBoardBgPopoverUI, resetBoardBackground, setBoardBgColor, setBoardBgPattern, setBoardBgPreset, undoAction, updateCurrentBoardBgStyle, writeClipboardMarker } from './history';
import { closeHomeView, createNewArea, deleteArea, navigateToBoard, openAreaBoard, openSubBoard, renameArea, renderBreadcrumbs, renderHomeView, restoreViewportForBoard, toggleHomeView } from './homeView';
import { setLanguage, toggleLanguage, updateLanguageButtons } from './i18n';
import { createCardAt, extractLinkMetadata, extractMediaFromHtml, fetchWithTimeout, getAssetObjectUrl, getLocalizedCardLabel, hasImageFileExtensionOrParam, isDirectVideoUrl, isGifHostingDomain, isGifUrl, isLikelyGenericIconUrl, isVideoFile, isVideoFilename, normalizeHttpUrl, parseEmbedUrl, parseIframeEmbedCode, parseYouTubeStartSeconds, probeImageUrl, refreshLinkPreview, resolveDirectOrMetaImage, resolveHtmlMediaSource, resolveKnownGifHostUrl, saveImageBlobToUnsorted, saveImageToCanvas, saveTextOrLinkToUnsorted, saveVideoBlobToUnsorted, saveVideoToCanvas } from './mediaAndLinks';
import { applyPfpCrop, cancelClearAction, clampPfpOffsets, clearAllAppData, clearUnsortedData, closePfpCropModal, closeSettingsModal, dismissOnboardingPrefsCard, executeClearAction, formatBytes, getContrastTextColor, getInitials, handlePfpFileSelect, normalizeHexColor, onPfpCropZoomChange, openPfpCropModal, openSettingsModal, pruneOrphanAssets, removeUserPfp, renderAvatarElement, renderSettingsStorage, requestClearAction, resetPfpCrop, saveUserProfile, setProfileColor, setProfileName, syncOnboardingPrefsWidgets, syncProfileUI, triggerPfpUpload } from './profileSettings';
import { getCozyAudioContext, loadSoundsEnabled, playCozySound, playCozyTone, setSoundsEnabled } from './sound';
import { acceptP2PAnswer, acceptP2POffer, attachDataChannel, blobToDataUrl, buildVelmapSnapshot, closeSyncModal, copyPairCodeText, copySyncText, createPairRoomCode, createPeerConnection, dataUrlToBlob, decodeSignalPayload, detectDefaultDeviceInfo, disconnectP2P, encodeSignalPayload, exportVelmapFile, fetchSyncSignalsForRoom, generateShortPairCode, getActiveMonitoredRooms, getTombstones, handleIncomingP2PPayload, handleRoomSignalMessage, importVelmapFile, initiateRoomOffer, joinPairRoomCode, linkLocalSyncFile, loadDeviceIdentity, loadFromLinkedSyncFile, loadPairedDevices, mergeVelmapSnapshot, normalizePairCode, openSyncModal, persistSyncFileHandle, pollSyncRoomsOnce, postSyncSignal, reconnectPersistedSyncFile, reconnectToSavedDevice, recordTombstone, removeSavedDevice, renderQrInto, renderSyncDevicesUI, restorePersistedSyncFileHandle, saveDeviceIdentity, savePairedDevices, saveToLinkedSyncFile, scheduleSignalPollNow, scheduleSyncMutation, sendChunkedOverP2P, sendP2PSnapshot, startP2PHost, startQrScanner, stopQrScanner, switchSyncTab, togglePrimaryMachine, updateLocalDeviceName, updateSyncStatusUI, upsertPairedDevice, waitIceComplete } from './sync';
import { activateLineToolFromMenu, focusSelectedBoardTitle, handleGlobalTrashClick, openIconPicker, promptIconUrl, removeBoardIcon, setBoardColor, setBoardIcon, syncSelectionVisuals, triggerIconUpload } from './toolbar';
import { escapeHtml, refreshUntouchedStarterCardsLanguage, scheduleSaveUIState } from './uiState';

export function registerWindowBindings() {
  const w = window as any;
  if (!Object.getOwnPropertyDescriptor(w, 'activeTool')) {
    Object.defineProperty(w, 'activeTool', { get: () => S.activeTool, configurable: true });
  }
  Object.assign(w, {
    applyZoomAroundCenter, clearSelection, resetZoom, setActiveEmbedCard, setupCanvasInteractions, startCardDrag, startDragPhysics, startImageResize, stopDragPhysics, toggleEmbedInteract, updateCanvasTransform, zoomIn, zoomOut,
    addExternalTextAsTasks, appendNewTask, closeDocumentModal, closeTrashModal, convertSelectedToDocument, convertToDocument, deleteCard, deleteSelectedCards, editLinkUrl, emptyTrash, focusTaskInput, handleFileInput, importExternalCardsAsTasks, insertTaskAfter, modifyCardTable, moveSelectedToUnsorted, moveTaskToCard, moveToUnsorted, moveUnsortedCardToCanvas, openDocumentModal, openTrashModal, permanentDelete, promptDocLink, quickCaptureSubmit, removeTaskAndFocusPrev, renderTrashList, renderUnsortedDrawer, reorderTask, restoreCard, saveDocument, setupSearch, syncUnsortedSelectionVisuals, toggleCommentResolved, toggleSidebar, toggleTask, triggerImageUpload, updateCardContent, updateCardTitle, updateDocWordCount, updateLinkUrl, updateTableBodyCell, updateTableHeaderCell, updateTaskText, updateTaskTextLive, updateTrashBadge,
    fetchAndRenderCards, renderCanvasCards,
    attachConnectionDots, buildConnectionGeometry, clampAnchorT, clearConnectionSelection, cycleConnWeight, deleteSelectedConnection, drawConnections, getAnchorFromCanvasPoint, getBestAutoAnchors, getCardConnectionBounds, getEventPoint, promptConnLabel, resolveAnchorPoint, setConnColor, startConnectionDraw, toggleConnectionDashed, toggleEndMarker, toggleStartMarker,
    bringSelectedToFront, bringToFront, getNextTopZIndex, openContextMenuAt, openSelectedBoardMoreMenu, openSubBoardById, reorderCardLayer, selectAllCards, sendSelectedToBack, sendToBack, setupContextMenu,
    dbDelete, dbGet, dbGetAll, dbPut, initDB,
    bringCardsToFrontOnDragStart, buildTaskDragGhostEl, buildToolDragGhostEl, buildTrashDragGhostEl, buildUnsortedDragGhostEl, cancelFloatingPhysicsDrag, clearDropTargetHighlights, clearTaskDropHighlights, clearTrashHoverHighlight, finishFloatingPhysicsDrag, flashBreadcrumbDropTab, getHoveredBoardNode, getHoveredBreadcrumbTab, getHoveredTaskCard, getHoveredTaskRowInfo, getHoveredTrashBtn, getHoveredUnsortedTarget, getToolPreviewDimensions, moveCardsToBoard, playBoardPoofEffect, queueFloatingPhysicsDrag, setDraggedCardsElevated, setupClipboardAndDragDrop, setupTrashInteractions, setupUnsortedDropInteractions, startFloatingPhysicsDrag, syncCanvasDragOverlayTransform, updateCanvasCardDragElevationAndFeedback, updateFloatingPhysicsDragPosition, updateTrashHoverHighlight,
    applyBoardBackground, applyWorkspaceSnapshot, buildClipboardPayloadForSelection, captureWorkspaceSnapshot, cloneCardsAndConnectionsToBoard, closeBoardBgPopover, copySelectedCards, cutSelectedCards, duplicateSelectedCards, flushArrowNudgeCommit, openBoardBgPopover, pasteVelmapClipboard, pushUndoSnapshot, redoAction, refreshBoardBgPopoverUI, resetBoardBackground, setBoardBgColor, setBoardBgPattern, setBoardBgPreset, setupKeyboardShortcuts, undoAction, updateCurrentBoardBgStyle, writeClipboardMarker,
    closeHomeView, createNewArea, deleteArea, loadBoard, navigateToBoard, openAreaBoard, openHomeView, openSubBoard, renameArea, renderBreadcrumbs, renderHomeView, restoreViewportForBoard, toggleHomeView,
    applyTranslations, setLanguage, t, toggleLanguage, updateLanguageButtons,
    createCardAt, extractLinkMetadata, extractMediaFromHtml, fetchWithTimeout, getAssetObjectUrl, getLocalizedCardLabel, hasImageFileExtensionOrParam, isDirectVideoUrl, isGifHostingDomain, isGifUrl, isLikelyGenericIconUrl, isVideoFile, isVideoFilename, normalizeHttpUrl, parseEmbedUrl, parseIframeEmbedCode, parseYouTubeStartSeconds, probeImageUrl, refreshLinkPreview, resolveDirectOrMetaImage, resolveHtmlMediaSource, resolveKnownGifHostUrl, saveImageBlobToUnsorted, saveImageToCanvas, saveTextOrLinkToUnsorted, saveVideoBlobToUnsorted, saveVideoToCanvas,
    applyPfpCrop, cancelClearAction, clampPfpOffsets, clearAllAppData, clearUnsortedData, closePfpCropModal, closeSettingsModal, dismissOnboardingPrefsCard, executeClearAction, formatBytes, getContrastTextColor, getInitials, handlePfpFileSelect, loadUserProfile, normalizeHexColor, onPfpCropZoomChange, openPfpCropModal, openSettingsModal, pruneOrphanAssets, removeUserPfp, renderAvatarElement, renderPfpCropCanvas, renderSettingsStorage, requestClearAction, resetPfpCrop, saveUserProfile, setProfileColor, setProfileName, syncOnboardingPrefsWidgets, syncProfileUI, triggerPfpUpload,
    getCozyAudioContext, loadSoundsEnabled, playCozySound, playCozyTone, setSoundsEnabled, syncSoundsUI,
    acceptP2PAnswer, acceptP2POffer, attachDataChannel, blobToDataUrl, buildVelmapSnapshot, closeSyncModal, copyPairCodeText, copySyncText, createPairRoomCode, createPeerConnection, dataUrlToBlob, decodeSignalPayload, detectDefaultDeviceInfo, disconnectP2P, encodeSignalPayload, exportVelmapFile, fetchSyncSignalsForRoom, generateShortPairCode, getActiveMonitoredRooms, getTombstones, handleIncomingP2PPayload, handleRoomSignalMessage, importVelmapFile, initDeviceSyncSubsystem, initiateRoomOffer, joinPairRoomCode, linkLocalSyncFile, loadDeviceIdentity, loadFromLinkedSyncFile, loadPairedDevices, mergeVelmapSnapshot, normalizePairCode, openSyncModal, persistSyncFileHandle, pollSyncRoomsOnce, postSyncSignal, reconnectPersistedSyncFile, reconnectToSavedDevice, recordTombstone, removeSavedDevice, renderQrInto, renderSyncDevicesUI, restorePersistedSyncFileHandle, saveDeviceIdentity, savePairedDevices, saveToLinkedSyncFile, scheduleSignalPollNow, scheduleSyncMutation, sendChunkedOverP2P, sendP2PSnapshot, startP2PHost, startQrScanner, stopQrScanner, switchSyncTab, togglePrimaryMachine, updateLocalDeviceName, updateSyncStatusUI, upsertPairedDevice, waitIceComplete,
    activateLineToolFromMenu, focusSelectedBoardTitle, handleGlobalTrashClick, handleIconFileInput, openIconPicker, promptIconUrl, removeBoardIcon, setBoardColor, setBoardIcon, setTool, syncSelectionVisuals, triggerIconUpload,
    applySidebarDomState, centerCanvasInitial, enterCardEditMode, escapeHtml, exitCardEditMode, loadUIState, refreshUntouchedStarterCardsLanguage, saveUIState, scheduleSaveUIState, seedFirstRunExperience, showToast, syncFaviconLogos,
  });
}

export async function initVelmapApp() {
  registerWindowBindings();
  await (async () => {
      try {
          const savedUI = loadUIState();
          if (savedUI) {
              if (typeof savedUI.unsortedOpen === 'boolean') {
                  S.isSidebarOpen = savedUI.unsortedOpen;
                  S.hasExplicitSidebarPref = true;
              }
              if (savedUI.viewports && typeof savedUI.viewports === 'object') {
                  S.uiViewports = savedUI.viewports;
              }
              if (localStorage.getItem(SOUNDS_STORAGE_KEY) === null && typeof savedUI.soundsEnabled === 'boolean') {
                  S.soundsEnabled = savedUI.soundsEnabled;
                  localStorage.setItem(SOUNDS_STORAGE_KEY, S.soundsEnabled ? 'true' : 'false');
              }
          }
          applySidebarDomState();
          applyTranslations();
          syncFaviconLogos();
          syncSoundsUI();
          loadUserProfile();
          setTool('select');
          await initDB();
          const rootBoard = await dbGet('boards', 'root');
          if (!rootBoard) {
              await dbPut('boards', { id: 'root', title: 'Home', isArea: true, createdAt: Date.now() }, true);
          }
  
          const existingCards = await dbGetAll('cards');
          if (!localStorage.getItem(ONBOARDING_STORAGE_KEY)) {
              if (existingCards.length === 0) {
                  await seedFirstRunExperience();
              }
              localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
          }
  
          let targetBoardId = 'root';
          if (savedUI && savedUI.currentBoardId) {
              const savedBoard = await dbGet('boards', savedUI.currentBoardId);
              const savedSubCard = savedBoard ? null : await dbGet('cards', savedUI.currentBoardId);
              if (savedBoard || (savedSubCard && savedSubCard.type === 'subboard' && !savedSubCard.isTrash)) {
                  if (!savedBoard && savedSubCard) {
                      await dbPut('boards', { id: savedSubCard.id, title: savedSubCard.title || t('newBoardTitle'), parentId: savedSubCard.boardId || 'root', createdAt: Date.now() }, true);
                  }
                  targetBoardId = savedUI.currentBoardId;
                  if (Array.isArray(savedUI.breadcrumbs) && savedUI.breadcrumbs.length > 0 && savedUI.breadcrumbs[savedUI.breadcrumbs.length - 1]?.id === targetBoardId) {
                      S.breadcrumbs = savedUI.breadcrumbs;
                  } else {
                      const b = savedBoard || savedSubCard;
                      S.breadcrumbs = [{ id: targetBoardId, title: b?.title || 'Home' }];
                  }
              }
          }
  
          await loadBoard(targetBoardId, { restoreViewport: true, skipSaveUI: true });
          if (!S.uiViewports[targetBoardId]) {
              centerCanvasInitial();
          }
  
          setupCanvasInteractions();
          setupKeyboardShortcuts();
          setupClipboardAndDragDrop();
          setupTrashInteractions();
          setupUnsortedDropInteractions();
          setupContextMenu();
          setupSearch();
  
          const canvasContentEl = document.getElementById('canvas-content');
          if (canvasContentEl) {
              canvasContentEl.addEventListener('mousedown', (e: any) => {
                  const cardEl = e.target?.closest?.('.interactive-card');
                  if (!cardEl) return;
                  if (e.target?.matches?.('input:not([type="checkbox"]):not([type="color"]):not(.pointer-events-none), textarea:not(.pointer-events-none), [contenteditable="true"]')) {
                      enterCardEditMode(cardEl);
                  }
              }, true);
              canvasContentEl.addEventListener('focusin', (e: any) => {
                  const cardEl = e.target?.closest?.('.interactive-card');
                  if (!cardEl) return;
                  if (e.target?.matches?.('input:not([type="checkbox"]):not([type="color"]), textarea, [contenteditable="true"]')) {
                      enterCardEditMode(cardEl);
                  }
              });
              canvasContentEl.addEventListener('focusout', (e: any) => {
                  const cardEl = e.target?.closest?.('.interactive-card') as HTMLElement | null;
                  if (!cardEl) return;
                  const cid = cardEl.dataset.id;
                  setTimeout(() => {
                      if (!cardEl.isConnected) return;
                      const activeEl = document.activeElement;
                      const activeCard = activeEl?.closest?.('.interactive-card') as HTMLElement | null;
                      if (!activeCard || activeCard.dataset.id !== cid) {
                          exitCardEditMode(cid);
                      }
                  }, 0);
              });
          }
  
          if (typeof initDeviceSyncSubsystem === 'function') {
              await initDeviceSyncSubsystem();
          }
  
          if (savedUI && savedUI.homeOpen) {
              await openHomeView(true);
          } else {
              saveUIState();
          }
      } catch (error) {
          console.error('Initialization failed:', error);
          showToast(t('dbInitError'));
      }
  })();
  
  window.addEventListener('mousemove', (e) => {
      S.lastMouseClientX = e.clientX;
      S.lastMouseClientY = e.clientY;
      if (S.floatingDragState) {
          updateFloatingPhysicsDragPosition(e.clientX, e.clientY);
          return;
      }
      if (S.pendingFloatingDrag && !S.pendingFloatingDrag.isTouch) {
          const dist = Math.hypot(e.clientX - S.pendingFloatingDrag.startX, e.clientY - S.pendingFloatingDrag.startY);
          if (dist >= 5) {
              const opts = S.pendingFloatingDrag;
              S.pendingFloatingDrag = null;
              startFloatingPhysicsDrag(opts, e.clientX, e.clientY);
          }
      }
  });
  
  window.addEventListener('mouseup', async (e) => {
      if (S.pendingFloatingDrag && !S.pendingFloatingDrag.isTouch) {
          S.pendingFloatingDrag = null;
      }
      if (S.floatingDragState && !S.floatingDragState.isTouch) {
          await finishFloatingPhysicsDrag(e.clientX, e.clientY);
      }
  });
  
  window.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (S.floatingDragState && S.floatingDragState.isTouch) {
          e.preventDefault();
          updateFloatingPhysicsDragPosition(t.clientX, t.clientY);
          return;
      }
      if (S.pendingFloatingDrag && S.pendingFloatingDrag.isTouch) {
          const dist = Math.hypot(t.clientX - S.pendingFloatingDrag.startX, t.clientY - S.pendingFloatingDrag.startY);
          if (dist >= 6) {
              const opts = S.pendingFloatingDrag;
              S.pendingFloatingDrag = null;
              startFloatingPhysicsDrag(opts, t.clientX, t.clientY);
          }
      }
  }, { passive: false });
  
  window.addEventListener('touchend', handleFloatingTouchEnd, { passive: false });
  
  window.addEventListener('touchcancel', handleFloatingTouchEnd, { passive: false });
  
  setInterval(() => {
      if (S.activeDocId) saveDocument();
  }, 2000);
  
  await (() => {
      const editor = document.getElementById('doc-editor');
      if (editor) {
          editor.addEventListener('input', updateDocWordCount);
          editor.addEventListener('blur', saveDocument);
      }
      document.getElementById('doc-title-input').addEventListener('change', saveDocument);
      document.getElementById('icon-file-input').addEventListener('change', handleIconFileInput);
  })();
  
  document.getElementById('document-modal')?.addEventListener('mousedown', (e: any) => {
      if (e.target?.id === 'document-modal') closeDocumentModal();
  });
  
  await (() => {
      const stage = document.getElementById('pfp-crop-stage');
      if (!stage) return;
      stage.addEventListener('pointerdown', (e) => {
          if (!S.pfpCropState.img) return;
          S.pfpCropState.isDragging = true;
          S.pfpCropState.startX = e.clientX - S.pfpCropState.offsetX;
          S.pfpCropState.startY = e.clientY - S.pfpCropState.offsetY;
          stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', (e) => {
          if (!S.pfpCropState.isDragging) return;
          S.pfpCropState.offsetX = e.clientX - S.pfpCropState.startX;
          S.pfpCropState.offsetY = e.clientY - S.pfpCropState.startY;
          renderPfpCropCanvas();
      });
      const endDrag = () => { S.pfpCropState.isDragging = false; };
      stage.addEventListener('pointerup', endDrag);
      stage.addEventListener('pointercancel', endDrag);
      stage.addEventListener('wheel', (e) => {
          if (!S.pfpCropState.img) return;
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.08 : -0.08;
          S.pfpCropState.zoom = Math.min(3, Math.max(1, S.pfpCropState.zoom + delta));
          const slider = document.getElementById('pfp-crop-zoom') as HTMLInputElement | null;
          if (slider) slider.value = String(S.pfpCropState.zoom);
          renderPfpCropCanvas();
      }, { passive: false });
  })();
}
