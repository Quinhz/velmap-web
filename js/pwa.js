// ==========================================
// 15. PWA INSTALL PROMPT & OFFLINE INDICATOR
// ==========================================

let deferredPwaPrompt = null;
let isPwaInstalled = false;
let isIosDevice = false;

function detectPwaEnvironment() {
    isPwaInstalled =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
    const ua = (window.navigator.userAgent || '').toLowerCase();
    isIosDevice =
        /iphone|ipad|ipod/.test(ua) ||
        (window.navigator.platform === 'MacIntel' && (window.navigator.maxTouchPoints || 0) > 1);
}

function updatePwaInstallUI() {
    detectPwaEnvironment();
    const headerBtn = document.getElementById('header-pwa-install-btn');
    const mobileBtn = document.getElementById('mobile-pwa-install-btn');
    const settingsSection = document.getElementById('settings-pwa-section');
    const settingsBtn = document.getElementById('settings-pwa-install-btn');
    const settingsDesc = document.getElementById('settings-pwa-desc');
    const settingsInstalledBadge = document.getElementById('settings-pwa-installed-badge');

    const canTriggerPrompt = Boolean(deferredPwaPrompt);
    const canShowInstall = !isPwaInstalled && (canTriggerPrompt || isIosDevice);

    if (headerBtn) {
        headerBtn.classList.toggle('hidden', !canShowInstall);
        headerBtn.classList.toggle('md:flex', canShowInstall);
    }
    if (mobileBtn) {
        mobileBtn.classList.toggle('hidden', !canShowInstall);
        mobileBtn.classList.toggle('flex', canShowInstall);
    }

    if (settingsSection) {
        if (isPwaInstalled) {
            if (settingsBtn) settingsBtn.classList.add('hidden');
            if (settingsInstalledBadge) settingsInstalledBadge.classList.remove('hidden');
            if (settingsDesc) settingsDesc.textContent = t('pwaInstalledDesc');
        } else {
            if (settingsInstalledBadge) settingsInstalledBadge.classList.add('hidden');
            if (settingsBtn) {
                settingsBtn.classList.toggle('hidden', !canShowInstall);
                settingsBtn.textContent = isIosDevice && !canTriggerPrompt ? t('pwaInstallIosBtn') : t('pwaInstallBtn');
            }
            if (settingsDesc) {
                settingsDesc.textContent = canShowInstall ? t('pwaInstallReadyDesc') : t('pwaInstallBrowserHint');
            }
        }
    }
}

function updateOfflineIndicator() {
    const indicator = document.getElementById('offline-indicator');
    if (!indicator) return;
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    indicator.classList.toggle('hidden', online);
    indicator.classList.toggle('flex', !online);
}

function openIosPwaGuide() {
    document.getElementById('ios-pwa-modal')?.classList.remove('hidden');
}

function closeIosPwaGuide() {
    document.getElementById('ios-pwa-modal')?.classList.add('hidden');
}

async function triggerPwaInstall() {
    detectPwaEnvironment();
    if (isPwaInstalled) return;

    if (deferredPwaPrompt) {
        try {
            await deferredPwaPrompt.prompt();
            const choice = await deferredPwaPrompt.userChoice;
            if (choice && choice.outcome === 'accepted') {
                isPwaInstalled = true;
                deferredPwaPrompt = null;
                showToast(t('pwaInstalledToast'));
            }
        } catch (_) {}
        updatePwaInstallUI();
        return;
    }

    if (isIosDevice) {
        openIosPwaGuide();
        return;
    }

    showToast(t('pwaInstallBrowserHint'));
}

function initPwaSubsystem() {
    detectPwaEnvironment();

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPwaPrompt = e;
        updatePwaInstallUI();
    });

    window.addEventListener('appinstalled', () => {
        isPwaInstalled = true;
        deferredPwaPrompt = null;
        closeIosPwaGuide();
        updatePwaInstallUI();
        showToast(t('pwaInstalledToast'));
    });

    const standaloneMq = window.matchMedia('(display-mode: standalone)');
    if (standaloneMq && typeof standaloneMq.addEventListener === 'function') {
        standaloneMq.addEventListener('change', () => updatePwaInstallUI());
    }

    window.addEventListener('online', updateOfflineIndicator);
    window.addEventListener('offline', updateOfflineIndicator);

    updatePwaInstallUI();
    updateOfflineIndicator();
}

window.addEventListener('DOMContentLoaded', () => {
    initPwaSubsystem();
});
