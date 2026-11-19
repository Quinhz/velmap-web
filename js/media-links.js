// ==========================================
// 8. DRAG, DROP E UTILITÁRIOS
// ==========================================
async function getAssetObjectUrl(assetId) {
    if (!assetId) return null;
    if (blobUrlCache.has(assetId)) return blobUrlCache.get(assetId);
    const asset = await dbGet('assets', assetId);
    if (asset && asset.blob) {
        const url = URL.createObjectURL(asset.blob);
        blobUrlCache.set(assetId, url);
        return url;
    }
    return null;
}

function isVideoFilename(name) {
    return /\.(mp4|webm|mov|m4v|ogv|ogg|mkv)(\?|#|$)/i.test(name || '');
}

function isVideoFile(file) {
    return !!file && ((file.type && file.type.startsWith('video/')) || isVideoFilename(file.name));
}

function isDirectVideoUrl(url) {
    if (!url) return false;
    try {
        const u = new URL(url);
        return /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(u.pathname);
    } catch (_) {
        return /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i.test(url);
    }
}

function isGifUrl(url) {
    if (!url) return false;
    try {
        const u = new URL(url);
        if (/\.gif$/i.test(u.pathname)) return true;
        const fmt = (u.searchParams.get('format') || u.searchParams.get('fm') || u.searchParams.get('ext') || '').toLowerCase();
        return fmt === 'gif';
    } catch (_) {
        return /\.gif(\?|#|$)/i.test(url);
    }
}

function hasImageFileExtensionOrParam(url) {
    if (!url) return false;
    if (/^data:image\//i.test(url)) return true;
    try {
        const u = new URL(url);
        if (/\.(jpeg|jpg|gif|png|webp|svg|avif|bmp|apng|jfif|ico)$/i.test(u.pathname)) return true;
        const fmt = (u.searchParams.get('format') || u.searchParams.get('fm') || u.searchParams.get('ext') || '').toLowerCase();
        if (['jpeg', 'jpg', 'gif', 'png', 'webp', 'avif', 'svg'].includes(fmt)) return true;
    } catch (_) {
        if (/\.(jpeg|jpg|gif|png|webp|svg|avif|bmp|apng|jfif|ico)(\?|#|$)/i.test(url)) return true;
    }
    return false;
}

function resolveKnownGifHostUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();
        if (host === 'giphy.com' || host.endsWith('.giphy.com')) {
            if (host.startsWith('media') && /\.(gif|webp)(\?|$)/i.test(u.pathname)) return url;
            const m = u.pathname.match(/\/gifs\/(?:.*-)?([a-zA-Z0-9]+)\/?$/);
            if (m && m[1]) return `https://media.giphy.com/media/${m[1]}/giphy.gif`;
            const m2 = u.pathname.match(/\/media\/([a-zA-Z0-9]+)\//);
            if (m2 && m2[1]) return `https://media.giphy.com/media/${m2[1]}/giphy.gif`;
        }
        if (host === 'i.imgur.com' && /\.gifv$/i.test(u.pathname)) {
            return url.replace(/\.gifv(\?.*)?$/i, '.gif');
        }
    } catch (_) {}
    return null;
}

function isGifHostingDomain(url) {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        return host === 'tenor.com' || host.endsWith('.tenor.com') || host === 'giphy.com' || host.endsWith('.giphy.com') || host === 'gph.is';
    } catch (_) {
        return false;
    }
}

async function probeImageUrl(url, timeoutMs = 4500) {
    if (!url) return false;
    if (hasImageFileExtensionOrParam(url)) return true;
    return await new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(ok);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.onload = () => finish((img.naturalWidth || 0) > 0 || /\.svg(\?|#|$)/i.test(url));
        img.onerror = () => finish(false);
        img.src = url;
    });
}

function resolveDirectOrMetaImage(url, meta, fallbackImg = null) {
    if (!meta) return null;
    if (!meta.videoUrl && meta.imageUrl === url && !fallbackImg) return url;
    if (!meta.videoUrl && meta.imageUrl && isGifHostingDomain(url) && isGifUrl(meta.imageUrl)) return meta.imageUrl;
    return null;
}

async function fetchWithTimeout(url, timeoutMs = 4500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

function normalizeHttpUrl(candidate, baseUrl) {
    if (!candidate) return null;
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('//')) return 'https:' + trimmed;
    try {
        const resolved = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:') return resolved.href;
    } catch (_) {}
    return null;
}

function parseYouTubeStartSeconds(rawTime) {
    if (!rawTime) return 0;
    if (/^\d+$/.test(rawTime)) return parseInt(rawTime, 10);
    let total = 0;
    const h = rawTime.match(/(\d+)h/i);
    const m = rawTime.match(/(\d+)m/i);
    const s = rawTime.match(/(\d+)s/i);
    if (h) total += parseInt(h[1], 10) * 3600;
    if (m) total += parseInt(m[1], 10) * 60;
    if (s) total += parseInt(s[1], 10);
    return total;
}

function parseIframeEmbedCode(raw) {
    if (!raw || typeof raw !== 'string') return null;
    if (!/<iframe[\s>]/i.test(raw)) return null;
    try {
        const doc = new DOMParser().parseFromString(raw, 'text/html');
        const iframe = doc.querySelector('iframe');
        if (!iframe) return null;
        const rawSrc = iframe.getAttribute('src');
        const embedUrl = normalizeHttpUrl(rawSrc);
        if (!embedUrl) return null;
        const u = new URL(embedUrl);
        const domain = u.hostname.replace(/^www\./, '');
        const titleAttr = (iframe.getAttribute('title') || '').trim();
        return {
            embedUrl,
            domain,
            title: titleAttr || domain || t('labelEmbed'),
            sourceUrl: ''
        };
    } catch (_) {
        return null;
    }
}

function parseEmbedUrl(rawUrl) {
    const url = normalizeHttpUrl(rawUrl);
    if (!url) return null;
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();

        // YouTube
        if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
            let videoId = '';
            if (host === 'youtu.be') {
                videoId = u.pathname.split('/').filter(Boolean)[0] || '';
            } else if (u.pathname.startsWith('/watch')) {
                videoId = u.searchParams.get('v') || '';
            } else {
                const parts = u.pathname.split('/').filter(Boolean);
                if (['embed', 'shorts', 'live', 'v'].includes(parts[0]) && parts[1]) {
                    videoId = parts[1];
                }
            }
            if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
                const startSec = parseYouTubeStartSeconds(u.searchParams.get('t') || u.searchParams.get('start'));
                const embedUrl = `https://www.youtube.com/embed/${videoId}?rel=0${startSec > 0 ? `&start=${startSec}` : ''}`;
                return {
                    embedUrl,
                    sourceUrl: url,
                    domain: 'youtube.com',
                    siteName: 'YouTube',
                    title: 'YouTube Video',
                    imageUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                };
            }
        }

        // Vimeo
        if (host === 'vimeo.com' || host === 'player.vimeo.com') {
            const match = u.pathname.match(/\/(?:video\/)?(\d+)/);
            if (match && match[1]) {
                return {
                    embedUrl: `https://player.vimeo.com/video/${match[1]}`,
                    sourceUrl: url,
                    domain: 'vimeo.com',
                    siteName: 'Vimeo',
                    title: 'Vimeo Video',
                    imageUrl: `https://vumbnail.com/${match[1]}.jpg`
                };
            }
        }

        // Loom
        if (host.endsWith('loom.com')) {
            const match = u.pathname.match(/\/(?:share|embed)\/([a-zA-Z0-9]+)/);
            if (match && match[1]) {
                return {
                    embedUrl: `https://www.loom.com/embed/${match[1]}`,
                    sourceUrl: url,
                    domain: 'loom.com',
                    siteName: 'Loom',
                    title: 'Loom Video',
                    imageUrl: null
                };
            }
        }

        // Spotify
        if (host === 'open.spotify.com') {
            const match = u.pathname.match(/^\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/);
            if (match) {
                return {
                    embedUrl: `https://open.spotify.com/embed/${match[1]}/${match[2]}`,
                    sourceUrl: url,
                    domain: 'open.spotify.com',
                    siteName: 'Spotify',
                    title: 'Spotify',
                    imageUrl: null
                };
            }
        }

        // Dailymotion
        if (host === 'dailymotion.com' || host === 'dai.ly') {
            const match = host === 'dai.ly'
                ? u.pathname.match(/^\/([a-zA-Z0-9]+)/)
                : u.pathname.match(/\/(?:embed\/)?video\/([a-zA-Z0-9]+)/);
            if (match && match[1]) {
                return {
                    embedUrl: `https://www.dailymotion.com/embed/video/${match[1]}`,
                    sourceUrl: url,
                    domain: 'dailymotion.com',
                    siteName: 'Dailymotion',
                    title: 'Dailymotion Video',
                    imageUrl: null
                };
            }
        }
    } catch (_) {}
    return null;
}

