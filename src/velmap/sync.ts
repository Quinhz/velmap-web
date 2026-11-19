import { updateTrashBadge } from './cardActions';
import { fetchAndRenderCards } from './cardRenderer';
import { dbDelete, dbGet, dbGetAll, dbPut } from './db';
import { t } from './i18n';
import { normalizeHexColor, renderSettingsStorage, saveUserProfile } from './profileSettings';
import { DEVICE_IDENTITY_KEY, PAIRED_DEVICES_KEY, REVOKED_DEVICES_KEY, S, TOMBSTONE_STORAGE_KEY, incomingChunkBuffers, onlinePeersByRoom, pendingOfferByRoom, roomLastSeq } from './state';
import { escapeHtml, showToast } from './uiState';

export function detectDefaultDeviceInfo() {
    const ua = navigator.userAgent || '';
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    const platform = isMobile ? 'mobile' : 'desktop';
    let os = isMobile ? 'Mobile' : 'Desktop';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS X|Macintosh/i.test(ua) && !isMobile) os = 'Mac';
    else if (/Linux/i.test(ua) && !isMobile) os = 'Linux';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    const tag = Math.random().toString(36).substring(2, 6).toUpperCase();
    return {
        deviceId: 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8),
        deviceName: `${os} · ${tag}`,
        platform,
        isPrimary: false
    };
}

export function loadDeviceIdentity() {
    try {
        const raw = localStorage.getItem(DEVICE_IDENTITY_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.deviceId) {
                S.localDevice = {
                    deviceId: parsed.deviceId,
                    deviceName: parsed.deviceName || 'Velmap Device',
                    platform: parsed.platform === 'mobile' ? 'mobile' : 'desktop',
                    isPrimary: !!parsed.isPrimary
                };
                return;
            }
        }
    } catch (_) {}
    S.localDevice = detectDefaultDeviceInfo();
    saveDeviceIdentity();
}

export function saveDeviceIdentity() {
    try {
        localStorage.setItem(DEVICE_IDENTITY_KEY, JSON.stringify(S.localDevice));
    } catch (_) {}
}

