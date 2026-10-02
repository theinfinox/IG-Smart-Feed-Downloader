importScripts('libs/jszip.min.js');

let dlState = { 
    sessionFolder: '', 
    urls: {}, 
    zipMode: true, 
    speedMode: 'turbo', 
    autoHarvest: true, 
    autoClearCompleted: false,
    scrollDelayMs: 300,
    scrollToTop: false
};
let downloadStatus = 'idle'; // 'idle' | 'running' | 'paused'
let isPaused = false;
let stopDownloading = false;
let debugLogs = [];

let activeZip = null;
let activeFolder = '';
let totalBufferedImages = 0;
let isZipActive = false;
let workerTabId = null;

function addLog(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    debugLogs.push(line);
    if (debugLogs.length > 500) debugLogs.shift();
    console.log('[IGBulkExt]', line);
}

// Load preferences from storage (urls remain strictly ephemeral in-memory)
chrome.storage.local.get(['igbdl_state'], function(result) {
    if (result.igbdl_state) {
        const { urls, sessionFolder, ...savedPrefs } = result.igbdl_state;
        dlState = Object.assign({ 
            sessionFolder: '',
            urls: {},
            zipMode: true, 
            speedMode: 'turbo', 
            autoHarvest: true, 
            autoClearCompleted: false,
            scrollDelayMs: 300,
            scrollToTop: false
        }, savedPrefs);
        addLog(`Loaded preferences (speed: ${dlState.speedMode}, zip: ${dlState.zipMode}) - Fresh ephemeral queue`);
    }
});

function saveState() {
    // Only persist preferences to disk; urls live strictly in memory for active view
    const { urls, sessionFolder, ...prefsToSave } = dlState;
    chrome.storage.local.set({ igbdl_state: prefsToSave });
    chrome.runtime.sendMessage({ 
        type: "STATE_UPDATED", 
        state: dlState, 
        downloadStatus: downloadStatus 
    }).catch(() => {});
}