function resolveHtmlMediaSource(html) {
    if (!html || typeof html !== 'string') return null;
    const iframeInfo = parseIframeEmbedCode(html);
    if (iframeInfo) return { kind: 'embed', ...iframeInfo };
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const videoEl = doc.querySelector('video');
        if (videoEl) {
            const vSrc = normalizeHttpUrl(videoEl.getAttribute('src') || videoEl.querySelector('source')?.getAttribute('src'));
            if (vSrc) return { kind: 'video', url: vSrc };
        }
        const imgEl = doc.querySelector('img');
        if (imgEl) {
            const iSrc = normalizeHttpUrl(imgEl.getAttribute('src'));
            if (iSrc) return { kind: 'image', url: iSrc };
        }
    } catch (_) {}
    return null;
}

async function saveImageBlobToUnsorted(file, name) {
    const assetId = 'asset_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    await dbPut('assets', { id: assetId, blob: file });
    const cardId = 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await dbPut('cards', { id: cardId, boardId: 'unsorted', type: 'image', title: name, assetId, x: 100, y: 100, width: 270, height: null, isTrash: false, createdAt: Date.now() });
}

async function saveImageToCanvas(file, name, clientX, clientY) {
    const assetId = 'asset_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    await dbPut('assets', { id: assetId, blob: file });
    const vp = document.getElementById('canvas-viewport');
    const rect = vp.getBoundingClientRect();
    const x = (clientX - rect.left - canvasPanX) / canvasScale - 135;
    const y = (clientY - rect.top - canvasPanY) / canvasScale - 90;
    await dbPut('cards', {
        id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        boardId: currentBoardId, type: 'image', title: name, assetId,
        x: Math.round(x), y: Math.round(y),
        width: 270, height: null, zIndex: getNextTopZIndex(), isTrash: false, createdAt: Date.now()
    });
}