export function loadPairedDevices() {
    try {
        const raw = localStorage.getItem(PAIRED_DEVICES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        S.pairedDevices = Array.isArray(parsed) ? parsed.filter(d => d && d.id && d.pairRoomId) : [];
    } catch (_) {
        S.pairedDevices = [];
    }
    try {
        const revRaw = localStorage.getItem(REVOKED_DEVICES_KEY);
        S.revokedDevices = revRaw ? (JSON.parse(revRaw) || {}) : {};
    } catch (_) {
        S.revokedDevices = {};
    }
}

export function savePairedDevices() {
    try {
        localStorage.setItem(PAIRED_DEVICES_KEY, JSON.stringify(S.pairedDevices));
        localStorage.setItem(REVOKED_DEVICES_KEY, JSON.stringify(S.revokedDevices));
    } catch (_) {}
}

export function upsertPairedDevice(info) {
    if (!info || !info.id || info.id === S.localDevice.deviceId) return;
    if (S.revokedDevices[info.id]) return;
    const idx = S.pairedDevices.findIndex(d => d.id === info.id);
    const now = Date.now();
    if (idx >= 0) {
        S.pairedDevices[idx] = {
            ...S.pairedDevices[idx],
            name: info.name || S.pairedDevices[idx].name,
            platform: info.platform || S.pairedDevices[idx].platform,
            pairRoomId: info.pairRoomId || S.pairedDevices[idx].pairRoomId,
            isPrimary: typeof info.isPrimary === 'boolean' ? info.isPrimary : S.pairedDevices[idx].isPrimary,
            lastSyncedAt: info.lastSyncedAt || S.pairedDevices[idx].lastSyncedAt || now
        };
    } else {
        S.pairedDevices.push({
            id: info.id,
            name: info.name || 'Device',
            platform: info.platform || 'desktop',
            pairRoomId: info.pairRoomId,
            isPrimary: !!info.isPrimary,
            pairedAt: now,
            lastSyncedAt: info.lastSyncedAt || now
        });
    }
    savePairedDevices();
    renderSyncDevicesUI();
}

export function updateLocalDeviceName(name) {
    const cleaned = (name || '').trim();
    if (!cleaned) return;
    S.localDevice.deviceName = cleaned;
    saveDeviceIdentity();
    renderSyncDevicesUI();
    if (S.p2pChannel && S.p2pChannel.readyState === 'open') {
        sendChunkedOverP2P({ kind: 'VELMAP_DEVICE_HELLO', device: S.localDevice, pairRoomId: S.activeP2PRoomId });
    }
}

export function togglePrimaryMachine() {
    S.localDevice.isPrimary = !S.localDevice.isPrimary;
    saveDeviceIdentity();
    renderSyncDevicesUI();
    if (S.p2pChannel && S.p2pChannel.readyState === 'open') {
        sendChunkedOverP2P({ kind: 'VELMAP_DEVICE_HELLO', device: S.localDevice, pairRoomId: S.activeP2PRoomId });
    }
}

export async function removeSavedDevice(deviceId) {
    const dev = S.pairedDevices.find(d => d.id === deviceId);
    if (!dev) return;
    if (!confirm(t('confirmRemoveDevice', { name: dev.name || dev.id }))) return;

    const isMain = !!S.localDevice.isPrimary;
    if (isMain) {
        S.revokedDevices[deviceId] = Date.now();
    }
    S.pairedDevices = S.pairedDevices.filter(d => d.id !== deviceId);
    savePairedDevices();

    if (S.p2pChannel && S.p2pChannel.readyState === 'open' && S.activeRemoteDeviceId === deviceId) {
        try {
            sendChunkedOverP2P({
                kind: 'VELMAP_DEVICE_REVOKED',
                targetDeviceId: deviceId,
                byDeviceId: S.localDevice.deviceId
            });
        } catch (_) {}
        setTimeout(() => disconnectP2P(true), 120);
    }

    if (dev.pairRoomId && isMain) {
        await postSyncSignal(dev.pairRoomId, 'revoke', {
            targetDeviceId: deviceId,
            byDeviceId: S.localDevice.deviceId
        }, deviceId);
    }

    onlinePeersByRoom.delete(dev.pairRoomId);
    renderSyncDevicesUI();
    showToast(t('deviceRemovedToast'));
}

export function renderSyncDevicesUI() {
    const nameInp = document.getElementById('sync-device-name-input') as HTMLInputElement | null;
    const platPill = document.getElementById('sync-device-platform-pill');
    const primaryBadge = document.getElementById('sync-primary-badge');
    const togglePrimaryBtn = document.getElementById('btn-toggle-primary-machine');
    const listEl = document.getElementById('sync-saved-devices-list');
    const countEl = document.getElementById('sync-saved-count');

    if (nameInp && document.activeElement !== nameInp) {
        nameInp.value = S.localDevice.deviceName || '';
    }
    if (platPill) {
        platPill.textContent = S.localDevice.platform === 'mobile' ? 'MOBILE' : 'PC';
    }
    if (primaryBadge) {
        primaryBadge.classList.toggle('hidden', !S.localDevice.isPrimary);
    }
    if (togglePrimaryBtn) {
        togglePrimaryBtn.textContent = S.localDevice.isPrimary ? t('mainMachineBadge') : t('setMainMachineBtn');
        togglePrimaryBtn.title = t('primaryRoleTooltip');
        togglePrimaryBtn.className = S.localDevice.isPrimary
            ? 'hidden'
            : 'px-2 py-0.5 rounded-md text-[10px] font-medium bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 border border-white/[0.08] transition-colors';
    }
    if (primaryBadge && S.localDevice.isPrimary) {
        primaryBadge.onclick = togglePrimaryMachine;
        primaryBadge.style.cursor = 'pointer';
        primaryBadge.title = t('primaryRoleTooltip');
    }

    if (countEl) countEl.textContent = String(S.pairedDevices.length);
    if (!listEl) return;

    if (S.pairedDevices.length === 0) {
        listEl.innerHTML = `<div class="text-[11px] text-zinc-500 py-1">${escapeHtml(t('noSavedDevices'))}</div>`;
        return;
    }

    const now = Date.now();
    listEl.innerHTML = S.pairedDevices.map(dev => {
        const isConnected = S.p2pConnected && S.activeRemoteDeviceId === dev.id;
        const roomPeers = onlinePeersByRoom.get(dev.pairRoomId);
        const peerPresence = roomPeers ? roomPeers.get(dev.id) : null;
        const isNearby = !isConnected && peerPresence && (now - peerPresence.lastSeen < 14000);

        const dotCls = isConnected
            ? 'bg-emerald-400 animate-pulse'
            : isNearby
            ? 'bg-sky-400'
            : 'bg-zinc-600';
        const statusText = isConnected
            ? t('deviceConnectedBadge')
            : isNearby
            ? t('deviceNearbyBadge')
            : t('deviceSavedBadge');
        const lastSyncText = dev.lastSyncedAt
            ? t('lastSyncedLabel', { time: new Date(dev.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
            : t('neverSynced');
        const removeLabel = S.localDevice.isPrimary ? t('removeDeviceBtn') : t('forgetDeviceBtn');
        const iconSvg = dev.platform === 'mobile'
            ? '<svg class="w-4 h-4 text-zinc-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
            : '<svg class="w-4 h-4 text-zinc-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>';

        return `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-[#131316] border border-white/[0.07] rounded-lg px-3 py-2.5">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                        ${iconSvg}
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="text-xs font-medium text-zinc-100 truncate max-w-[160px]">${escapeHtml(dev.name || dev.id)}</span>
                            ${dev.isPrimary ? `<span class="px-1.5 py-[1px] rounded text-[9.5px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/20">${escapeHtml(t('mainMachineBadge'))}</span>` : ''}
                            <span class="inline-flex items-center gap-1 text-[10px] text-zinc-400">
                                <span class="w-1.5 h-1.5 rounded-full ${dotCls}"></span>
                                ${escapeHtml(statusText)}
                            </span>
                        </div>
                        <div class="text-[10.5px] text-zinc-500 truncate">${escapeHtml(lastSyncText)}</div>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                    ${isConnected
                        ? `<button type="button" onclick="sendP2PSnapshot(true)" class="px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30 transition-colors">${escapeHtml(t('syncNow'))}</button>`
                        : `<button type="button" onclick="reconnectToSavedDevice('${escapeHtml(dev.id)}')" class="px-2.5 py-1 rounded-md text-[11px] font-medium bg-white/[0.07] hover:bg-white/[0.12] text-zinc-200 border border-white/[0.08] transition-colors">${escapeHtml(t('reconnectBtn'))}</button>`
                    }
                    <button type="button" onclick="removeSavedDevice('${escapeHtml(dev.id)}')" class="px-2 py-1 rounded-md text-[11px] text-zinc-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors">${escapeHtml(removeLabel)}</button>
                </div>
            </div>
        `;
    }).join('');
}

export function generateShortPairCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return `VM-${code}`;
}

export function normalizePairCode(raw) {
    const cleaned = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length < 4) return null;
    const body = cleaned.startsWith('VM') ? cleaned.slice(2) : cleaned;
    if (body.length < 4) return null;
    return 'VM-' + body.slice(0, 6);
}

export function createPairRoomCode() {
    if (S.pairedDevices.length === 0 && !S.localDevice.isPrimary) {
        S.localDevice.isPrimary = true;
        saveDeviceIdentity();
        renderSyncDevicesUI();
    }
    const code = generateShortPairCode();
    S.activePairingCode = code;
    S.activePairingRoomId = 'pair_' + code;
    roomLastSeq.set(S.activePairingRoomId, 0);

    document.getElementById('sync-pair-code-display').textContent = code;
    document.getElementById('sync-pair-code-box').classList.remove('hidden');
    postSyncSignal(S.activePairingRoomId, 'presence', {
        deviceName: S.localDevice.deviceName,
        platform: S.localDevice.platform,
        isPrimary: S.localDevice.isPrimary,
        isPairing: true
    });
    scheduleSignalPollNow();
}

export function copyPairCodeText() {
    if (!S.activePairingCode) return;
    navigator.clipboard?.writeText(S.activePairingCode).then(() => {
        showToast(t('codeCopied'));
    }).catch(() => {});
}

export async function joinPairRoomCode() {
    const inp = document.getElementById('sync-join-pair-input') as HTMLInputElement | null;
    const normalized = normalizePairCode(inp ? inp.value : '');
    if (!normalized) {
        showToast(t('invalidPairCode'));
        return;
    }
    const roomId = 'pair_' + normalized;
    S.activePairingCode = normalized;
    S.activePairingRoomId = roomId;
    roomLastSeq.set(roomId, 0);

    updateSyncStatusUI(false, t('connecting'));
    await initiateRoomOffer(roomId, null, true);
    scheduleSignalPollNow();
}

export async function reconnectToSavedDevice(deviceId) {
    const dev = S.pairedDevices.find(d => d.id === deviceId);
    if (!dev || !dev.pairRoomId) return;
    updateSyncStatusUI(false, t('connecting'));
    pendingOfferByRoom.delete(dev.pairRoomId);
    await postSyncSignal(dev.pairRoomId, 'presence', {
        deviceName: S.localDevice.deviceName,
        platform: S.localDevice.platform,
        isPrimary: S.localDevice.isPrimary
    });
    await initiateRoomOffer(dev.pairRoomId, dev.id, false);
    scheduleSignalPollNow();
}

export async function postSyncSignal(roomId, type, payload, targetId = null) {
    if (!roomId) return;
    const packet = {
        roomId,
        senderId: S.localDevice.deviceId,
        targetId,
        type,
        payload,
        ts: Date.now()
    };
    if (S.syncBroadcast) {
        try { S.syncBroadcast.postMessage(packet); } catch (_) {}
    }
    if (!S.serverRelayAvailable) return;
    try {
        const res = await fetch('/api/sync-signal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(packet)
        });
        if (!res.ok && res.status === 404) {
            S.serverRelayAvailable = false;
        }
    } catch (_) {
        // Static/offline mode fallback
    }
}

export async function fetchSyncSignalsForRoom(roomId) {
    if (!S.serverRelayAvailable || !roomId) return [];
    const since = roomLastSeq.get(roomId) || 0;
    try {
        const url = `/api/sync-signal?roomId=${encodeURIComponent(roomId)}&since=${since}&clientId=${encodeURIComponent(S.localDevice.deviceId)}`;
        const res = await fetch(url);
        if (!res.ok) {
            if (res.status === 404) S.serverRelayAvailable = false;
            return [];
        }
        const data = await res.json();
        if (typeof data.lastSeq === 'number') {
            roomLastSeq.set(roomId, data.lastSeq);
        }
        return Array.isArray(data.signals) ? data.signals : [];
    } catch (_) {
        return [];
    }
}

export function getActiveMonitoredRooms() {
    const set = new Set();
    if (S.activePairingRoomId) set.add(S.activePairingRoomId);
    for (const d of S.pairedDevices) {
        if (d.pairRoomId) set.add(d.pairRoomId);
    }
    return [...set];
}

export async function initiateRoomOffer(roomId, targetId = null, isPairing = false) {
    try {
        S.activeP2PRoomId = roomId;
        const pc = createPeerConnection();
        const channel = pc.createDataChannel('velmap-sync', { ordered: true });
        attachDataChannel(channel, roomId);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitIceComplete(pc, 1400);

        await postSyncSignal(roomId, 'offer', {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
            deviceName: S.localDevice.deviceName,
            platform: S.localDevice.platform,
            isPrimary: S.localDevice.isPrimary,
            isPairing
        }, targetId);
        pendingOfferByRoom.set(roomId, Date.now());
    } catch (e) {
        console.warn('Could not initiate room offer:', e);
    }
}

export async function handleRoomSignalMessage(msg) {
    if (!msg || !msg.roomId || !msg.senderId || msg.senderId === S.localDevice.deviceId) return;
    if (msg.targetId && msg.targetId !== S.localDevice.deviceId) return;
    if (S.revokedDevices[msg.senderId] && S.localDevice.isPrimary) return;

    const roomId = msg.roomId;

    if (msg.type === 'revoke') {
        const payload = msg.payload || {};
        if (payload.targetDeviceId === S.localDevice.deviceId) {
            S.pairedDevices = S.pairedDevices.filter(d => d.id !== msg.senderId && d.pairRoomId !== roomId);
            savePairedDevices();
            if (S.activeRemoteDeviceId === msg.senderId) {
                disconnectP2P(true);
            }
            renderSyncDevicesUI();
            showToast(t('deviceRevokedToast'));
        }
        return;
    }

    if (msg.type === 'presence') {
        let map = onlinePeersByRoom.get(roomId);
        if (!map) { map = new Map(); onlinePeersByRoom.set(roomId, map); }
        const p = msg.payload || {};
        map.set(msg.senderId, {
            deviceName: p.deviceName || 'Device',
            platform: p.platform || 'desktop',
            isPrimary: !!p.isPrimary,
            lastSeen: Date.now()
        });
        renderSyncDevicesUI();

        const isPairedPeer = S.pairedDevices.some(d => d.id === msg.senderId && d.pairRoomId === roomId);
        if (isPairedPeer && !S.p2pConnected) {
            const lastTry = pendingOfferByRoom.get(roomId) || 0;
            if (S.localDevice.deviceId > msg.senderId && (Date.now() - lastTry > 8000)) {
                await initiateRoomOffer(roomId, msg.senderId, false);
            }
        }
        return;
    }

    if (msg.type === 'offer') {
        const payload = msg.payload || {};
        const isKnown = S.pairedDevices.some(d => d.id === msg.senderId && d.pairRoomId === roomId);
        const isPairingMatch = S.activePairingRoomId === roomId && payload.isPairing;
        if (!isKnown && !isPairingMatch) return;
        if (S.p2pConnected) return;

        try {
            const pc = createPeerConnection();
            S.activeP2PRoomId = roomId;
            pc.ondatachannel = (ev) => attachDataChannel(ev.channel, roomId);
            await pc.setRemoteDescription(new RTCSessionDescription({ type: payload.type, sdp: payload.sdp }));

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await waitIceComplete(pc, 1400);

            await postSyncSignal(roomId, 'answer', {
                type: pc.localDescription.type,
                sdp: pc.localDescription.sdp,
                deviceName: S.localDevice.deviceName,
                platform: S.localDevice.platform,
                isPrimary: S.localDevice.isPrimary
            }, msg.senderId);
        } catch (e) {
            console.warn('Auto offer accept failed:', e);
        }
        return;
    }

    if (msg.type === 'answer') {
        const payload = msg.payload || {};
        if (!S.p2pPeer || S.p2pConnected) return;
        if (S.p2pPeer.signalingState !== 'have-local-offer') return;
        try {
            S.activeP2PRoomId = roomId;
            await S.p2pPeer.setRemoteDescription(new RTCSessionDescription({ type: payload.type, sdp: payload.sdp }));
        } catch (e) {
            console.warn('Auto answer accept failed:', e);
        }
    }
}

export async function pollSyncRoomsOnce() {
    if (S.isPollingSignals) return;
    const rooms = getActiveMonitoredRooms();
    if (rooms.length === 0) return;

    S.isPollingSignals = true;
    try {
        for (const roomId of rooms) {
            if (!S.p2pConnected || S.activePairingRoomId === roomId) {
                await postSyncSignal(roomId, 'presence', {
                    deviceName: S.localDevice.deviceName,
                    platform: S.localDevice.platform,
                    isPrimary: S.localDevice.isPrimary,
                    isPairing: S.activePairingRoomId === roomId
                });
            }
            const signals = await fetchSyncSignalsForRoom(roomId);
            for (const sig of signals) {
                await handleRoomSignalMessage(sig);
            }
        }
    } finally {
        S.isPollingSignals = false;
    }
}

export function scheduleSignalPollNow() {
    pollSyncRoomsOnce();
    clearInterval(S.syncPollTimer);
    const modalOpen = !document.getElementById('sync-modal')?.classList.contains('hidden');
    const intervalMs = (modalOpen || S.activePairingRoomId) ? 1400 : 3800;
    S.syncPollTimer = setInterval(pollSyncRoomsOnce, intervalMs);
}

export async function initDeviceSyncSubsystem() {
    loadDeviceIdentity();
    loadPairedDevices();
    renderSyncDevicesUI();
    await restorePersistedSyncFileHandle();

    if ('BroadcastChannel' in window) {
        try {
            S.syncBroadcast = new BroadcastChannel('velmap_sync_bus');
            S.syncBroadcast.onmessage = (ev) => {
                handleRoomSignalMessage(ev.data);
            };
        } catch (_) {}
    }

    if (S.pairedDevices.length > 0 || S.activePairingRoomId) {
        scheduleSignalPollNow();
    }
}

export function getTombstones() {
    try {
        return JSON.parse(localStorage.getItem(TOMBSTONE_STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

export function recordTombstone(store: string, id: any) {
    try {
        const map = getTombstones();
        map[`${store}:${id}`] = Date.now();
        const entries = Object.entries(map) as [string, number][];
        if (entries.length > 500) {
            entries.sort((a, b) => b[1] - a[1]);
            localStorage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, 500))));
        } else {
            localStorage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify(map));
        }
    } catch (_) {}
}