function createNewSessionFolder() {
    const d = new Date();
    const pad = n => n.toString().padStart(2, '0');
    return `IG_Images_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function sanitizeFolderName(caption, shortcode) {
    if (!caption) return `Post_${shortcode}`;
    let clean = caption.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
    clean = clean.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').trim();
    clean = clean.substring(0, 35).trim();
    clean = clean.replace(/[. ]+$/, '');
    if (!clean) return `Post_${shortcode}`;
    return clean;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ── Tab Lifecycle Helpers ──
function waitForTabReady(tabId) {
    return new Promise(resolve => {
        let isDone = false;
        const listener = (id, info) => {
            if (id === tabId && info.status === 'complete') {
                if (!isDone) {
                    isDone = true;
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
            if (!isDone) {
                isDone = true;
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        }, 12000);
    });
}

// ── Offscreen Document Helper for Manifest V3 ZIP Downloads ──
async function ensureOffscreenDocument() {
    if (!chrome.offscreen) return false;
    try {
        if (chrome.offscreen.hasDocument) {
            const has = await chrome.offscreen.hasDocument();
            if (has) return true;
        }
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['BLOBS'],
            justification: 'Create Blob URL for downloading ZIP archives'
        });
        return true;
    } catch (e) {
        if (e.message && e.message.includes('Only a single offscreen document may be created')) {
            return true;
        }
        addLog(`Offscreen helper note: ${e.message}`);
        return false;
    }
}

// Finds an existing open Instagram tab or launches ONE single reusable worker tab
async function getInstagramTab() {
    const tabs = await chrome.tabs.query({ url: "*://*.instagram.com/*" });
    if (tabs && tabs.length > 0) {
        return tabs[0].id;
    }
    
    if (workerTabId) {
        try {
            const t = await chrome.tabs.get(workerTabId);
            if (t) return workerTabId;
        } catch(e) {
            workerTabId = null;
        }
    }
    
    addLog("No active Instagram tab found. Spawning 1 persistent worker tab...");
    const tab = await chrome.tabs.create({ url: "https://www.instagram.com/", active: false });
    workerTabId = tab.id;
    await waitForTabReady(workerTabId);
    await sleep(2000);
    return workerTabId;
}

// Resilient message sender: auto-injects feed_collector.js if tab was open before reload
async function sendToCollector(tabId, message) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, message, async (res) => {
            if (chrome.runtime.lastError) {
                const err = chrome.runtime.lastError.message;
                if (err.includes("Receiving end does not exist")) {
                    addLog(`Re-injecting feed_collector.js into tab ${tabId}...`);
                    try {
                        await chrome.scripting.executeScript({
                            target: { tabId: tabId },
                            files: ["feed_collector.js"]
                        });
                        await sleep(400);
                        chrome.tabs.sendMessage(tabId, message, (retryRes) => {
                            if (chrome.runtime.lastError) {
                                addLog(`Retry note: ${chrome.runtime.lastError.message}`);
                                resolve(null);
                            } else {
                                resolve(retryRes);
                            }
                        });
                        return;
                    } catch(e) {
                        addLog(`Failed to re-inject: ${e.message}`);
                        resolve(null);
                        return;
                    }
                }
                addLog(`Bridge note: ${err}`);
                resolve(null);
                return;
            }
            resolve(res);
        });
    });
}

// ── Tier 1: Page-Context Authenticated API Bridge (~150ms) ──
async function extractFromApi(shortcode) {
    const tabId = await getInstagramTab();
    if (!tabId) return null;
    
    // Ensure clean 11-character shortcode
    const cleanCode = shortcode.length > 11 ? shortcode.substring(0, 11) : shortcode;
    
    const res = await sendToCollector(tabId, { type: "FETCH_MEDIA_API", shortcode: cleanCode });
    if (!res || !res.success || !res.data) {
        if (res?.rateLimit) {
            throw new Error("RATE_LIMIT_DETECTED");
        }
        return null;
    }
    
    const item = res.data.items?.[0];
    if (!item) return null;
    
    const isVideo = item.media_type === 2;
    const caption = item.caption?.text || "";
    let images = [];
    
    if (item.carousel_media && item.carousel_media.length > 0) {
        for (const sub of item.carousel_media) {
            if (sub.media_type !== 2) {
                const candidates = sub.image_versions2?.candidates || [];
                if (candidates.length > 0) {
                    images.push(candidates[0].url);
                }
            }
        }
    } else if (!isVideo) {
        const candidates = item.image_versions2?.candidates || [];
        if (candidates.length > 0) {
            images.push(candidates[0].url);
        }
    }
    
    return {
        images,
        caption,
        is_video: isVideo
    };
}

// ── Tier 2: Static HTML Extraction (~400ms) ──
function extractFromHtml(html) {
    const scripts = html.match(/<script type="application\/json"[^>]*>(.*?)<\/script>/g);
    if (!scripts) return null;
    
    for (const s of scripts) {
        if (s.includes('xdt_shortcode_media')) {
            try {
                const inner = s.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
                const json = JSON.parse(inner);
                const findMedia = (obj) => {
                    if (!obj || typeof obj !== 'object') return null;
                    if (obj.xdt_shortcode_media) return obj.xdt_shortcode_media;
                    for (const key in obj) {
                        const res = findMedia(obj[key]);
                        if (res) return res;
                    }
                    return null;
                };
                const mediaObj = findMedia(json);
                if (mediaObj) return mediaObj;
            } catch(e) {}
        }
    }
    return null;
}

// ── Tier 3: Ghost Tab Extraction (Safety Net Fallback) ──
async function extractFromGhostTab(url) {
    return new Promise(async (resolve, reject) => {
        let tabId = null;
        let isResolved = false;
        
        const listener = (message, sender) => {
            if (sender.tab && sender.tab.id === tabId && message.type === "EXTRACTOR_RESULT") {
                if (!isResolved) {
                    isResolved = true;
                    chrome.runtime.onMessage.removeListener(listener);
                    chrome.tabs.remove(tabId).catch(() => {});
                    if (message.success) resolve(message);
                    else reject(new Error(message.error || 'Extractor failed'));
                }
            }
        };
        chrome.runtime.onMessage.addListener(listener);

        try {
            addLog(`GhostTab: Spawning tab for ${url}`);
            const tab = await chrome.tabs.create({ url: url, active: false });
            tabId = tab.id;
            
            await waitForTabReady(tabId);
            await sleep(1500);
            
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ["extractor.js"]
            });
            
            setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    chrome.runtime.onMessage.removeListener(listener);
                    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
                    reject(new Error("Ghost tab extraction timed out (25s)"));
                }
            }, 25000);
            
        } catch (e) {
            if (!isResolved) {
                isResolved = true;
                chrome.runtime.onMessage.removeListener(listener);
                if (tabId) chrome.tabs.remove(tabId).catch(() => {});
                reject(e);
            }
        }
    });
}

function broadcastStatus(msg) {
    addLog(msg);
    chrome.runtime.sendMessage({ 
        type: "STATUS_MSG", 
        msg: msg, 
        downloadStatus: downloadStatus 
    }).catch(() => {});
}

// ── Process a Single Post with Tiered Architecture ──
async function processSinglePost(url, index, total) {
    if (url.includes('/reel/') || url.includes('/tv/')) {
        addLog(`Skipping Reel/Video URL: ${url}`);
        if (dlState.urls[url]) dlState.urls[url].status = 'skipped';
        saveState();
        return;
    }
    
    // Strict 11-char shortcode normalization
    const match = url.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    let rawCode = match ? match[1] : "post";
    const shortcode = rawCode.length > 11 ? rawCode.substring(0, 11) : rawCode;
    const cleanPostUrl = `https://www.instagram.com/p/${shortcode}/`;
    
    broadcastStatus(`[${index+1}/${total}] Extracting ${shortcode}...`);
    
    let finalImages = [];
    let finalCaption = "";
    let isVideo = false;
    
    // ── Tier 1: Instant Page-Context API (~150ms) ──
    try {
        const apiData = await extractFromApi(shortcode);
        if (apiData) {
            finalImages = apiData.images;
            finalCaption = apiData.caption;
            isVideo = apiData.is_video;
            addLog(`⚡ Tier 1 Bridge Success for ${shortcode}: ${finalImages.length} images, is_video: ${isVideo}`);
        }
    } catch(apiErr) {
        if (apiErr.message === "RATE_LIMIT_DETECTED") throw apiErr;
        addLog(`Tier 1 note: ${apiErr.message}`);
    }
    
    // ── Tier 2: Static HTML Extract (if Tier 1 was empty) ──
    if (finalImages.length === 0 && !isVideo) {
        try {
            addLog(`Tier 2: Checking HTML shell for ${shortcode}...`);
            const targetUrl = `https://www.instagram.com/p/${shortcode}/`;
            const response = await fetch(targetUrl);
            if (response.ok) {
                const html = await response.text();
                
                if (html.includes('"message":"feedback_required"') || html.includes('<title>Login')) {
                    throw new Error("RATE_LIMIT_DETECTED");
                }
                
                const mediaObj = extractFromHtml(html);
                if (mediaObj) {
                    isVideo = mediaObj.is_video === true;
                    if (!isVideo || mediaObj.edge_sidecar_to_children) {
                        finalCaption = mediaObj.edge_media_to_caption?.edges?.[0]?.node?.text || "";
                        if (mediaObj.edge_sidecar_to_children?.edges) {
                            for (const edge of mediaObj.edge_sidecar_to_children.edges) {
                                if (edge.node.is_video !== true) finalImages.push(edge.node.display_url);
                            }
                        } else if (!isVideo) {
                            finalImages.push(mediaObj.display_url);
                        }
                        addLog(`Tier 2 HTML Success: ${finalImages.length} images`);
                    }
                }
            }
        } catch(htmlErr) {
            if (htmlErr.message === "RATE_LIMIT_DETECTED") throw htmlErr;
            addLog(`Tier 2 note: ${htmlErr.message}`);
        }
    }
    
    // ── Tier 3: Ghost Tab Extractor (Safety Fallback) ──
    if (finalImages.length === 0 && !isVideo) {
        addLog(`Tier 3: Spawning Ghost Tab fallback for ${shortcode}...`);
        broadcastStatus(`[${index+1}/${total}] Fallback: Ghost Tab for ${shortcode}...`);
        const targetUrl = `https://www.instagram.com/p/${shortcode}/`;
        const data = await extractFromGhostTab(targetUrl);
        isVideo = data.is_video;
        finalCaption = data.caption;
        finalImages = data.images;
        addLog(`Tier 3 Tab Success: ${finalImages.length} images`);
    }
    
    if (isVideo && finalImages.length === 0) {
        addLog(`Skipped: Post is video only`);
        if (dlState.urls[url]) dlState.urls[url].status = 'skipped';
        if (dlState.urls[cleanPostUrl]) dlState.urls[cleanPostUrl].status = 'skipped';
        saveState();
        return;
    }
    
    if (finalImages.length === 0) {
        addLog(`No valid images found for ${shortcode}`);
        if (dlState.urls[url]) dlState.urls[url].status = 'skipped';
        if (dlState.urls[cleanPostUrl]) dlState.urls[cleanPostUrl].status = 'skipped';
        saveState();
        return;
    }
    
    const subfolder = sanitizeFolderName(finalCaption, shortcode);
    
    // ── High Speed Parallel Image Fetching ──
    if (isZipActive && activeZip) {
        broadcastStatus(`[${index+1}/${total}] Buffering ${finalImages.length} image(s) in parallel...`);
        
        const fetchResults = await Promise.all(
            finalImages.map(async (imgUrl, j) => {
                const imgRes = await fetch(imgUrl);
                if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
                const arrayBuf = await imgRes.arrayBuffer();
                const zipPath = finalImages.length > 1 
                    ? `${subfolder}/${j+1}.jpg`
                    : `${shortcode}.jpg`;
                return { zipPath, arrayBuf };
            })
        );
        
        for (const { zipPath, arrayBuf } of fetchResults) {
            activeZip.file(zipPath, arrayBuf);
            totalBufferedImages++;
        }
        addLog(`Buffered ${fetchResults.length} images into ZIP -> ${subfolder}`);
    } else {
        for (let j = 0; j < finalImages.length; j++) {
            if (stopDownloading) break;
            const imgUrl = finalImages[j];
            const fileName = finalImages.length > 1 
                ? `${activeFolder}/${subfolder}/${j+1}.jpg`
                : `${activeFolder}/${shortcode}.jpg`;
            
            await new Promise((resolve, reject) => {
                chrome.downloads.download({
                    url: imgUrl,
                    filename: fileName,
                    saveAs: false,
                    conflictAction: 'overwrite'
                }, (downloadId) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve();
                });
            });
            await sleep(250);
        }
    }
    
    if (dlState.urls[url]) dlState.urls[url].status = 'success';
    if (dlState.urls[cleanPostUrl]) dlState.urls[cleanPostUrl].status = 'success';
    saveState();
    addLog(`Finished ${shortcode} successfully`);
}