async function saveVideoBlobToUnsorted(file, name) {
    const assetId = 'asset_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    await dbPut('assets', { id: assetId, blob: file });
    const cardId = 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await dbPut('cards', { id: cardId, boardId: 'unsorted', type: 'video', title: name || t('pastedVideo'), assetId, x: 100, y: 100, width: 320, height: null, isTrash: false, createdAt: Date.now() });
}

async function saveVideoToCanvas(file, name, clientX, clientY) {
    const assetId = 'asset_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    await dbPut('assets', { id: assetId, blob: file });
    const vp = document.getElementById('canvas-viewport');
    const rect = vp.getBoundingClientRect();
    const x = (clientX - rect.left - canvasPanX) / canvasScale - 160;
    const y = (clientY - rect.top - canvasPanY) / canvasScale - 100;
    await dbPut('cards', {
        id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        boardId: currentBoardId, type: 'video', title: name || t('pastedVideo'), assetId,
        x: Math.round(x), y: Math.round(y),
        width: 320, height: null, zIndex: getNextTopZIndex(), isTrash: false, createdAt: Date.now()
    });
}

function isLikelyGenericIconUrl(imgUrl) {
    if (!imgUrl) return true;
    const low = imgUrl.toLowerCase();
    if (low.includes('google.com/s2/favicons')) return true;
    if (/favicon|apple-touch-icon|touch-icon|safari-pinned|webapp\/images\/favicon/i.test(low)) return true;
    if (/(^|\/)(logo|brand|icon|avatar-default|site-icon)[^/]*\.(png|svg|ico|webp)(\?|$)/i.test(low)) return true;
    if (/s\.pinimg\.com\/webapp\//i.test(low)) return true;
    return false;
}

function extractMediaFromHtml(html, baseUrl) {
    const out = { title: '', description: '', siteName: '', imageUrl: null, videoUrl: null, logoUrl: null, isVideoLink: false };
    if (!html) return out;
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const getMeta = (selectors) => {
            for (const sel of selectors) {
                const el = doc.querySelector(sel);
                const val = el?.getAttribute('content') || el?.getAttribute('href');
                if (val && val.trim()) return val.trim();
            }
            return '';
        };
        out.title = getMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]']) || (doc.querySelector('title')?.textContent || '').trim();
        out.description = getMeta(['meta[property="og:description"]', 'meta[name="twitter:description"]', 'meta[name="description"]']);
        out.siteName = getMeta(['meta[property="og:site_name"]']);
        const ogImg = getMeta(['meta[property="og:image:secure_url"]', 'meta[property="og:image"]', 'meta[name="twitter:image:src"]', 'meta[name="twitter:image"]', 'link[rel="image_src"]']);
        const ogVid = getMeta(['meta[property="og:video:secure_url"]', 'meta[property="og:video"]', 'meta[property="og:video:url"]', 'meta[name="twitter:player:stream"]']);
        const ogType = getMeta(['meta[property="og:type"]']);
        if (ogType && /video/i.test(ogType)) out.isVideoLink = true;
        if (ogImg) out.imageUrl = normalizeHttpUrl(ogImg, baseUrl);
        if (ogVid) {
            const normVid = normalizeHttpUrl(ogVid, baseUrl);
            if (normVid && isDirectVideoUrl(normVid)) out.videoUrl = normVid;
            out.isVideoLink = true;
        }
        const iconHref = getMeta(['link[rel="apple-touch-icon"]', 'link[rel="icon"]', 'link[rel="shortcut icon"]']);
        if (iconHref) out.logoUrl = normalizeHttpUrl(iconHref, baseUrl);

        // Parse JSON-LD structured data for rich thumbnails / videos
        doc.querySelectorAll('script[type="application/ld+json"]').forEach(sc => {
            try {
                const parsed = JSON.parse(sc.textContent || '{}');
                const items = Array.isArray(parsed) ? parsed : [parsed];
                for (const item of items) {
                    if (!out.title && item?.headline) out.title = String(item.headline).trim();
                    if (!out.title && item?.name) out.title = String(item.name).trim();
                    if (!out.description && item?.description) out.description = String(item.description).trim();
                    const thumb = item?.thumbnailUrl || (typeof item?.image === 'string' ? item.image : item?.image?.url) || (Array.isArray(item?.image) ? (typeof item.image[0] === 'string' ? item.image[0] : item.image[0]?.url) : null);
                    if (thumb && (!out.imageUrl || isLikelyGenericIconUrl(out.imageUrl))) {
                        out.imageUrl = normalizeHttpUrl(thumb, baseUrl) || out.imageUrl;
                    }
                    if (item?.contentUrl && isDirectVideoUrl(item.contentUrl)) {
                        out.videoUrl = normalizeHttpUrl(item.contentUrl, baseUrl);
                        out.isVideoLink = true;
                    }
                }
            } catch (_) {}
        });
    } catch (_) {}

    // Pinterest CDN media extraction (pins often embed i.pinimg.com / v1.pinimg.com in hydration JSON)
    const pinVidMatch = html.match(/https?:\/\/v1\.pinimg\.com\/videos\/[^"'\s\\]+\.mp4/i);
    if (pinVidMatch && !out.videoUrl) {
        out.videoUrl = pinVidMatch[0].replace(/\\u002F/gi, '/');
        out.isVideoLink = true;
    }
    if (!out.imageUrl || isLikelyGenericIconUrl(out.imageUrl)) {
        const pinMatches = html.match(/https?:\/\/i\.pinimg\.com\/(?:originals|736x|564x|474x)\/[a-zA-Z0-9/_.-]+\.(?:jpg|jpeg|png|webp)/gi);
        if (pinMatches && pinMatches.length > 0) {
            const preferred = pinMatches.find(u => /\/736x\/|\/originals\//i.test(u)) || pinMatches[0];
            out.imageUrl = preferred;
        }
    }
    return out;
}

async function extractLinkMetadata(url, fallbackImageUrl = null) {
    let domain = 'website';
    try {
        domain = new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {}
    let meta = {
        title: domain || url,
        description: '',
        domain,
        siteName: domain,
        imageUrl: null,
        videoUrl: null,
        isVideoLink: false,
        logoUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
    };

    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();
        const isPinterest = host.includes('pinterest.') || host === 'pin.it';

        // 1. oEmbed direto para plataformas de mídia suportadas
        let oembedEndpoint = null;
        if (host === 'youtu.be' || host.endsWith('youtube.com')) {
            const embedInfo = parseEmbedUrl(url);
            if (embedInfo?.imageUrl) meta.imageUrl = embedInfo.imageUrl;
            meta.siteName = 'YouTube';
            meta.isVideoLink = true;
            oembedEndpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        } else if (host.includes('vimeo.com')) {
            meta.siteName = 'Vimeo';
            meta.isVideoLink = true;
            oembedEndpoint = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
        } else if (host === 'open.spotify.com') {
            meta.siteName = 'Spotify';
            oembedEndpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
        } else if (host.includes('tiktok.com')) {
            meta.siteName = 'TikTok';
            meta.isVideoLink = true;
            oembedEndpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
        }

        if (oembedEndpoint) {
            try {
                const res = await fetchWithTimeout(oembedEndpoint, 4000);
                if (res.ok) {
                    const data = await res.json();
                    if (data.title) meta.title = data.title;
                    if (data.author_name && !meta.description) meta.description = data.author_name;
                    if (data.thumbnail_url) meta.imageUrl = normalizeHttpUrl(data.thumbnail_url, url) || meta.imageUrl;
                    if (data.provider_name) meta.siteName = data.provider_name;
                    if (meta.imageUrl && !isLikelyGenericIconUrl(meta.imageUrl)) return meta;
                }
            } catch (_) {}
        }

        // 2. Microlink JSON API (rich OpenGraph + video/image)
        try {
            const mlRes = await fetchWithTimeout(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, 4500);
            if (mlRes.ok) {
                const mlJson = await mlRes.json();
                const d = mlJson?.data;
                if (mlJson?.status === 'success' && d) {
                    if (d.title) meta.title = d.title.trim();
                    if (d.description) meta.description = d.description.trim();
                    if (d.publisher) meta.siteName = d.publisher.trim();
                    if (d.video?.url) {
                        const vUrl = normalizeHttpUrl(d.video.url, url);
                        if (vUrl && isDirectVideoUrl(vUrl)) meta.videoUrl = vUrl;
                        meta.isVideoLink = true;
                    }
                    if (d.image?.url) {
                        const candidateImg = normalizeHttpUrl(d.image.url, url);
                        if (candidateImg && !isLikelyGenericIconUrl(candidateImg)) meta.imageUrl = candidateImg;
                    }
                    if (d.logo?.url) meta.logoUrl = normalizeHttpUrl(d.logo.url, url) || meta.logoUrl;
                    if ((meta.videoUrl || (meta.imageUrl && !isLikelyGenericIconUrl(meta.imageUrl))) && !isPinterest) {
                        return meta;
                    }
                }
            }
        } catch (_) {}

        // 3. HTML proxies (AllOrigins + CorsProxy) para extrair og:image, og:video, JSON-LD e pins do Pinterest
        const proxies = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            `https://corsproxy.io/?url=${encodeURIComponent(url)}`
        ];
        for (const proxyUrl of proxies) {
            try {
                const res = await fetchWithTimeout(proxyUrl, 5000);
                if (!res.ok) continue;
                const html = await res.text();
                const parsed = extractMediaFromHtml(html, url);
                if (parsed.title && (meta.title === domain || meta.title === url || isPinterest)) meta.title = parsed.title;
                if (parsed.description && !meta.description) meta.description = parsed.description;
                if (parsed.siteName && meta.siteName === domain) meta.siteName = parsed.siteName;
                if (parsed.logoUrl) meta.logoUrl = parsed.logoUrl;
                if (parsed.videoUrl && !meta.videoUrl) meta.videoUrl = parsed.videoUrl;
                if (parsed.isVideoLink) meta.isVideoLink = true;
                if (parsed.imageUrl && (!meta.imageUrl || isLikelyGenericIconUrl(meta.imageUrl) || !isLikelyGenericIconUrl(parsed.imageUrl))) {
                    if (!isLikelyGenericIconUrl(parsed.imageUrl)) meta.imageUrl = parsed.imageUrl;
                }
                if (meta.videoUrl || (meta.imageUrl && !isLikelyGenericIconUrl(meta.imageUrl))) break;
            } catch (_) {}
        }

        // 4. Fallback Noembed quando ainda não há banner válido
        if (!meta.imageUrl || isLikelyGenericIconUrl(meta.imageUrl)) {
            try {
                const neRes = await fetchWithTimeout(`https://noembed.com/embed?url=${encodeURIComponent(url)}`, 3500);
                if (neRes.ok) {
                    const ne = await neRes.json();
                    if (ne && !ne.error) {
                        if (ne.title && (meta.title === domain || meta.title === url)) meta.title = ne.title;
                        if (ne.thumbnail_url && !isLikelyGenericIconUrl(ne.thumbnail_url)) {
                            meta.imageUrl = normalizeHttpUrl(ne.thumbnail_url, url) || meta.imageUrl;
                        }
                        if (ne.provider_name && meta.siteName === domain) meta.siteName = ne.provider_name;
                    }
                }
            } catch (_) {}
        }
    } catch (e) {
        console.log('Metadata extraction failed', e);
    }

    if ((!meta.imageUrl || isLikelyGenericIconUrl(meta.imageUrl)) && fallbackImageUrl) {
        const normFallback = normalizeHttpUrl(fallbackImageUrl, url);
        if (normFallback && !isLikelyGenericIconUrl(normFallback)) meta.imageUrl = normFallback;
    }
    return meta;
}

async function refreshLinkPreview(cardId) {
    const c = await dbGet('cards', cardId);
    if (!c || !c.content) return;
    const knownGif = resolveKnownGifHostUrl(c.content);
    if (knownGif || await probeImageUrl(c.content)) {
        c.type = 'image';
        c.content = knownGif || c.content;
        c.title = t('webImage');
        c.embedUrl = null;
        c.height = null;
        c.imageUrl = null;
        c.videoUrl = null;
        c.isVideoLink = false;
        c.description = '';
        c.logoUrl = null;
        c.siteName = null;
        c.domain = null;
        await dbPut('cards', c);
        await fetchAndRenderCards();
        showToast(t('convertedToImage'));
        return;
    }
    showToast(t('fetchingPreview'));
    const meta = await extractLinkMetadata(c.content, c.imageUrl || null);
    const resolvedImg = resolveDirectOrMetaImage(c.content, meta, null);
    if (resolvedImg) {
        c.type = 'image';
        c.content = resolvedImg;
        c.title = t('webImage');
        c.embedUrl = null;
        c.height = null;
        c.imageUrl = null;
        c.videoUrl = null;
        c.isVideoLink = false;
        c.description = '';
        c.logoUrl = null;
        c.siteName = null;
        c.domain = null;
        await dbPut('cards', c);
        await fetchAndRenderCards();
        showToast(t('convertedToImage'));
        return;
    }
    c.title = meta.title || c.title;
    c.description = meta.description || '';
    c.domain = meta.domain || c.domain;
    c.siteName = meta.siteName || c.siteName;
    c.imageUrl = meta.imageUrl || c.imageUrl || null;
    c.videoUrl = meta.videoUrl || null;
    c.isVideoLink = !!meta.isVideoLink;
    c.logoUrl = meta.logoUrl || c.logoUrl;
    await dbPut('cards', c);
    await fetchAndRenderCards();
}

async function saveTextOrLinkToUnsorted(text, rawHtml = '') {
    const trimmed = (text || '').trim();
    const embedCode = parseIframeEmbedCode(trimmed) || (rawHtml ? parseIframeEmbedCode(rawHtml) : null);
    if (embedCode) {
        await dbPut('cards', {
            id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            boardId: 'unsorted', type: 'embed',
            title: embedCode.title, content: embedCode.sourceUrl || '',
            embedUrl: embedCode.embedUrl, domain: embedCode.domain,
            x: 100, y: 100, width: 340, height: 232, isTrash: false, createdAt: Date.now()
        });
        return;
    }

    const htmlMedia = rawHtml ? resolveHtmlMediaSource(rawHtml) : null;
    if (htmlMedia && htmlMedia.kind === 'video') {
        await dbPut('cards', {
            id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            boardId: 'unsorted', type: 'video',
            title: t('webVideo'), content: htmlMedia.url,
            x: 100, y: 100, width: 320, height: null, isTrash: false, createdAt: Date.now()
        });
        return;
    }

    const isUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') || /^data:image\//i.test(trimmed);
    if (isUrl) {
        const knownGif = resolveKnownGifHostUrl(trimmed);
        if (knownGif) {
            await dbPut('cards', { id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6), boardId: 'unsorted', type: 'image', title: t('webImage'), content: knownGif, x: 100, y: 100, width: 270, height: null, isTrash: false, createdAt: Date.now() });
            return;
        }

        const embedInfo = parseEmbedUrl(trimmed);
        if (embedInfo) {
            const meta = await extractLinkMetadata(trimmed);
            await dbPut('cards', {
                id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                boardId: 'unsorted', type: 'embed',
                title: (meta.title && meta.title !== embedInfo.domain) ? meta.title : embedInfo.title,
                content: trimmed,
                embedUrl: embedInfo.embedUrl,
                imageUrl: meta.imageUrl || embedInfo.imageUrl,
                domain: embedInfo.domain,
                siteName: meta.siteName || embedInfo.siteName,
                x: 100, y: 100, width: 340, height: 232, isTrash: false, createdAt: Date.now()
            });
            return;
        }

        if (isDirectVideoUrl(trimmed)) {
            await dbPut('cards', {
                id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                boardId: 'unsorted', type: 'video',
                title: t('webVideo'), content: trimmed,
                x: 100, y: 100, width: 320, height: null, isTrash: false, createdAt: Date.now()
            });
            return;
        }

        const isImg = await probeImageUrl(trimmed);

        if (isImg) {
            await dbPut('cards', { id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6), boardId: 'unsorted', type: 'image', title: t('webImage'), content: trimmed, x: 100, y: 100, width: 270, height: null, isTrash: false, createdAt: Date.now() });
        } else {
            const fallbackImg = htmlMedia?.kind === 'image' ? htmlMedia.url : null;
            const meta = await extractLinkMetadata(trimmed, fallbackImg);
            const resolvedImg = resolveDirectOrMetaImage(trimmed, meta, fallbackImg);
            if (resolvedImg) {
                await dbPut('cards', { id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6), boardId: 'unsorted', type: 'image', title: t('webImage'), content: resolvedImg, x: 100, y: 100, width: 270, height: null, isTrash: false, createdAt: Date.now() });
            } else {
                await dbPut('cards', {
                    id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                    boardId: 'unsorted', type: 'link',
                    title: meta.title, description: meta.description,
                    content: trimmed, imageUrl: meta.imageUrl, videoUrl: meta.videoUrl || null,
                    isVideoLink: !!meta.isVideoLink, logoUrl: meta.logoUrl,
                    siteName: meta.siteName, domain: meta.domain,
                    x: 100, y: 100, width: 270, height: 170, isTrash: false, createdAt: Date.now()
                });
            }
        }
    } else {
        await dbPut('cards', { id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6), boardId: 'unsorted', type: 'sticky', title: t('labelNote'), content: text, x: 100, y: 100, width: 270, height: 170, isTrash: false, createdAt: Date.now() });
    }
}