export function updateSyncStatusUI(connected: boolean, label?: any) {
    S.p2pConnected = connected;
    const headerDot = document.getElementById('header-sync-dot');
    const modalDot = document.getElementById('sync-modal-dot');
    const modalStatus = document.getElementById('sync-modal-status');
    const connectedPanel = document.getElementById('p2p-connected-panel');
    const settingsStatus = document.getElementById('settings-sync-status');

    if (connected) {
        if (headerDot) headerDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0';
        if (modalDot) modalDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
        if (modalStatus) modalStatus.textContent = label || t('statusConnectedP2P');
        if (connectedPanel) connectedPanel.classList.remove('hidden');
        if (settingsStatus) settingsStatus.textContent = t('settingsSyncConnected');
    } else {
        if (headerDot) headerDot.className = 'w-2 h-2 rounded-full bg-zinc-500 shrink-0';
        if (modalDot) modalDot.className = 'w-2 h-2 rounded-full bg-zinc-500';
        if (modalStatus) modalStatus.textContent = label || t('statusOffline');
        if (connectedPanel) connectedPanel.classList.add('hidden');
        if (settingsStatus) settingsStatus.textContent = t('settingsSyncOffline');
    }
    renderSyncDevicesUI();
}

export function openSyncModal() {
    document.getElementById('sync-modal').classList.remove('hidden');
    renderSyncDevicesUI();
    scheduleSignalPollNow();
    const canScanQr = ('BarcodeDetector' in window) && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    ['btn-scan-offer-qr', 'btn-scan-answer-qr'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.toggle('hidden', !canScanQr);
    });
    const linkedSection = document.getElementById('linked-file-section');
    if (linkedSection && !('showOpenFilePicker' in window)) {
        const note = document.getElementById('linked-file-name');
        if (note) note.textContent = t('linkedFileUnsupported');
    }
}

