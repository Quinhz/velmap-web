// ==========================================
// 13. EXPORTAÇÃO MILANOTE-STYLE (PNG / PDF / WORD / MD / TXT / ZIP)
// ==========================================

function closeExportPopover() {
    document.getElementById('export-popover')?.classList.add('hidden');
}

async function toggleExportPopover(e) {
    if (e) e.stopPropagation();
    const pop = document.getElementById('export-popover');
    const btn = document.getElementById('header-export-btn');
    if (!pop) return;
    if (!pop.classList.contains('hidden')) {
        pop.classList.add('hidden');
        return;
    }
    closeBoardBgPopover();
    const cm = document.getElementById('context-menu');
    if (cm) cm.style.display = 'none';

    pop.classList.remove('hidden');
    if (btn) {
        const rect = btn.getBoundingClientRect();
        const popW = pop.offsetWidth || 280;
        const left = Math.min(Math.max(8, rect.right - popW), Math.max(8, window.innerWidth - popW - 8));
        const top = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - pop.offsetHeight - 8));
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;
    }
    await refreshExportZipSize();
}

function sanitizeExportFilename(name, fallback = 'velmap-board') {
    const cleaned = String(name || fallback)
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || fallback;
}

function formatExportBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function triggerExportBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function getCurrentBoardExportTitle() {
    if (currentBoardId === 'root') return t('mainWorkspaceTitle');
    const b = await dbGet('boards', currentBoardId);
    if (b && b.title) return b.title;
    const c = await dbGet('cards', currentBoardId);
    return c?.title || t('newBoardTitle');
}

async function collectBoardScopeIds(includeSubboards) {
    const allCards = await dbGetAll('cards');
    const active = allCards.filter(c => !c.isTrash && c.boardId !== 'unsorted');
    const boardIds = [currentBoardId];
    if (includeSubboards) {
        const seen = new Set(boardIds);
        const queue = [currentBoardId];
        while (queue.length > 0) {
            const bid = queue.shift();
            const subCards = active.filter(c => c.boardId === bid && c.type === 'subboard');
            for (const sc of subCards) {
                if (!seen.has(sc.id)) {
                    seen.add(sc.id);
                    boardIds.push(sc.id);
                    queue.push(sc.id);
                }
            }
        }
    }
    return { boardIds, activeCards: active };
}