function getLocalizedCardLabel(type) {
    const labels = {
        sticky: t('labelNote'),
        task: t('labelTask'),
        link: t('labelLink'),
        subboard: t('newBoardTitle'),
        column: t('labelColumn'),
        document: t('newDocTitle'),
        comment: t('labelComment'),
        table: t('labelTable'),
        video: t('labelVideo'),
        embed: t('labelEmbed')
    };
    return labels[type] || t('labelCard');
}

async function createCardAt(type, x, y, targetBoardId = currentBoardId, extraFields = null) {
    await pushUndoSnapshot();
    const w = type === 'subboard' ? 140 : type === 'document' ? 96 : type === 'table' ? 380 : type === 'comment' ? 256 : type === 'column' ? 300 : 270;
    const h = type === 'subboard' ? 140 : type === 'document' ? null : type === 'table' ? 180 : type === 'comment' ? 132 : 170;
    const finalBoardId = targetBoardId || currentBoardId;

    if (finalBoardId !== 'root' && finalBoardId !== 'unsorted') {
        const existingBoard = await dbGet('boards', finalBoardId);
        if (!existingBoard) {
            const subCard = await dbGet('cards', finalBoardId);
            await dbPut('boards', {
                id: finalBoardId,
                title: subCard?.title || t('newBoardTitle'),
                parentId: currentBoardId,
                createdAt: Date.now()
            });
        }
    }

    const newCard = {
        id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        boardId: finalBoardId, type, title: getLocalizedCardLabel(type), content: '',
        tasks: type === 'task' ? [{ text: t('firstTask'), completed: false }] : [],
        x: Math.round(x), y: Math.round(y),
        width: w, height: h, zIndex: getNextTopZIndex(),
        isTrash: false, createdAt: Date.now()
    };
    if (extraFields && typeof extraFields === 'object') {
        Object.assign(newCard, extraFields);
    }
    if (type === 'comment') {
        newCard.authorName = userProfile.name || 'Workspace';
        newCard.authorColor = normalizeHexColor(userProfile.color);
        newCard.resolved = false;
    } else if (type === 'table') {
        newCard.tableData = {
            headers: [`${t('tableColPrefix')} 1`, `${t('tableColPrefix')} 2`, `${t('tableColPrefix')} 3`],
            rows: [['', '', ''], ['', '', '']]
        };
    }

    await dbPut('cards', newCard);
    await fetchAndRenderCards();
    document.getElementById('context-menu').style.display = 'none';
}