export function closeSyncModal() {
    stopQrScanner();
    document.getElementById('sync-modal')?.classList.add('hidden');
    if (S.pairedDevices.length > 0) scheduleSignalPollNow();
}

export function switchSyncTab(tab) {
    const p2pBtn = document.getElementById('sync-tab-p2p');
    const fileBtn = document.getElementById('sync-tab-file');
    const p2pPanel = document.getElementById('sync-panel-p2p');
    const filePanel = document.getElementById('sync-panel-file');
    if (tab === 'p2p') {
        p2pBtn.className = 'px-2.5 sm:px-3 py-2 text-xs font-medium text-zinc-100 border-b-2 border-zinc-100';
        fileBtn.className = 'px-2.5 sm:px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 border-b-2 border-transparent';
        p2pPanel.classList.remove('hidden');
        filePanel.classList.add('hidden');
    } else {
        fileBtn.className = 'px-2.5 sm:px-3 py-2 text-xs font-medium text-zinc-100 border-b-2 border-zinc-100';
        p2pBtn.className = 'px-2.5 sm:px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 border-b-2 border-transparent';
        filePanel.classList.remove('hidden');
        p2pPanel.classList.add('hidden');
    }
}

export function copySyncText(inputId: string) {
    const inp = document.getElementById(inputId) as HTMLInputElement | null;
    if (!inp || !inp.value) return;
    navigator.clipboard?.writeText(inp.value).then(() => {
        showToast(t('codeCopied'));
    }).catch(() => {
        inp.select();
        document.execCommand('copy');
        showToast(t('codeCopied'));
    });
}