// ── Download Loop Engine ──
async function runDownloader(retryMode) {
    if (downloadStatus === 'running') return;
    
    if (downloadStatus === 'paused') {
        isPaused = false;
        downloadStatus = 'running';
        broadcastStatus("▶️ Resumed downloading...");
        return;
    }
    
    downloadStatus = 'running';
    isPaused = false;
    stopDownloading = false;
    
    activeFolder = createNewSessionFolder();
    dlState.sessionFolder = activeFolder;
    saveState();
    
    const speed = dlState.speedMode || 'turbo';
    addLog(`=== START DOWNLOAD RUN (speed: ${speed}, retry: ${retryMode}) ===`);
    broadcastStatus(`Starting ${speed.toUpperCase()} speed run...`);
    
    const urlsToProcess = Object.keys(dlState.urls).filter(url => {
        const status = dlState.urls[url].status;
        return status === 'pending' || (retryMode && status === 'failed' && dlState.urls[url].retries < 3);
    });
    
    addLog(`URLs in work queue: ${urlsToProcess.length}`);
    if (urlsToProcess.length === 0) {
        broadcastStatus("Done. No pending URLs to download.");
        downloadStatus = 'idle';
        saveState();
        return;
    }
    
    isZipActive = !!dlState.zipMode && urlsToProcess.length > 1;
    activeZip = isZipActive ? new JSZip() : null;
    totalBufferedImages = 0;
    
    const postDelay = speed === 'balanced' ? 2200 : (speed === 'extreme' ? 250 : 550);
    
    if (speed === 'extreme') {
        const CONCURRENCY = 3;
        for (let i = 0; i < urlsToProcess.length; i += CONCURRENCY) {
            while (isPaused && !stopDownloading) await sleep(500);
            if (stopDownloading) break;
            
            const batch = urlsToProcess.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (url, idx) => {
                if (stopDownloading) return;
                try {
                    await processSinglePost(url, i + idx, urlsToProcess.length);
                } catch(err) {
                    if (err.message === "RATE_LIMIT_DETECTED") {
                        broadcastStatus("⚠️ PAUSED: Instagram Rate Limit / Login block detected. Click Resume to continue.");
                        isPaused = true;
                        downloadStatus = 'paused';
                        saveState();
                    } else {
                        addLog(`Error processing ${url}: ${err.message}`);
                        if (dlState.urls[url]) {
                            dlState.urls[url].status = 'failed';
                            dlState.urls[url].retries = (dlState.urls[url].retries || 0) + 1;
                            saveState();
                        }
                    }
                }
            }));
            
            if (i + CONCURRENCY < urlsToProcess.length && !stopDownloading) {
                await sleep(postDelay);
            }
        }
    } else {
        for (let i = 0; i < urlsToProcess.length; i++) {
            while (isPaused && !stopDownloading) await sleep(500);
            if (stopDownloading) break;
            
            const url = urlsToProcess[i];
            if (!dlState.urls || !dlState.urls[url]) continue;
            
            try {
                await processSinglePost(url, i, urlsToProcess.length);
            } catch(err) {
                if (err.message === "RATE_LIMIT_DETECTED") {
                    broadcastStatus("⚠️ PAUSED: Instagram Rate Limit / Login block detected. Click Resume to continue.");
                    isPaused = true;
                    downloadStatus = 'paused';
                    saveState();
                    while (isPaused && !stopDownloading) await sleep(500);
                    if (stopDownloading) break;
                    i--;
                    continue;
                } else {
                    addLog(`Error processing ${url}: ${err.message}`);
                    if (dlState.urls[url]) {
                        dlState.urls[url].status = 'failed';
                        dlState.urls[url].retries = (dlState.urls[url].retries || 0) + 1;
                        saveState();
                    }
                }
            }
            
            if (i < urlsToProcess.length - 1 && !stopDownloading) {
                await sleep(postDelay);
            }
        }
    }
    
    // Generate and trigger single ZIP download
    if (isZipActive && activeZip && totalBufferedImages > 0) {
        broadcastStatus(`📦 Compiling ${totalBufferedImages} images into ZIP archive...`);
        addLog(`Compiling ZIP with ${totalBufferedImages} files...`);
        try {
            const base64Data = await activeZip.generateAsync({ 
                type: 'base64',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });
            const zipFileName = `${activeFolder}.zip`;
            const estMb = ((base64Data.length * 0.75) / (1024 * 1024)).toFixed(2);
            addLog(`Compiled ZIP (${estMb} MB). Triggering download: ${zipFileName}...`);
            
            let downloadSuccess = false;
            
            // Method 1: Offscreen Document Helper (Standard MV3 Blob URL)
            try {
                const offscreenReady = await ensureOffscreenDocument();
                if (offscreenReady) {
                    const res = await new Promise((resolve) => {
                        chrome.runtime.sendMessage({
                            type: "OFFSCREEN_DOWNLOAD_ZIP",
                            base64Data: base64Data,
                            filename: zipFileName
                        }, (resp) => {
                            if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
                            else resolve(resp || { ok: false, error: "No response from offscreen" });
                        });
                    });
                    
                    if (res && res.ok) {
                        downloadSuccess = true;
                        addLog(`ZIP download successfully triggered via Offscreen Helper (ID: ${res.downloadId})`);
                    } else {
                        addLog(`Offscreen download note: ${res?.error || 'unknown'}, trying fallback...`);
                    }
                }
            } catch(offErr) {
                addLog(`Offscreen method note: ${offErr.message}, trying fallback...`);
            }
            
            // Method 2: Direct Base64 Data URI Fallback
            if (!downloadSuccess) {
                addLog("Using direct base64 data URI fallback for ZIP download...");
                const dataUrl = `data:application/zip;base64,${base64Data}`;
                await new Promise((resolve, reject) => {
                    chrome.downloads.download({
                        url: dataUrl,
                        filename: zipFileName,
                        saveAs: false,
                        conflictAction: 'overwrite'
                    }, (downloadId) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            addLog(`ZIP download triggered via Data URI (ID: ${downloadId})`);
                            resolve();
                        }
                    });
                });
            }
            
            broadcastStatus(`✅ ZIP downloaded: ${zipFileName}`);
        } catch(zipErr) {
            addLog(`Failed to compile ZIP: ${zipErr.message}`);
            broadcastStatus(`❌ ZIP Error: ${zipErr.message}`);
        }
    }
    
    if (workerTabId) {
        chrome.tabs.remove(workerTabId).catch(() => {});
        workerTabId = null;
    }
    
    if (!isPaused) {
        downloadStatus = 'idle';
        activeZip = null;
        totalBufferedImages = 0;
        dlState.sessionFolder = '';
        
        // Auto-clear completed posts if user enabled this preference
        if (dlState.autoClearCompleted) {
            let clearedCount = 0;
            for (const u of Object.keys(dlState.urls)) {
                const st = dlState.urls[u].status;
                if (st === 'success' || st === 'skipped') {
                    delete dlState.urls[u];
                    clearedCount++;
                }
            }
            if (clearedCount > 0) {
                addLog(`🧹 Auto-cleared ${clearedCount} completed items from queue.`);
            }
        }
        
        saveState();
        broadcastStatus(stopDownloading ? "⏹️ Stopped." : (isZipActive ? "✅ ZIP download complete!" : "✅ All downloads complete!"));
    }
    
    addLog(`=== DOWNLOAD RUN ENDED (status: ${downloadStatus}) ===`);
}