async function collectDownloadableAssetsForExport(includeSubboards) {
    const { boardIds, activeCards } = await collectBoardScopeIds(includeSubboards);
    const scopeSet = new Set(boardIds);
    const scopedCards = activeCards.filter(c => scopeSet.has(c.boardId));
    const entries = [];
    const usedNames = new Set();
    let totalEstimatedBytes = 0;

    const makeUniqueName = (base, ext) => {
        const cleanBase = sanitizeExportFilename(base, 'file').replace(/\.[a-z0-9]{1,5}$/i, '');
        let candidate = `${cleanBase}.${ext}`;
        let idx = 2;
        while (usedNames.has(candidate.toLowerCase())) {
            candidate = `${cleanBase}_${idx}.${ext}`;
            idx++;
        }
        usedNames.add(candidate.toLowerCase());
        return candidate;
    };

    for (const card of scopedCards) {
        if (card.type === 'image' || card.type === 'video' || card.iconAssetId) {
            const assetId = card.assetId || card.iconAssetId;
            if (assetId) {
                const asset = await dbGet('assets', assetId);
                if (asset && asset.blob) {
                    const mime = (asset.blob.type || '').toLowerCase();
                    let ext = card.type === 'video' ? 'mp4' : 'png';
                    if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
                    else if (mime.includes('webp')) ext = 'webp';
                    else if (mime.includes('gif')) ext = 'gif';
                    else if (mime.includes('svg')) ext = 'svg';
                    else if (mime.includes('webm')) ext = 'webm';
                    else if (mime.includes('quicktime')) ext = 'mov';
                    const name = makeUniqueName(card.title || card.type, ext);
                    totalEstimatedBytes += asset.blob.size || 0;
                    entries.push({ name, blob: asset.blob, url: null });
                }
            } else if ((card.type === 'image' || card.type === 'video') && card.content && /^(https?:|data:)/i.test(card.content)) {
                const extMatch = card.content.match(/\.(png|jpe?g|webp|gif|svg|mp4|webm)(?:[?#]|$)/i);
                const ext = extMatch ? extMatch[1].toLowerCase().replace('jpeg', 'jpg') : (card.type === 'video' ? 'mp4' : 'png');
                const name = makeUniqueName(card.title || card.type, ext);
                totalEstimatedBytes += card.content.startsWith('data:') ? Math.round(card.content.length * 0.75) : 45000;
                entries.push({ name, blob: null, url: card.content });
            }
        } else if (card.type === 'document') {
            const md = `# ${card.title || t('newDocTitle')}\n\n${exportHtmlToMarkdown(card.content || '')}\n`;
            const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
            const name = makeUniqueName(`documents/${card.title || 'document'}`, 'md');
            totalEstimatedBytes += blob.size;
            entries.push({ name, blob, url: null });
        }
    }

    return { entries, totalEstimatedBytes };
}

async function refreshExportZipSize() {
    const sizeEl = document.getElementById('export-zip-size');
    if (!sizeEl) return;
    const includeSub = !!document.getElementById('export-include-subboards')?.checked;
    try {
        const { totalEstimatedBytes } = await collectDownloadableAssetsForExport(includeSub);
        sizeEl.textContent = `(${formatExportBytes(totalEstimatedBytes)})`;
    } catch (_) {
        sizeEl.textContent = '(0 KB)';
    }
}

// ---------- HTML -> Markdown & Linear Document Builders ----------

function exportHtmlToMarkdown(html) {
    if (!html) return '';
    if (!/<[a-z][\s\S]*>/i.test(html)) {
        return String(html).replace(/\u200B/g, '').trim();
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    const walkInline = (node) => {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) {
            return node.nodeValue.replace(/\u200B/g, '');
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const tag = node.tagName;
        if (tag === 'BR') return '\n';
        const inner = Array.from(node.childNodes).map(walkInline).join('');
        if (tag === 'STRONG' || tag === 'B') return inner.trim() ? `**${inner}**` : '';
        if (tag === 'EM' || tag === 'I') return inner.trim() ? `*${inner}*` : '';
        if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') return inner.trim() ? `~~${inner}~~` : '';
        if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE') return inner ? `\`${inner}\`` : '';
        if (tag === 'A') {
            const href = node.getAttribute('href') || '';
            return href ? `[${inner || href}](${href})` : inner;
        }
        return inner;
    };

    const lines = [];
    for (const child of Array.from(tmp.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            const t = child.nodeValue.replace(/\u200B/g, '').trim();
            if (t) lines.push(t);
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = child.tagName;
        if (/^H([1-6])$/.test(tag)) {
            const lvl = Number(tag[1]);
            const txt = walkInline(child).trim();
            if (txt) lines.push(`${'#'.repeat(Math.min(6, lvl))} ${txt}`);
        } else if (tag === 'BLOCKQUOTE') {
            const txt = walkInline(child).trim();
            if (txt) lines.push(...txt.split('\n').map(l => `> ${l}`));
        } else if (tag === 'HR') {
            lines.push('---');
        } else if (tag === 'PRE') {
            lines.push('```\n' + (child.textContent || '').replace(/\u200B/g, '').trim() + '\n```');
        } else if (tag === 'UL') {
            child.querySelectorAll(':scope > li').forEach(li => {
                const txt = walkInline(li).trim();
                if (txt) lines.push(`- ${txt}`);
            });
        } else if (tag === 'OL') {
            let idx = 1;
            child.querySelectorAll(':scope > li').forEach(li => {
                const txt = walkInline(li).trim();
                if (txt) lines.push(`${idx++}. ${txt}`);
            });
        } else {
            const txt = walkInline(child).trim();
            if (txt) lines.push(txt);
        }
    }
    return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function sortCardsInReadingOrder(cardList) {
    return cardList.slice().sort((a, b) => {
        const dy = Math.round((a.y || 0) / 80) - Math.round((b.y || 0) / 80);
        if (dy !== 0) return dy;
        return (a.x || 0) - (b.x || 0);
    });
}

async function buildLinearBoardTree(boardId, depth, visited, includeSubboards, allCards, allBoards) {
    if (visited.has(boardId)) return null;
    visited.add(boardId);

    const boardRec = allBoards.find(b => b.id === boardId);
    const subCardRec = allCards.find(c => c.id === boardId);
    const boardTitle = boardId === 'root'
        ? t('mainWorkspaceTitle')
        : (boardRec?.title || subCardRec?.title || t('newBoardTitle'));

    const boardCards = allCards.filter(c => c.boardId === boardId && !c.isTrash && !c.isOnboarding);
    const childrenByCol = new Map();
    const topLevel = [];
    for (const c of boardCards) {
        if (c.columnId && boardCards.some(col => col.id === c.columnId && col.type === 'column')) {
            if (!childrenByCol.has(c.columnId)) childrenByCol.set(c.columnId, []);
            childrenByCol.get(c.columnId).push(c);
        } else {
            topLevel.push(c);
        }
    }
    childrenByCol.forEach(arr => {
        arr.sort((a, b) => ((a.columnOrder ?? a.createdAt ?? 0) - (b.columnOrder ?? b.createdAt ?? 0)));
    });

    const orderedTop = sortCardsInReadingOrder(topLevel);
    const subSections = [];
    if (includeSubboards) {
        for (const c of orderedTop) {
            if (c.type === 'subboard') {
                const sub = await buildLinearBoardTree(c.id, depth + 1, visited, true, allCards, allBoards);
                if (sub) subSections.push(sub);
            }
        }
        // Also check subboards nested inside columns
        for (const c of orderedTop) {
            if (c.type === 'column') {
                const colChildren = childrenByCol.get(c.id) || [];
                for (const ch of colChildren) {
                    if (ch.type === 'subboard') {
                        const sub = await buildLinearBoardTree(ch.id, depth + 1, visited, true, allCards, allBoards);
                        if (sub) subSections.push(sub);
                    }
                }
            }
        }
    }

    return {
        boardId,
        boardTitle,
        depth,
        topLevel: orderedTop,
        childrenByCol,
        subSections
    };
}

function renderLinearCardToMarkdown(card, headingDepth) {
    const h = '#'.repeat(Math.min(6, headingDepth));
    const title = (card.title || '').trim();
    if (card.type === 'sticky') {
        const body = exportHtmlToMarkdown(card.content || '');
        const head = title && title !== t('labelNote') ? `${h} ${title}\n\n` : '';
        return `${head}${body}`.trim();
    }
    if (card.type === 'document') {
        const body = exportHtmlToMarkdown(card.content || '');
        return `${h} ${title || t('newDocTitle')}\n\n${body}`.trim();
    }
    if (card.type === 'task') {
        const rows = (card.tasks || []).map(tk => `- [${tk.completed ? 'x' : ' '}] ${tk.text || ''}`).join('\n');
        return `${h} ${title || t('labelTask')}\n\n${rows}`.trim();
    }
    if (card.type === 'link') {
        const url = card.content || '';
        const desc = card.description ? `\n\n${card.description}` : '';
        return `- [${title || url}](${url})${desc}`.trim();
    }
    if (card.type === 'embed') {
        const url = card.content || card.embedUrl || '';
        return `- [${title || t('labelEmbed')}](${url})`.trim();
    }
    if (card.type === 'comment') {
        const author = card.authorName || 'Comment';
        const body = (card.content || '').trim();
        return `> **${author}**: ${body}`.trim();
    }
    if (card.type === 'table' && card.tableData) {
        const headers = card.tableData.headers || [];
        const rows = card.tableData.rows || [];
        const mdHead = `| ${headers.map(x => String(x || '').replace(/\|/g, '\\|')).join(' | ')} |`;
        const mdSep = `| ${headers.map(() => '---').join(' | ')} |`;
        const mdBody = rows.map(r => `| ${headers.map((_, idx) => String((r && r[idx]) || '').replace(/\|/g, '\\|')).join(' | ')} |`).join('\n');
        const head = title ? `${h} ${title}\n\n` : '';
        return `${head}${mdHead}\n${mdSep}\n${mdBody}`.trim();
    }
    if (card.type === 'image') {
        return `![${title || t('toolImage')}](${card.content && card.content.startsWith('http') ? card.content : sanitizeExportFilename(title || 'image', 'image')})`;
    }
    if (card.type === 'video') {
        return `- ${t('labelVideo')}: ${title || card.content || ''}`.trim();
    }
    if (card.type === 'subboard') {
        return `- **${title || t('newBoardTitle')}**`;
    }
    return '';
}

function renderLinearTreeToMarkdown(node) {
    if (!node) return '';
    const out = [];
    const baseLevel = Math.min(5, node.depth + 1);
    out.push(`${'#'.repeat(baseLevel)} ${node.boardTitle}`);

    for (const card of node.topLevel) {
        if (card.type === 'column') {
            const colTitle = (card.title || t('labelColumn')).trim();
            out.push(`${'#'.repeat(Math.min(6, baseLevel + 1))} ${colTitle}`);
            const children = node.childrenByCol.get(card.id) || [];
            for (const ch of children) {
                const block = renderLinearCardToMarkdown(ch, baseLevel + 2);
                if (block) out.push(block);
            }
        } else {
            const block = renderLinearCardToMarkdown(card, baseLevel + 1);
            if (block) out.push(block);
        }
    }

    for (const sub of node.subSections) {
        const subMd = renderLinearTreeToMarkdown(sub);
        if (subMd) out.push(subMd);
    }
    return out.filter(Boolean).join('\n\n');
}

function renderLinearCardToPlainText(card) {
    const title = (card.title || '').trim();
    if (card.type === 'sticky' || card.type === 'document') {
        const body = stripHtmlToText(card.content || '');
        const head = title && !(card.type === 'sticky' && title === t('labelNote')) ? `${title}\n` : '';
        return `${head}${body}`.trim();
    }
    if (card.type === 'task') {
        const rows = (card.tasks || []).map(tk => `[${tk.completed ? 'x' : ' '}] ${tk.text || ''}`).join('\n');
        return `${title || t('labelTask')}\n${rows}`.trim();
    }
    if (card.type === 'link' || card.type === 'embed') {
        const url = card.content || card.embedUrl || '';
        const desc = card.description ? `\n${card.description}` : '';
        return `${title ? `${title}: ` : ''}${url}${desc}`.trim();
    }
    if (card.type === 'comment') {
        return `${card.authorName || 'Comment'}: ${(card.content || '').trim()}`;
    }
    if (card.type === 'table' && card.tableData) {
        const headers = (card.tableData.headers || []).join('\t');
        const rows = (card.tableData.rows || []).map(r => (r || []).join('\t')).join('\n');
        return `${title ? `${title}\n` : ''}${headers}\n${rows}`.trim();
    }
    if (card.type === 'image' || card.type === 'video' || card.type === 'subboard') {
        return title ? `[${getLocalizedCardLabel(card.type)}] ${title}` : '';
    }
    return '';
}

function renderLinearTreeToPlainText(node) {
    if (!node) return '';
    const out = [];
    const rule = '='.repeat(Math.max(8, Math.min(48, node.boardTitle.length)));
    out.push(`${node.boardTitle}\n${rule}`);

    for (const card of node.topLevel) {
        if (card.type === 'column') {
            const colTitle = (card.title || t('labelColumn')).trim();
            out.push(`\n--- ${colTitle} ---`);
            const children = node.childrenByCol.get(card.id) || [];
            for (const ch of children) {
                const txt = renderLinearCardToPlainText(ch);
                if (txt) out.push(txt);
            }
        } else {
            const txt = renderLinearCardToPlainText(card);
            if (txt) out.push(txt);
        }
    }

    for (const sub of node.subSections) {
        const subTxt = renderLinearTreeToPlainText(sub);
        if (subTxt) out.push('\n' + subTxt);
    }
    return out.filter(Boolean).join('\n\n');
}

function renderLinearCardToWordHtml(card, level) {
    const hTag = `h${Math.min(6, level)}`;
    const title = escapeHtml(card.title || '');
    if (card.type === 'sticky') {
        const rich = markdownToRichHtml(card.content || '');
        const head = title && card.title !== t('labelNote') ? `<${hTag}>${title}</${hTag}>` : '';
        return `${head}<div class="card-block">${rich}</div>`;
    }
    if (card.type === 'document') {
        const rich = markdownToRichHtml(card.content || '');
        return `<${hTag}>${title || escapeHtml(t('newDocTitle'))}</${hTag}><div class="card-block">${rich}</div>`;
    }
    if (card.type === 'task') {
        const items = (card.tasks || []).map(tk =>
            `<li>${tk.completed ? '&#9745; <s>' + escapeHtml(tk.text || '') + '</s>' : '&#9744; ' + escapeHtml(tk.text || '')}</li>`
        ).join('');
        return `<${hTag}>${title || escapeHtml(t('labelTask'))}</${hTag}><ul style="list-style:none;padding-left:8px;">${items}</ul>`;
    }
    if (card.type === 'link' || card.type === 'embed') {
        const url = escapeHtml(card.content || card.embedUrl || '');
        const desc = card.description ? `<br><span style="color:#555;font-size:10pt;">${escapeHtml(card.description)}</span>` : '';
        return `<p><strong><a href="${url}">${title || url}</a></strong>${desc}</p>`;
    }
    if (card.type === 'comment') {
        return `<blockquote><strong>${escapeHtml(card.authorName || 'Comment')}:</strong> ${escapeHtml(card.content || '')}</blockquote>`;
    }
    if (card.type === 'table' && card.tableData) {
        const ths = (card.tableData.headers || []).map(h => `<th>${escapeHtml(h || '')}</th>`).join('');
        const trs = (card.tableData.rows || []).map(r =>
            `<tr>${(card.tableData.headers || []).map((_, idx) => `<td>${escapeHtml((r && r[idx]) || '')}</td>`).join('')}</tr>`
        ).join('');
        return `${title ? `<${hTag}>${title}</${hTag}>` : ''}<table border="1" cellspacing="0" cellpadding="6"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    }
    if (card.type === 'subboard') {
        return `<p><strong>${title || escapeHtml(t('newBoardTitle'))}</strong></p>`;
    }
    if (card.type === 'image' || card.type === 'video') {
        return title ? `<p><em>[${escapeHtml(getLocalizedCardLabel(card.type))}] ${title}</em></p>` : '';
    }
    return '';
}

function renderLinearTreeToWordHtml(node) {
    if (!node) return '';
    const baseLevel = Math.min(5, node.depth + 1);
    const parts = [`<h${baseLevel}>${escapeHtml(node.boardTitle)}</h${baseLevel}>`];

    for (const card of node.topLevel) {
        if (card.type === 'column') {
            parts.push(`<h${Math.min(6, baseLevel + 1)}>${escapeHtml(card.title || t('labelColumn'))}</h${Math.min(6, baseLevel + 1)}>`);
            const children = node.childrenByCol.get(card.id) || [];
            for (const ch of children) {
                const html = renderLinearCardToWordHtml(ch, baseLevel + 2);
                if (html) parts.push(html);
            }
        } else {
            const html = renderLinearCardToWordHtml(card, baseLevel + 1);
            if (html) parts.push(html);
        }
    }

    for (const sub of node.subSections) {
        parts.push('<hr>');
        parts.push(renderLinearTreeToWordHtml(sub));
    }
    return parts.filter(Boolean).join('\n');
}

async function exportLinearMarkdown() {
    closeExportPopover();
    const includeSub = !!document.getElementById('export-include-subboards')?.checked;
    const allCards = await dbGetAll('cards');
    const allBoards = await dbGetAll('boards');
    const tree = await buildLinearBoardTree(currentBoardId, 0, new Set(), includeSub, allCards, allBoards);
    if (!tree) return;
    const md = renderLinearTreeToMarkdown(tree);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    triggerExportBlobDownload(blob, `${sanitizeExportFilename(tree.boardTitle)}.md`);
    showToast(t('exportDoneToast', { format: 'Markdown' }));
}

async function exportLinearPlainText() {
    closeExportPopover();
    const includeSub = !!document.getElementById('export-include-subboards')?.checked;
    const allCards = await dbGetAll('cards');
    const allBoards = await dbGetAll('boards');
    const tree = await buildLinearBoardTree(currentBoardId, 0, new Set(), includeSub, allCards, allBoards);
    if (!tree) return;
    const txt = renderLinearTreeToPlainText(tree);
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    triggerExportBlobDownload(blob, `${sanitizeExportFilename(tree.boardTitle)}.txt`);
    showToast(t('exportDoneToast', { format: 'TXT' }));
}

async function exportLinearWord() {
    closeExportPopover();
    const includeSub = !!document.getElementById('export-include-subboards')?.checked;
    const allCards = await dbGetAll('cards');
    const allBoards = await dbGetAll('boards');
    const tree = await buildLinearBoardTree(currentBoardId, 0, new Set(), includeSub, allCards, allBoards);
    if (!tree) return;
    const bodyHtml = renderLinearTreeToWordHtml(tree);
    const docHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(tree.boardTitle)}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; color: #1f2937; font-size: 11pt; line-height: 1.5; max-width: 720px; margin: 24px auto; }
  h1 { font-size: 20pt; color: #111827; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; }
  h2 { font-size: 15pt; color: #1f2937; margin-top: 18px; }
  h3 { font-size: 12.5pt; color: #374151; margin-top: 14px; }
  blockquote { border-left: 3px solid #9ca3af; padding-left: 10px; color: #4b5563; margin: 10px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  th { background: #f3f4f6; text-align: left; }
  code { background: #f3f4f6; padding: 1px 4px; font-family: Consolas, monospace; font-size: 10pt; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
    const blob = new Blob(['\ufeff', docHtml], { type: 'application/msword;charset=utf-8' });
    triggerExportBlobDownload(blob, `${sanitizeExportFilename(tree.boardTitle)}.doc`);
    showToast(t('exportDoneToast', { format: 'Word' }));
}

// ---------- Offline ZIP Builder (CRC32 + Store) ----------

const VELMAP_CRC_TABLE = (() => {
    const tbl = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        tbl[i] = c >>> 0;
    }
    return tbl;
})();

function crc32Bytes(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) {
        c = VELMAP_CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function buildZipArchiveBlob(fileEntries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of fileEntries) {
        const nameBytes = encoder.encode(entry.name);
        const data = entry.data;
        const crc = crc32Bytes(data);
        const size = data.length;

        const lh = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(lh.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
        lv.setUint16(8, 0, true); // Store
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, size, true);
        lv.setUint32(22, size, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        lh.set(nameBytes, 30);

        const ch = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, size, true);
        cv.setUint32(24, size, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        ch.set(nameBytes, 46);

        localParts.push(lh, data);
        centralParts.push(ch);
        offset += lh.length + size;
    }

    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, fileEntries.length, true);
    ev.setUint16(10, fileEntries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
}

async function exportBoardAssetsZip() {
    closeExportPopover();
    const includeSub = !!document.getElementById('export-include-subboards')?.checked;
    showToast(t('exportPreparing'));
    const { entries } = await collectDownloadableAssetsForExport(includeSub);
    const resolved = [];

    for (const item of entries) {
        let blob = item.blob;
        if (!blob && item.url) {
            try {
                const res = await fetch(item.url, { mode: 'cors' });
                if (res.ok) blob = await res.blob();
            } catch (_) {}
        }
        if (blob) {
            const buf = await blob.arrayBuffer();
            resolved.push({ name: item.name, data: new Uint8Array(buf) });
        }
    }

    if (resolved.length === 0) {
        showToast(t('exportNoFilesToast'));
        return;
    }

    const zipBlob = buildZipArchiveBlob(resolved);
    const boardTitle = await getCurrentBoardExportTitle();
    triggerExportBlobDownload(zipBlob, `${sanitizeExportFilename(boardTitle)}-files.zip`);
    showToast(t('exportDoneToast', { format: 'ZIP' }));
}

// ---------- Board Layout Canvas Renderer (PNG + PDF Standard & High Quality) ----------

function drawRoundedRectPath(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
}

function wrapCanvasLines(ctx, text, maxWidth, maxLines = 100) {
    const rawLines = String(text || '').replace(/\u200B/g, '').split(/\r?\n/);
    const out = [];
    for (const raw of rawLines) {
        if (!raw) {
            out.push('');
            if (out.length >= maxLines) break;
            continue;
        }
        const words = raw.split(/\s+/);
        let cur = '';
        for (const w of words) {
            const test = cur ? `${cur} ${w}` : w;
            if (ctx.measureText(test).width <= maxWidth) {
                cur = test;
            } else {
                if (cur) out.push(cur);
                cur = w;
                if (out.length >= maxLines) break;
            }
        }
        if (out.length >= maxLines) break;
        if (cur) out.push(cur);
        if (out.length >= maxLines) break;
    }
    return out;
}

async function loadExportableImage(card) {
    let url = null;
    let revokeAfter = false;
    if (card.assetId || card.iconAssetId) {
        const asset = await dbGet('assets', card.assetId || card.iconAssetId);
        if (asset && asset.blob) {
            url = URL.createObjectURL(asset.blob);
            revokeAfter = true;
        }
    } else if (card.content && (card.type === 'image' || card.imageUrl)) {
        url = card.type === 'image' ? card.content : card.imageUrl;
    } else if (card.imageUrl) {
        url = card.imageUrl;
    }
    if (!url) return null;

    return await new Promise((resolve) => {
        const img = new Image();
        if (!url.startsWith('blob:') && !url.startsWith('data:')) {
            img.crossOrigin = 'anonymous';
        }
        const cleanup = () => { if (revokeAfter) URL.revokeObjectURL(url); };
        img.onload = () => { cleanup(); resolve(img); };
        img.onerror = () => { cleanup(); resolve(null); };
        img.src = url;
    });
}

async function renderCurrentBoardToCanvas(targetScale = 2) {
    const cardsLayer = document.getElementById('cards-layer');
    const cardEls = cardsLayer ? Array.from(cardsLayer.querySelectorAll(':scope > .interactive-card')) : [];
    if (cardEls.length === 0) {
        showToast(t('exportNoCardsToast'));
        return null;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const rectsById = new Map();

    for (const el of cardEls) {
        const id = el.dataset.id;
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        const w = el.offsetWidth || parseFloat(el.style.width) || 270;
        const h = el.offsetHeight || 160;
        rectsById.set(id, { left: x, top: y, width: w, height: h });
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    }

    // Also include column children in rectsById for connection rendering
    const allDomCards = cardsLayer ? Array.from(cardsLayer.querySelectorAll('.interactive-card')) : [];
    for (const el of allDomCards) {
        const id = el.dataset.id;
        if (rectsById.has(id) || el.offsetParent === null) continue;
        const off = getCanvasRelativeOffset(el);
        rectsById.set(id, {
            left: off.left,
            top: off.top,
            width: el.offsetWidth || 240,
            height: el.offsetHeight || 80
        });
    }

    const pad = 48;
    const worldW = Math.max(320, Math.ceil(maxX - minX + pad * 2));
    const worldH = Math.max(240, Math.ceil(maxY - minY + pad * 2));
    const originX = minX - pad;
    const originY = minY - pad;

    const maxDim = 4200;
    const clampedScale = Math.min(targetScale, maxDim / worldW, maxDim / worldH);
    const scale = Math.max(0.5, clampedScale);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(worldW * scale);
    canvas.height = Math.round(worldH * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // 1. Board Background
    const boardRec = await dbGet('boards', currentBoardId);
    const bgColor = (boardRec?.bgStyle?.color) || '#131316';
    const bgPattern = (boardRec?.bgStyle?.pattern) || 'dots';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, worldW, worldH);

    if (bgPattern === 'dots') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        for (let gx = 16; gx < worldW; gx += 24) {
            for (let gy = 16; gy < worldH; gy += 24) {
                ctx.beginPath();
                ctx.arc(gx, gy, 1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    } else if (bgPattern === 'grid') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let gx = 0; gx < worldW; gx += 28) {
            ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, worldH); ctx.stroke();
        }
        for (let gy = 0; gy < worldH; gy += 28) {
            ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(worldW, gy); ctx.stroke();
        }
    }

    // 2. Connections SVG Layer
    for (const conn of (connections || [])) {
        const fromEl = resolveVisibleConnectionEl(conn.fromId);
        const toEl = resolveVisibleConnectionEl(conn.toId);
        if (!fromEl || !toEl) continue;
        const fromRect = rectsById.get(fromEl.dataset.id) || getCardConnectionBounds(fromEl);
        const toRect = rectsById.get(toEl.dataset.id) || getCardConnectionBounds(toEl);
        if (!fromRect || !toRect) continue;

        const geom = buildConnectionGeometry(conn, fromRect, toRect);
        const sx = geom.start.x - originX;
        const sy = geom.start.y - originY;
        const cx = geom.control.x - originX;
        const cy = geom.control.y - originY;
        const ex = geom.end.x - originX;
        const ey = geom.end.y - originY;

        const color = conn.color || '#71717a';
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = conn.weight || 2;
        ctx.lineCap = 'round';
        if (conn.isDashed) ctx.setLineDash([7, 7]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(cx, cy, ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);

        const drawArrow = (tipX, tipY, refX, refY) => {
            const angle = Math.atan2(tipY - refY, tipX - refX);
            const len = 10 + (conn.weight || 2);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - len * Math.cos(angle - Math.PI / 7), tipY - len * Math.sin(angle - Math.PI / 7));
            ctx.lineTo(tipX - len * Math.cos(angle + Math.PI / 7), tipY - len * Math.sin(angle + Math.PI / 7));
            ctx.closePath();
            ctx.fill();
        };
        if (conn.startMarker === 'arrow') drawArrow(sx, sy, cx, cy);
        if (conn.endMarker !== 'none') drawArrow(ex, ey, cx, cy);

        if (conn.label) {
            const lx = 0.25 * sx + 0.5 * cx + 0.25 * ex;
            const ly = 0.25 * sy + 0.5 * cy + 0.25 * ey;
            ctx.font = '600 11px Inter, sans-serif';
            const tw = ctx.measureText(conn.label).width;
            drawRoundedRectPath(ctx, lx - tw / 2 - 8, ly - 10, tw + 16, 20, 4);
            ctx.fillStyle = '#18181b';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#e4e4e7';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(conn.label, lx, ly);
        }
        ctx.restore();
    }

    // 3. Draw Cards Helper (Top-level and column children)
    const drawSingleCard = async (card, box, inCol = false) => {
        const x = box.left - originX;
        const y = box.top - originY;
        const w = box.width;
        const h = box.height;

        ctx.save();
        if (card.type === 'image') {
            const img = await loadExportableImage(card);
            if (img) {
                drawRoundedRectPath(ctx, x, y, w, h, inCol ? 4 : 2);
                ctx.clip();
                ctx.drawImage(img, x, y, w, h);
            } else {
                drawRoundedRectPath(ctx, x, y, w, h, 6);
                ctx.fillStyle = '#202024';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                ctx.stroke();
                ctx.fillStyle = '#a1a1aa';
                ctx.font = '500 12px Inter, sans-serif';
                ctx.fillText(card.title || t('toolImage'), x + 12, y + h / 2);
            }
            ctx.restore();
            return;
        }

        if (card.type === 'subboard' && !inCol) {
            const sqSize = 96;
            const sqX = x + (w - sqSize) / 2;
            drawRoundedRectPath(ctx, sqX, y, sqSize, sqSize, 26);
            ctx.fillStyle = card.color || '#78787a';
            ctx.fill();
            if (card.iconAssetId) {
                const icImg = await loadExportableImage({ iconAssetId: card.iconAssetId });
                if (icImg) {
                    ctx.save();
                    drawRoundedRectPath(ctx, sqX, y, sqSize, sqSize, 26);
                    ctx.clip();
                    ctx.drawImage(icImg, sqX, y, sqSize, sqSize);
                    ctx.restore();
                }
            }
            ctx.fillStyle = '#e4e4e7';
            ctx.font = '600 13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(card.title || t('newBoardTitle'), x + w / 2, y + sqSize + 24, w + 16);
            ctx.restore();
            return;
        }

        if (card.type === 'document' && !inCol) {
            const shW = 88, shH = 108;
            const shX = x + (w - shW) / 2;
            drawRoundedRectPath(ctx, shX, y, shW, shH, 6);
            ctx.fillStyle = '#202024';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.stroke();
            ctx.fillStyle = '#e4e4e7';
            ctx.font = '600 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(card.title || t('newDocTitle'), x + w / 2, y + shH + 22, w + 28);
            ctx.restore();
            return;
        }

        // Card container background
        drawRoundedRectPath(ctx, x, y, w, h, 6);
        ctx.fillStyle = (card.type === 'subboard' || card.type === 'document') && inCol
            ? '#212126'
            : (card.type === 'column' ? '#1b1b1f' : '#202024');
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        if ((card.type === 'subboard' || card.type === 'document') && inCol) {
            const iconX = x + 12;
            const iconY = y + (h - 44) / 2;
            drawRoundedRectPath(ctx, iconX, iconY, 44, 44, card.type === 'subboard' ? 10 : 5);
            ctx.fillStyle = card.type === 'subboard' ? (card.color || '#78787a') : '#18181c';
            ctx.fill();
            if (card.type === 'subboard' && card.iconAssetId) {
                const icImg = await loadExportableImage({ iconAssetId: card.iconAssetId });
                if (icImg) {
                    ctx.save();
                    drawRoundedRectPath(ctx, iconX, iconY, 44, 44, 10);
                    ctx.clip();
                    ctx.drawImage(icImg, iconX, iconY, 44, 44);
                    ctx.restore();
                }
            }
            ctx.fillStyle = '#f4f4f5';
            ctx.font = '600 13px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(card.title || getLocalizedCardLabel(card.type), iconX + 56, y + h / 2 - 4, w - 80);
            ctx.fillStyle = '#a1a1aa';
            ctx.font = '400 11px Inter, sans-serif';
            let subLabel = '';
            if (card.type === 'document') {
                const wc = stripHtmlToText(card.content || '').trim().split(/\s+/).filter(Boolean).length;
                subLabel = `${wc} ${wc === 1 ? t('wordSingular') : t('wordPlural')}`;
            } else {
                const bc = (allSystemCards || []).filter(ch => ch.boardId === card.id && !ch.isTrash);
                const bCnt = bc.filter(ch => ch.type === 'subboard').length;
                const dCnt = bc.filter(ch => ch.type === 'document').length;
                const cCnt = bc.length - bCnt - dCnt;
                const parts = [];
                if (cCnt > 0 || bc.length === 0) parts.push(`${cCnt} ${cCnt === 1 ? t('cardSingular') : t('cardPlural')}`);
                if (bCnt > 0) parts.push(`${bCnt} ${bCnt === 1 ? t('boardSingular') : t('boardPlural')}`);
                if (dCnt > 0) parts.push(`${dCnt} ${dCnt === 1 ? t('docSingular') : t('docPlural')}`);
                subLabel = parts.join(', ');
            }
            ctx.fillText(subLabel, iconX + 56, y + h / 2 + 13, w - 80);
            ctx.restore();
            return;
        }

        if (card.type === 'column') {
            const colChildren = (cards || []).filter(ch => ch.columnId === card.id && !ch.isTrash);
            const cb = colChildren.filter(ch => ch.type === 'subboard').length;
            const cd = colChildren.filter(ch => ch.type === 'document').length;
            const co = colChildren.length - cb - cd;
            const cParts = [];
            if (cb > 0) cParts.push(`${cb} ${cb === 1 ? t('boardSingular') : t('boardPlural')}`);
            if (cd > 0) cParts.push(`${cd} ${cd === 1 ? t('docSingular') : t('docPlural')}`);
            if (co > 0) cParts.push(`${co} ${co === 1 ? t('cardSingular') : t('cardPlural')}`);
            const colSub = cParts.join(', ');

            ctx.fillStyle = '#f4f4f5';
            ctx.font = '600 14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(card.title || t('labelColumn'), x + w / 2, colSub ? y + 25 : y + 32, w - 48);
            if (colSub) {
                ctx.fillStyle = '#a1a1aa';
                ctx.font = '400 11px Inter, sans-serif';
                ctx.fillText(colSub, x + w / 2, y + 43, w - 48);
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.beginPath(); ctx.moveTo(x, y + 60); ctx.lineTo(x + w, y + 60); ctx.stroke();
            ctx.restore();
            return;
        }

        // Standard card header & body
        ctx.fillStyle = '#e4e4e7';
        ctx.font = '600 12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(card.title || getLocalizedCardLabel(card.type), x + 12, y + 22, w - 24);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath(); ctx.moveTo(x, y + 34); ctx.lineTo(x + w, y + 34); ctx.stroke();

        ctx.fillStyle = '#d4d4d8';
        ctx.font = '400 12px Inter, sans-serif';
        let bodyText = '';
        if (card.type === 'task') {
            bodyText = (card.tasks || []).map(tk => `${tk.completed ? '[x]' : '[ ]'} ${tk.text || ''}`).join('\n');
        } else if (card.type === 'link') {
            bodyText = `${card.content || ''}${card.description ? '\n' + card.description : ''}`;
        } else if (card.type === 'table' && card.tableData) {
            bodyText = [
                (card.tableData.headers || []).join(' | '),
                ...(card.tableData.rows || []).map(r => (r || []).join(' | '))
            ].join('\n');
        } else {
            bodyText = stripHtmlToText(card.content || '');
        }
        const wrapped = wrapCanvasLines(ctx, bodyText, w - 24, Math.max(1, Math.floor((h - 46) / 17)));
        wrapped.forEach((line, idx) => {
            ctx.fillText(line, x + 12, y + 52 + idx * 17, w - 24);
        });
        ctx.restore();
    };

    const topIds = cardEls.map(el => el.dataset.id);
    const orderedTop = topIds
        .map(id => cards.find(c => c.id === id))
        .filter(Boolean)
        .sort((a, b) => (a.zIndex || 10) - (b.zIndex || 10));

    for (const card of orderedTop) {
        const box = rectsById.get(card.id);
        if (!box) continue;
        await drawSingleCard(card, box, false);

        if (card.type === 'column' && !card.collapsed) {
            const colEl = cardEls.find(el => el.dataset.id === card.id);
            const childEls = colEl ? Array.from(colEl.querySelectorAll('.column-child-item')) : [];
            for (const chEl of childEls) {
                const chCard = cards.find(c => c.id === chEl.dataset.id);
                const chBox = rectsById.get(chEl.dataset.id);
                if (chCard && chBox) {
                    await drawSingleCard(chCard, chBox, true);
                }
            }
        }
    }

    return canvas;
}

async function exportCurrentBoardPng() {
    closeExportPopover();
    showToast(t('exportPreparing'));
    const canvas = await renderCurrentBoardToCanvas(2);
    if (!canvas) return;
    const boardTitle = await getCurrentBoardExportTitle();
    canvas.toBlob((blob) => {
        if (!blob) return;
        triggerExportBlobDownload(blob, `${sanitizeExportFilename(boardTitle)}.png`);
        showToast(t('exportDoneToast', { format: 'PNG' }));
    }, 'image/png');
}

function buildSinglePagePdfFromJpeg(jpegBytes, pxWidth, pxHeight) {
    // Scale page dimensions in PDF points (72 dpi) cleanly
    const pageW = Math.round(pxWidth * 0.75 * 100) / 100;
    const pageH = Math.round(pxHeight * 0.75 * 100) / 100;
    const encoder = new TextEncoder();
    const parts = [];
    const offsets = [0];
    let byteLen = 0;

    const pushBytes = (u8) => { parts.push(u8); byteLen += u8.length; };
    const pushStr = (s) => pushBytes(encoder.encode(s));

    pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

    offsets.push(byteLen);
    pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    offsets.push(byteLen);
    pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

    offsets.push(byteLen);
    pushStr(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);

    offsets.push(byteLen);
    pushStr(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxWidth} /Height ${pxHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
    pushBytes(jpegBytes);
    pushStr('\nendstream\nendobj\n');

    const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
    offsets.push(byteLen);
    pushStr(`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`);

    const xrefStart = byteLen;
    pushStr(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    for (let i = 1; i < offsets.length; i++) {
        pushStr(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
    }
    pushStr(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    return new Blob(parts, { type: 'application/pdf' });
}

async function exportCurrentBoardPdf(qualityMode = 'standard') {
    closeExportPopover();
    showToast(t('exportPreparing'));
    const isHigh = qualityMode === 'high';
    const canvas = await renderCurrentBoardToCanvas(isHigh ? 2.4 : 1.25);
    if (!canvas) return;
    const jpegQuality = isHigh ? 0.94 : 0.72;
    const jpegBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', jpegQuality));
    if (!jpegBlob) return;
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const pdfBlob = buildSinglePagePdfFromJpeg(jpegBytes, canvas.width, canvas.height);
    const boardTitle = await getCurrentBoardExportTitle();
    triggerExportBlobDownload(pdfBlob, `${sanitizeExportFilename(boardTitle)}.pdf`);
    showToast(t('exportDoneToast', { format: 'PDF' }));
}