export function renderQrInto(containerId, text) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (typeof qrcode !== 'function' || text.length > 2600) {
        el.classList.add('hidden');
        return;
    }
    try {
        const qr = qrcode(0, 'L');
        qr.addData(text);
        qr.make();
        el.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2 });
        const svg = el.querySelector('svg');
        if (svg) {
            svg.style.width = '144px';
            svg.style.height = '144px';
        }
        el.classList.remove('hidden');
    } catch (e) {
        el.classList.add('hidden');
    }
}

export async function encodeSignalPayload(prefix, obj) {
    const json = JSON.stringify(obj);
    if ('CompressionStream' in window) {
        try {
            const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
            const buf = await new Response(stream).arrayBuffer();
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            return `${prefix}z:${btoa(bin)}`;
        } catch (_) {}
    }
    return `${prefix}:${btoa(unescape(encodeURIComponent(json)))}`;
}

export async function decodeSignalPayload(str) {
    const trimmed = (str || '').trim();
    if (trimmed.startsWith('VM1z:') || trimmed.startsWith('VM2z:')) {
        const b64 = trimmed.slice(5);
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const text = await new Response(stream).text();
        return JSON.parse(text);
    }
    if (trimmed.startsWith('VM1:') || trimmed.startsWith('VM2:')) {
        const b64 = trimmed.slice(4);
        return JSON.parse(decodeURIComponent(escape(atob(b64))));
    }
    throw new Error('Formato de código inválido');
}

export function createPeerConnection() {
    if (S.p2pPeer) {
        try { S.p2pPeer.close(); } catch (_) {}
    }
    S.p2pPeer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    S.p2pPeer.onconnectionstatechange = () => {
        if (!S.p2pPeer) return;
        if (S.p2pPeer.connectionState === 'disconnected' || S.p2pPeer.connectionState === 'failed' || S.p2pPeer.connectionState === 'closed') {
            S.activeRemoteDeviceId = null;
            updateSyncStatusUI(false, t('statusOffline'));
        }
    };
    return S.p2pPeer;
}

export function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 1800) {
    return new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const timer = setTimeout(() => resolve(), timeoutMs);
        pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') {
                clearTimeout(timer);
                resolve();
            }
        });
    });
}

export function attachDataChannel(channel, roomId = null) {
    S.p2pChannel = channel;
    const channelRoomId = roomId || S.activeP2PRoomId || ('vrm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));
    S.activeP2PRoomId = channelRoomId;

    channel.onopen = async () => {
        updateSyncStatusUI(true, t('statusConnectedP2P'));
        showToast(t('devicesConnectedToast'));
        // Troca identidade persistente do aparelho e sala permanente sem exigir novos convites depois
        let permanentRoom = channelRoomId;
        if (permanentRoom.startsWith('pair_')) {
            permanentRoom = 'vrm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        }
        sendChunkedOverP2P({
            kind: 'VELMAP_DEVICE_HELLO',
            device: S.localDevice,
            pairRoomId: channelRoomId.startsWith('pair_') ? undefined : channelRoomId,
            suggestedRoomId: permanentRoom
        });
        await sendP2PSnapshot(false);
    };
    channel.onclose = () => {
        S.activeRemoteDeviceId = null;
        updateSyncStatusUI(false, t('statusOffline'));
    };
    channel.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg && msg.__velmapChunk) {
                let buf = incomingChunkBuffers.get(msg.transferId);
                if (!buf) {
                    buf = { total: msg.total, parts: new Array(msg.total), received: 0 };
                    incomingChunkBuffers.set(msg.transferId, buf);
                }
                if (buf.parts[msg.index] === undefined) {
                    buf.parts[msg.index] = msg.data;
                    buf.received++;
                }
                if (buf.received === buf.total) {
                    const fullText = buf.parts.join('');
                    incomingChunkBuffers.delete(msg.transferId);
                    const payload = JSON.parse(fullText);
                    await handleIncomingP2PPayload(payload);
                }
            } else {
                await handleIncomingP2PPayload(msg);
            }
        } catch (e) {
            console.error('P2P message error:', e);
        }
    };
}