// ── Message Router ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "NEW_URLS") {
        let updated = false;
        (request.urls || []).forEach(u => {
            const m = u.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
            if (m) {
                const type = m[1];
                let rawCode = m[2];
                const cleanCode = rawCode.length > 11 ? rawCode.substring(0, 11) : rawCode;
                const normalizedUrl = `https://www.instagram.com/${type}/${cleanCode}/`;
                
                if (!dlState.urls[normalizedUrl]) {
                    dlState.urls[normalizedUrl] = { status: 'pending', retries: 0 };
                    updated = true;
                }
            }
        });
        if (updated) {
            addLog(`Added new URLs. Total in state: ${Object.keys(dlState.urls).length}`);
            saveState();
        }
    } else if (request.type === "PAGE_VIEW_CHANGED") {
        addLog(`User navigated to: ${request.path} (isCollection: ${request.isCollection})`);
        if (downloadStatus !== 'running' && downloadStatus !== 'paused') {
            dlState.urls = {};
            saveState();
            addLog("🧹 Queue auto-reset: Scoped cleanly to new view.");
        }
    } else if (request.type === "GET_ACTIVE_TAB_PAGE_INFO") {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (!tabs || tabs.length === 0 || !tabs[0].url.includes('instagram.com')) {
                sendResponse({ ok: false, error: "Not an Instagram tab" });
                return;
            }
            const tabId = tabs[0].id;
            const info = await sendToCollector(tabId, { type: "GET_PAGE_LINKS" });
            sendResponse({ ok: true, tabUrl: tabs[0].url, info: info });
        });
        return true;
    } else if (request.type === "REPLACE_QUEUE_WITH_LINKS") {
        const newUrls = {};
        (request.links || []).forEach(u => {
            const m = u.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
            if (m) {
                const type = m[1];
                const rawCode = m[2];
                const cleanCode = rawCode.length > 11 ? rawCode.substring(0, 11) : rawCode;
                const normalizedUrl = `https://www.instagram.com/${type}/${cleanCode}/`;
                newUrls[normalizedUrl] = { status: 'pending', retries: 0 };
            }
        });
        dlState.urls = newUrls;
        saveState();
        addLog(`Queue replaced strictly with ${Object.keys(newUrls).length} links from current collection.`);
        sendResponse({ ok: true, count: Object.keys(newUrls).length });
    } else if (request.type === "APPEND_QUEUE_WITH_LINKS") {
        let addedCount = 0;
        (request.links || []).forEach(u => {
            const m = u.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
            if (m) {
                const type = m[1];
                const rawCode = m[2];
                const cleanCode = rawCode.length > 11 ? rawCode.substring(0, 11) : rawCode;
                const normalizedUrl = `https://www.instagram.com/${type}/${cleanCode}/`;
                if (!dlState.urls[normalizedUrl]) {
                    dlState.urls[normalizedUrl] = { status: 'pending', retries: 0 };
                    addedCount++;
                }
            }
        });
        saveState();
        addLog(`Appended ${addedCount} links to queue. Total: ${Object.keys(dlState.urls).length}`);
        sendResponse({ ok: true, addedCount, total: Object.keys(dlState.urls).length });
    } else if (request.type === "SET_AUTO_HARVEST") {
        dlState.autoHarvest = !!request.enabled;
        saveState();
        addLog(`Auto-harvest preference updated: ${dlState.autoHarvest}`);
        chrome.tabs.query({ url: "*://*.instagram.com/*" }, (tabs) => {
            (tabs || []).forEach(t => chrome.tabs.sendMessage(t.id, { type: "SET_AUTO_HARVEST", enabled: dlState.autoHarvest }).catch(() => {}));
        });
        sendResponse({ ok: true, autoHarvest: dlState.autoHarvest });
    } else if (request.type === "SET_AUTO_CLEAR_COMPLETED") {
        dlState.autoClearCompleted = !!request.enabled;
        saveState();
        addLog(`Auto-clear completed preference updated: ${dlState.autoClearCompleted}`);
        sendResponse({ ok: true, autoClearCompleted: dlState.autoClearCompleted });
    } else if (request.type === "SET_SCROLL_PACING") {
        dlState.scrollDelayMs = parseInt(request.scrollDelayMs, 10) || 300;
        saveState();
        addLog(`Scroll pacing preference updated: ${dlState.scrollDelayMs}ms`);
        sendResponse({ ok: true, scrollDelayMs: dlState.scrollDelayMs });
    } else if (request.type === "SET_SCROLL_TO_TOP") {
        dlState.scrollToTop = !!request.enabled;
        saveState();
        addLog(`Scroll-to-top preference updated: ${dlState.scrollToTop}`);
        sendResponse({ ok: true, scrollToTop: dlState.scrollToTop });
    } else if (request.type === "START_AUTO_SCROLL") {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].url.includes('instagram.com')) {
                const tabId = tabs[0].id;
                const res = await sendToCollector(tabId, { 
                    type: "START_AUTO_SCROLL", 
                    targetLimit: request.targetLimit,
                    scrollDelayMs: request.scrollDelayMs || dlState.scrollDelayMs || 300,
                    scrollToTop: request.scrollToTop !== undefined ? request.scrollToTop : dlState.scrollToTop
                });
                sendResponse(res || { ok: false });
            } else {
                sendResponse({ ok: false, error: "Not on an Instagram tab" });
            }
        });
        return true;
    } else if (request.type === "STOP_AUTO_SCROLL") {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].url.includes('instagram.com')) {
                const tabId = tabs[0].id;
                const res = await sendToCollector(tabId, { type: "STOP_AUTO_SCROLL" });
                sendResponse(res || { ok: false });
            } else {
                sendResponse({ ok: false, error: "Not on an Instagram tab" });
            }
        });
        return true;
    } else if (request.type === "GET_AUTO_SCROLL_STATE") {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].url.includes('instagram.com')) {
                const tabId = tabs[0].id;
                const res = await sendToCollector(tabId, { type: "GET_AUTO_SCROLL_STATE" });
                sendResponse(res || { ok: false, isScrolling: false });
            } else {
                sendResponse({ ok: false, isScrolling: false });
            }
        });
        return true;
    } else if (request.type === "SET_ZIP_MODE") {
        dlState.zipMode = !!request.enabled;
        saveState();
        addLog(`ZIP Mode updated: ${dlState.zipMode}`);
        sendResponse({ ok: true });
    } else if (request.type === "SET_SPEED_MODE") {
        dlState.speedMode = request.speedMode || 'turbo';
        saveState();
        addLog(`Speed Mode updated: ${dlState.speedMode}`);
        sendResponse({ ok: true });
    } else if (request.type === "START_DL") {
        runDownloader(false);
    } else if (request.type === "PAUSE_DL") {
        if (downloadStatus === 'running') {
            isPaused = true;
            downloadStatus = 'paused';
            broadcastStatus("⏸️ Paused. Click Resume to continue.");
            saveState();
        }
    } else if (request.type === "RESUME_DL") {
        if (downloadStatus === 'paused') {
            isPaused = false;
            downloadStatus = 'running';
            broadcastStatus("▶️ Resuming...");
            saveState();
        }
    } else if (request.type === "STOP_DL") {
        stopDownloading = true;
        isPaused = false;
        broadcastStatus("Stopping after current item...");
    } else if (request.type === "START_RETRY") {
        runDownloader(true);
    } else if (request.type === "GET_STATE") {
        sendResponse({ 
            state: dlState, 
            downloadStatus: downloadStatus, 
            logs: debugLogs.slice(-15) 
        });
    } else if (request.type === "GET_ALL_LOGS") {
        sendResponse({ logs: debugLogs });
    } else if (request.type === "CLEAR_COMPLETED") {
        let count = 0;
        for (const u of Object.keys(dlState.urls)) {
            const st = dlState.urls[u].status;
            if (st === 'success' || st === 'skipped') {
                delete dlState.urls[u];
                count++;
            }
        }
        saveState();
        addLog(`🧹 Cleared ${count} completed/skipped items from queue.`);
        sendResponse({ ok: true, count });
    } else if (request.type === "FORCE_CLEAR" || request.type === "CLEAR_QUEUE") {
        stopDownloading = true;
        isPaused = false;
        downloadStatus = 'idle';
        activeZip = null;
        activeFolder = '';
        totalBufferedImages = 0;
        
        if (workerTabId) {
            chrome.tabs.remove(workerTabId).catch(() => {});
            workerTabId = null;
        }
        
        dlState = { 
            sessionFolder: '', 
            urls: {}, 
            zipMode: dlState.zipMode ?? true, 
            speedMode: dlState.speedMode ?? 'turbo' 
        };
        saveState();
        
        chrome.tabs.query({ url: "*://*.instagram.com/*" }, (tabs) => {
            if (tabs && tabs.length > 0) {
                tabs.forEach(t => {
                    chrome.tabs.sendMessage(t.id, { type: "CLEAR_COLLECTOR" }).catch(() => {});
                });
            }
        });
        
        addLog("⚡ FORCE CLEAR EXECUTED: All state, workers, and collectors reset to zero.");
        sendResponse({ ok: true });
    }
    return true;
});

// ── Tab Reload & Refresh Listener ──
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // When user refreshes an Instagram tab, cleanly reset queue if not actively downloading
    if (tab?.url && tab.url.includes("instagram.com") && changeInfo.status === "loading") {
        if (downloadStatus !== 'running' && downloadStatus !== 'paused') {
            dlState.urls = {};
            saveState();
            addLog(`Instagram tab ${tabId} reloaded: Queue reset for fresh feed.`);
        }
    }
});