export function sendChunkedOverP2P(obj) {
    if (!S.p2pChannel || S.p2pChannel.readyState !== 'open') return;
    const json = JSON.stringify(obj);
    const CHUNK_SIZE = 16000;
    if (json.length <= CHUNK_SIZE) {
        S.p2pChannel.send(json);
        return;
    }
    const total = Math.ceil(json.length / CHUNK_SIZE);
    const transferId = 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    for (let i = 0; i < total; i++) {
        S.p2pChannel.send(JSON.stringify({
            __velmapChunk: true,
            transferId,
            index: i,
            total,
            data: json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        }));
    }
}

export async function startP2PHost() {
    if (S.pairedDevices.length === 0 && !S.localDevice.isPrimary) {
        S.localDevice.isPrimary = true;
        saveDeviceIdentity();
        renderSyncDevicesUI();
    }
    const roomId = 'vrm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const pc = createPeerConnection();
    const channel = pc.createDataChannel('velmap-sync', { ordered: true });
    attachDataChannel(channel, roomId);
    updateSyncStatusUI(false, t('creatingInvite'));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    const code = await encodeSignalPayload('VM1', {
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp,
        pairRoomId: roomId
    });
    (document.getElementById('p2p-offer-output') as HTMLInputElement).value = code;
    document.getElementById('p2p-host-box')?.classList.remove('hidden');
    renderQrInto('p2p-offer-qr', code);
    updateSyncStatusUI(false, t('waitingAnswer'));
}

export async function acceptP2POffer() {
    try {
        const raw = (document.getElementById('p2p-remote-offer-input') as HTMLInputElement).value;
        const offer = await decodeSignalPayload(raw);
        const roomId = offer.pairRoomId || ('vrm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));
        const pc = createPeerConnection();
        pc.ondatachannel = (ev) => attachDataChannel(ev.channel, roomId);
        await pc.setRemoteDescription(new RTCSessionDescription({ type: offer.type, sdp: offer.sdp }));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitIceComplete(pc);

        const code = await encodeSignalPayload('VM2', {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp
        });
        (document.getElementById('p2p-answer-output') as HTMLInputElement).value = code;
        document.getElementById('p2p-join-box')?.classList.remove('hidden');
        renderQrInto('p2p-answer-qr', code);
        updateSyncStatusUI(false, t('sendAnswerToOther'));
    } catch (e) {
        console.error(e);
        showToast(t('invalidInvite'));
    }
}

export async function acceptP2PAnswer() {
    try {
        if (!S.p2pPeer) return showToast(t('createInviteFirst'));
        const raw = (document.getElementById('p2p-answer-input') as HTMLInputElement).value;
        const answer = await decodeSignalPayload(raw);
        await S.p2pPeer.setRemoteDescription(new RTCSessionDescription({ type: answer.type, sdp: answer.sdp }));
        updateSyncStatusUI(false, t('connecting'));
    } catch (e) {
        console.error(e);
        showToast(t('invalidAnswer'));
    }
}

export function disconnectP2P(silent = false) {
    if (S.p2pChannel) { try { S.p2pChannel.close(); } catch (_) {} S.p2pChannel = null; }
    if (S.p2pPeer) { try { S.p2pPeer.close(); } catch (_) {} S.p2pPeer = null; }
    S.activeRemoteDeviceId = null;
    updateSyncStatusUI(false, t('statusOffline'));
    if (!silent) showToast(t('p2pDisconnected'));
}

export async function startQrScanner(targetInputId) {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
        return showToast(t('qrUnavailable'));
    }
    stopQrScanner();
    try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        S.qrScannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const box = document.getElementById('qr-scanner-box');
        const video = document.getElementById('qr-scanner-video') as HTMLVideoElement;
        video.srcObject = S.qrScannerStream;
        box.classList.remove('hidden');

        const tick = async () => {
            if (!S.qrScannerStream) return;
            try {
                if (video.readyState >= 2) {
                    const codes = await detector.detect(video);
                    if (codes && codes.length > 0 && codes[0].rawValue) {
                        const targetInp = document.getElementById(targetInputId) as HTMLInputElement | null;
                        if (targetInp) targetInp.value = codes[0].rawValue;
                        stopQrScanner();
                        showToast(t('qrScanned'));
                        return;
                    }
                }
            } catch (_) {}
            S.qrScannerRaf = requestAnimationFrame(tick);
        };
        S.qrScannerRaf = requestAnimationFrame(tick);
    } catch (e) {
        showToast(t('cameraDenied'));
    }
}

export function stopQrScanner() {
    if (S.qrScannerRaf) { cancelAnimationFrame(S.qrScannerRaf); S.qrScannerRaf = null; }
    if (S.qrScannerStream) {
        S.qrScannerStream.getTracks().forEach(t => t.stop());
        S.qrScannerStream = null;
    }
    const video = document.getElementById('qr-scanner-video') as HTMLVideoElement | null;
    if (video) video.srcObject = null;
    document.getElementById('qr-scanner-box')?.classList.add('hidden');
}

export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return await res.blob();
}

export async function buildVelmapSnapshot() {
    const [boards, allCards, rawAssets, allConnections] = await Promise.all([
        dbGetAll('boards'),
        dbGetAll('cards'),
        dbGetAll('assets'),
        dbGetAll('connections')
    ]);
    const assets = [];
    for (const a of rawAssets) {
        if (a && a.blob) {
            const dataUrl = await blobToDataUrl(a.blob);
            assets.push({ id: a.id, dataUrl });
        }
    }
    return {
        app: 'Velmap',
        version: 1,
        exportedAt: Date.now(),
        boards,
        cards: allCards,
        connections: allConnections,
        assets,
        tombstones: getTombstones(),
        profile: S.userProfile
    };
}

export async function mergeVelmapSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.boards) || !Array.isArray(snapshot.cards)) {
        throw new Error('Snapshot Velmap inválido');
    }
    S.isApplyingRemoteSync = true;
    try {
        const remoteTombstones = snapshot.tombstones || {};
        const localTombstones = getTombstones();
        const mergedTombstones = { ...localTombstones };
        for (const [key, ts] of Object.entries(remoteTombstones)) {
            mergedTombstones[key] = Math.max(mergedTombstones[key] || 0, Number(ts) || 0);
        }
        localStorage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify(mergedTombstones));

        const mergeStore = async (storeName, remoteItems) => {
            const localItems = await dbGetAll(storeName);
            const localMap = new Map(localItems.map(i => [i.id, i]));
            for (const rItem of remoteItems) {
                if (!rItem || !rItem.id) continue;
                const tombTs = mergedTombstones[`${storeName}:${rItem.id}`] || 0;
                const rTs = rItem.updatedAt || rItem.createdAt || 0;
                if (tombTs > rTs) continue;
                const lItem = localMap.get(rItem.id);
                const lTs = lItem ? (lItem.updatedAt || lItem.createdAt || 0) : -1;
                if (!lItem || rTs > lTs) {
                    await dbPut(storeName, rItem, true);
                }
            }
            for (const lItem of localItems) {
                const tombTs = mergedTombstones[`${storeName}:${lItem.id}`] || 0;
                const lTs = lItem.updatedAt || lItem.createdAt || 0;
                if (tombTs > lTs && lItem.id !== 'root') {
                    await dbDelete(storeName, lItem.id, true);
                }
            }
        };

        await mergeStore('boards', snapshot.boards || []);
        await mergeStore('cards', snapshot.cards || []);
        await mergeStore('connections', snapshot.connections || []);

        const localAssets = await dbGetAll('assets');
        const localAssetIds = new Set(localAssets.map(a => a.id));
        for (const rAsset of (snapshot.assets || [])) {
            if (rAsset && rAsset.id && rAsset.dataUrl && !localAssetIds.has(rAsset.id)) {
                const blob = await dataUrlToBlob(rAsset.dataUrl);
                await dbPut('assets', { id: rAsset.id, blob }, true);
            }
        }

        if (snapshot.profile && (snapshot.profile.updatedAt || 0) > (S.userProfile.updatedAt || 0)) {
            S.userProfile = {
                name: snapshot.profile.name || 'Workspace',
                color: normalizeHexColor(snapshot.profile.color || '#4f6b8a'),
                avatar: snapshot.profile.avatar || null,
                updatedAt: snapshot.profile.updatedAt || Date.now()
            };
            saveUserProfile(true);
        }

        await fetchAndRenderCards();
        await updateTrashBadge();
        if (!document.getElementById('settings-modal').classList.contains('hidden')) {
            await renderSettingsStorage();
        }
    } finally {
        S.isApplyingRemoteSync = false;
    }
}

export async function sendP2PSnapshot(manual = false) {
    if (!S.p2pChannel || S.p2pChannel.readyState !== 'open') return;
    const snapshot = await buildVelmapSnapshot();
    sendChunkedOverP2P({ kind: 'VELMAP_SNAPSHOT', snapshot });
    if (S.activeRemoteDeviceId) {
        const dev = S.pairedDevices.find(d => d.id === S.activeRemoteDeviceId);
        if (dev) { dev.lastSyncedAt = Date.now(); savePairedDevices(); renderSyncDevicesUI(); }
    }
    const lbl = document.getElementById('p2p-last-sync-label');
    if (lbl) lbl.textContent = t('lastSyncAt', { time: new Date().toLocaleTimeString() });
    if (manual) showToast(t('dataSentToast'));
}

export async function handleIncomingP2PPayload(msg) {
    if (!msg) return;

    if (msg.kind === 'VELMAP_DEVICE_REVOKED') {
        if (msg.targetDeviceId === S.localDevice.deviceId) {
            S.pairedDevices = S.pairedDevices.filter(d => d.id !== msg.byDeviceId);
            savePairedDevices();
            disconnectP2P(true);
            renderSyncDevicesUI();
            showToast(t('deviceRevokedToast'));
        }
        return;
    }

    if (msg.kind === 'VELMAP_DEVICE_HELLO' && msg.device && msg.device.deviceId) {
        const remote = msg.device;
        if (S.localDevice.isPrimary && S.revokedDevices[remote.deviceId]) {
            sendChunkedOverP2P({
                kind: 'VELMAP_DEVICE_REVOKED',
                targetDeviceId: remote.deviceId,
                byDeviceId: S.localDevice.deviceId
            });
            setTimeout(() => disconnectP2P(true), 120);
            return;
        }

        // Determina sala permanente determinística compartilhada entre os dois dispositivos
        let finalRoomId = msg.pairRoomId || S.activeP2PRoomId;
        if (!finalRoomId || finalRoomId.startsWith('pair_')) {
            const pairIds = [S.localDevice.deviceId, remote.deviceId].sort();
            finalRoomId = `vrm_${pairIds[0]}_${pairIds[1]}`.slice(0, 72);
        }
        S.activeP2PRoomId = finalRoomId;
        S.activeRemoteDeviceId = remote.deviceId;

        const wasKnown = S.pairedDevices.some(d => d.id === remote.deviceId);
        upsertPairedDevice({
            id: remote.deviceId,
            name: remote.deviceName || 'Device',
            platform: remote.platform || 'desktop',
            pairRoomId: finalRoomId,
            isPrimary: !!remote.isPrimary,
            lastSyncedAt: Date.now()
        });

        // Limpa UI de pareamento temporário após parear com sucesso
        if (S.activePairingRoomId) {
            S.activePairingRoomId = null;
            S.activePairingCode = null;
            document.getElementById('sync-pair-code-box')?.classList.add('hidden');
            const joinInp = document.getElementById('sync-join-pair-input') as HTMLInputElement | null;
            if (joinInp) joinInp.value = '';
        }

        updateSyncStatusUI(true, `${t('statusConnectedP2P')} · ${remote.deviceName || 'Device'}`);
        scheduleSignalPollNow();
        if (!wasKnown) {
            showToast(t('pairedSuccessToast'));
        }
        return;
    }

    if (msg.kind !== 'VELMAP_SNAPSHOT' || !msg.snapshot) return;
    await mergeVelmapSnapshot(msg.snapshot);
    if (S.activeRemoteDeviceId) {
        const dev = S.pairedDevices.find(d => d.id === S.activeRemoteDeviceId);
        if (dev) { dev.lastSyncedAt = Date.now(); savePairedDevices(); renderSyncDevicesUI(); }
    }
    const lbl = document.getElementById('p2p-last-sync-label');
    if (lbl) lbl.textContent = t('syncedAt', { time: new Date().toLocaleTimeString() });
}

export function scheduleSyncMutation() {
    if (S.isApplyingRemoteSync) return;
    clearTimeout(S.syncPushTimer);
    S.syncPushTimer = setTimeout(async () => {
        if (S.p2pChannel && S.p2pChannel.readyState === 'open') {
            await sendP2PSnapshot(false);
        }
        const autoSave = (document.getElementById('linked-file-autosave') as HTMLInputElement | null)?.checked;
        if (S.linkedSyncFileHandle && autoSave) {
            await saveToLinkedSyncFile(false);
        }
    }, 600);
}

export async function exportVelmapFile() {
    const snapshot = await buildVelmapSnapshot();
    const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
    const rawName = (S.userProfile?.name || 'user').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const safeUser = rawName.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
    a.href = url;
    a.download = `velmap-${safeUser}-sync-${stamp}.velmap`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(t('velmapExported'));
}

export async function importVelmapFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
        const text = await file.text();
        const snapshot = JSON.parse(text);
        await mergeVelmapSnapshot(snapshot);
        showToast(t('velmapMerged'));
    } catch (err) {
        console.error(err);
        showToast(t('invalidVelmapFile'));
    }
}

export async function persistSyncFileHandle(handle) {
    if (!S.db || !S.db.objectStoreNames.contains('kv') || !handle) return;
    try {
        await dbPut('kv', { id: 'linked_sync_file_handle', handle }, true);
    } catch (_) {}
}

export async function restorePersistedSyncFileHandle() {
    if (!S.db || !S.db.objectStoreNames.contains('kv') || !('showOpenFilePicker' in window)) return;
    try {
        const rec = await dbGet('kv', 'linked_sync_file_handle');
        const handle = rec?.handle;
        if (!handle) return;
        S.linkedSyncFileHandle = handle;
        const perm = await handle.queryPermission?.({ mode: 'readwrite' });
        const nameEl = document.getElementById('linked-file-name');
        const actionsEl = document.getElementById('linked-file-actions');
        const reconBtn = document.getElementById('btn-reconnect-linked-file');
        if (perm === 'granted') {
            if (nameEl) nameEl.textContent = t('linkedLabel', { name: handle.name });
            if (actionsEl) actionsEl.classList.remove('hidden');
            if (reconBtn) reconBtn.classList.add('hidden');
            await loadFromLinkedSyncFile();
        } else {
            if (nameEl) nameEl.textContent = t('linkedFileNeedsPermission', { name: handle.name });
            if (reconBtn) reconBtn.classList.remove('hidden');
        }
    } catch (_) {}
}

export async function reconnectPersistedSyncFile() {
    if (!S.linkedSyncFileHandle) return;
    try {
        const perm = await S.linkedSyncFileHandle.requestPermission?.({ mode: 'readwrite' });
        if (perm === 'granted') {
            document.getElementById('linked-file-name').textContent = t('linkedLabel', { name: S.linkedSyncFileHandle.name });
            document.getElementById('linked-file-actions').classList.remove('hidden');
            document.getElementById('btn-reconnect-linked-file')?.classList.add('hidden');
            await loadFromLinkedSyncFile();
        }
    } catch (e) {
        showToast(t('linkFileError'));
    }
}

export async function linkLocalSyncFile() {
    if (!window.showOpenFilePicker) {
        return showToast(t('fileSyncUnsupported'));
    }
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'Velmap Sync File', accept: { 'application/json': ['.velmap', '.json'] } }],
            multiple: false
        });
        S.linkedSyncFileHandle = handle;
        await persistSyncFileHandle(handle);
        const linkedFileEl = document.getElementById('linked-file-name');
        if (linkedFileEl) linkedFileEl.textContent = t('linkedLabel', { name: handle.name });
        document.getElementById('linked-file-actions')?.classList.remove('hidden');
        document.getElementById('btn-reconnect-linked-file')?.classList.add('hidden');
        await loadFromLinkedSyncFile();
    } catch (e: any) {
        if (e?.name !== 'AbortError') showToast(t('linkFileError'));
    }
}

export async function loadFromLinkedSyncFile() {
    if (!S.linkedSyncFileHandle) return;
    try {
        const file = await S.linkedSyncFileHandle.getFile();
        const text = (await file.text()).trim();
        if (text) {
            const snapshot = JSON.parse(text);
            await mergeVelmapSnapshot(snapshot);
            showToast(t('linkedMerged'));
        }
    } catch (e) {
        console.error(e);
        showToast(t('linkedReadError'));
    }
}

export async function saveToLinkedSyncFile(notify = true) {
    if (!S.linkedSyncFileHandle) return;
    try {
        const snapshot = await buildVelmapSnapshot();
        const writable = await S.linkedSyncFileHandle.createWritable();
        await writable.write(JSON.stringify(snapshot));
        await writable.close();
        if (notify) showToast(t('linkedSaved'));
    } catch (e) {
        console.error(e);
        if (notify) showToast(t('linkedWriteError'));
    }
}
