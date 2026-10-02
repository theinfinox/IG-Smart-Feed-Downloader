const btnStart = document.getElementById('btn-dl-start');
const btnPause = document.getElementById('btn-dl-pause');
const btnStop = document.getElementById('btn-dl-stop');
const btnRetry = document.getElementById('btn-dl-retry');
const btnExport = document.getElementById('btn-export');
const btnSaveLog = document.getElementById('btn-save-log');
const btnClearCompleted = document.getElementById('btn-clear-completed');
const btnForceClear = document.getElementById('btn-force-clear');
const forceClearBox = document.getElementById('force-clear-box');
const btnConfirmForceClear = document.getElementById('btn-confirm-force-clear');
const btnCancelForceClear = document.getElementById('btn-cancel-force-clear');

const pageContextText = document.getElementById('page-context-text');
const pageActionGroup = document.getElementById('page-action-group');
const btnLoadPage = document.getElementById('btn-load-page');
const btnAppendPage = document.getElementById('btn-append-page');

const numTargetLimit = document.getElementById('num-target-limit');
const selScrollPacing = document.getElementById('sel-scroll-pacing');
const chkScrollToTop = document.getElementById('chk-scroll-to-top');
const btnAutoScroll = document.getElementById('btn-auto-scroll');
const autoScrollStatus = document.getElementById('auto-scroll-status');

const chkAutoHarvest = document.getElementById('chk-auto-harvest');
const chkAutoClear = document.getElementById('chk-auto-clear');
const chkZipMode = document.getElementById('chk-zip-mode');
const selSpeedMode = document.getElementById('sel-speed-mode');
const extremeWarning = document.getElementById('extreme-warning');
const statCollector = document.getElementById('collector-stats');
const statDl = document.getElementById('dl-stats');
const statusDl = document.getElementById('dl-status');
const logConsole = document.getElementById('log-console');

let currentState = { 
    urls: {}, 
    zipMode: true, 
    speedMode: 'turbo', 
    autoHarvest: true, 
    autoClearCompleted: false,
    scrollDelayMs: 300,
    scrollToTop: false
};
let currentStatus = 'idle';
let activeTabLinks = [];
let isAutoScrolling = false;

function renderLogs(logs) {
    if (!logs || logs.length === 0) return;
    logConsole.textContent = logs.join('\n');
    logConsole.scrollTop = logConsole.scrollHeight;
}

function updateAutoScrollUI(statusObj) {
    if (!statusObj) return;
    isAutoScrolling = !!statusObj.isScrolling;
    
    if (isAutoScrolling) {
        btnAutoScroll.textContent = "⏹ Stop Auto-Scroll";
        btnAutoScroll.className = "danger";
        btnAutoScroll.style.background = "";
        autoScrollStatus.style.display = "block";
        autoScrollStatus.textContent = statusObj.message || "Auto-scrolling...";
    } else {
        if (statusObj.status === "completed") {
            btnAutoScroll.textContent = "🔄 Re-check for More Posts";
            btnAutoScroll.className = "primary";
            btnAutoScroll.style.background = "#1e3a8a";
        } else if (statusObj.status === "stopped") {
            btnAutoScroll.textContent = "▶ Resume Auto-Scroll";
            btnAutoScroll.className = "primary";
            btnAutoScroll.style.background = "#1e3a8a";
        } else {
            btnAutoScroll.textContent = "📜 Start Auto-Scroll";
            btnAutoScroll.className = "primary";
            btnAutoScroll.style.background = "";
        }
        if (statusObj.message) {
            autoScrollStatus.style.display = "block";
            autoScrollStatus.textContent = statusObj.message;
        }
    }
}

function updateUI(state, downloadStatus, logs) {
    currentState = Object.assign({ 
        urls: {}, 
        zipMode: true, 
        speedMode: 'turbo', 
        autoHarvest: true, 
        autoClearCompleted: false,
        scrollDelayMs: 300,
        scrollToTop: false
    }, state);
    currentStatus = downloadStatus || 'idle';
    
    let pending = 0, success = 0, failed = 0, skipped = 0;
    const urls = Object.keys(currentState.urls);
    
    urls.forEach(u => {
        const s = currentState.urls[u].status;
        if (s === 'pending') pending++;
        if (s === 'success') success++;
        if (s === 'failed') failed++;
        if (s === 'skipped') skipped++;
    });
    
    const completedCount = success + skipped;
    const totalCount = urls.length;
    
    statCollector.textContent = `Queue: ${totalCount} links`;
    statDl.textContent = `Success: ${success} | Failed: ${failed} | Skipped: ${skipped} | Pending: ${pending}`;
    
    // Update button counts
    btnClearCompleted.textContent = `🧹 Clear Completed (${completedCount})`;
    btnClearCompleted.disabled = (completedCount === 0) || (currentStatus === 'running');
    
    btnForceClear.textContent = `⚡ Force Clear All (${totalCount})`;
    btnForceClear.disabled = (totalCount === 0 && currentStatus === 'idle');
    
    if (chkZipMode && currentState.zipMode !== undefined) {
        chkZipMode.checked = currentState.zipMode;
    }
    
    if (chkAutoHarvest && currentState.autoHarvest !== undefined) {
        chkAutoHarvest.checked = currentState.autoHarvest;
    }
    
    if (chkAutoClear && currentState.autoClearCompleted !== undefined) {
        chkAutoClear.checked = currentState.autoClearCompleted;
    }

    if (chkScrollToTop && currentState.scrollToTop !== undefined) {
        chkScrollToTop.checked = !!currentState.scrollToTop;
    }

    if (selScrollPacing && currentState.scrollDelayMs) {
        selScrollPacing.value = currentState.scrollDelayMs.toString();
    }
    
    if (selSpeedMode && currentState.speedMode) {
        selSpeedMode.value = currentState.speedMode;
        extremeWarning.style.display = currentState.speedMode === 'extreme' ? 'block' : 'none';
    }
    
    btnExport.disabled = totalCount === 0;
    btnRetry.disabled = (currentStatus !== 'idle') || failed === 0;
    
    if (currentStatus === 'idle') {
        btnStart.textContent = "▶ Start";
        btnStart.disabled = (pending === 0 && failed === 0);
        btnPause.disabled = true;
        btnStop.disabled = true;
        selSpeedMode.disabled = false;
    } else if (currentStatus === 'running') {
        btnStart.textContent = "▶ Start";
        btnStart.disabled = true;
        btnPause.disabled = false;
        btnStop.disabled = false;
        selSpeedMode.disabled = true;
    } else if (currentStatus === 'paused') {
        btnStart.textContent = "▶ Resume";
        btnStart.disabled = false;
        btnPause.disabled = true;
        btnStop.disabled = false;
        selSpeedMode.disabled = false;
    }
    
    if (logs) renderLogs(logs);
}

// Check active Instagram tab and detect if currently viewing a Saved Collection
function checkActiveTab() {
    chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB_PAGE_INFO" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
            pageContextText.textContent = "📍 Open Instagram to harvest";
            pageActionGroup.style.display = 'none';
            btnAutoScroll.disabled = true;
            return;
        }
        btnAutoScroll.disabled = false;
        const info = res.info;
        if (!info) {
            pageContextText.textContent = "📍 Instagram connected";
            pageActionGroup.style.display = 'none';
            return;
        }
        
        activeTabLinks = info.links || [];
        const isCollection = info.isCollection;
        const count = activeTabLinks.length;
        
        if (isCollection) {
            const title = info.title ? `Collection: ${info.title}` : "Saved Collection";
            pageContextText.textContent = `📍 ${title} (${count} posts)`;
        } else {
            pageContextText.textContent = `📍 Instagram Page (${count} posts)`;
        }
        
        if (count > 0) {
            btnLoadPage.textContent = `📥 Load (${count})`;
            btnAppendPage.textContent = `➕ Add (+${count})`;
            pageActionGroup.style.display = 'flex';
        } else {
            pageActionGroup.style.display = 'none';
        }
        
        if (info.isScrolling !== undefined) {
            updateAutoScrollUI({ isScrolling: info.isScrolling });
        }
    });
}

// Initial fetch from background service worker
function refreshState() {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
        if (res) updateUI(res.state, res.downloadStatus, res.logs);
    });
}

refreshState();
checkActiveTab();

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STATE_UPDATED") {
        refreshState();
        checkActiveTab();
    } else if (msg.type === "STATUS_MSG") {
        statusDl.textContent = msg.msg;
        if (msg.downloadStatus) {
            currentStatus = msg.downloadStatus;
        }
        refreshState();
    } else if (msg.type === "AUTO_SCROLL_STATUS") {
        updateAutoScrollUI({
            isScrolling: msg.isScrolling,
            status: msg.status,
            message: msg.message,
            count: msg.count
        });
        refreshState();
    }
});

// Auto-Scroll Start / Stop Button
btnAutoScroll.addEventListener('click', () => {
    if (!isAutoScrolling) {
        const targetLimit = parseInt(numTargetLimit.value, 10) || 0;
        const scrollDelayMs = parseInt(selScrollPacing.value, 10) || 300;
        const scrollToTop = !!chkScrollToTop.checked;
        
        updateAutoScrollUI({ 
            isScrolling: true, 
            status: "running",
            message: `Starting auto-scroll (${scrollDelayMs}ms)${targetLimit > 0 ? ` (Target: ${targetLimit})` : ''}...` 
        });
        chrome.runtime.sendMessage({ 
            type: "START_AUTO_SCROLL", 
            targetLimit,
            scrollDelayMs,
            scrollToTop
        });
    } else {
        updateAutoScrollUI({ isScrolling: false, status: "stopped", message: "Stopping auto-scroll..." });
        chrome.runtime.sendMessage({ type: "STOP_AUTO_SCROLL" });
    }
});

// Replace queue with current active view
btnLoadPage.addEventListener('click', () => {
    if (activeTabLinks.length === 0) return;
    btnLoadPage.disabled = true;
    btnAppendPage.disabled = true;
    chrome.runtime.sendMessage({
        type: "REPLACE_QUEUE_WITH_LINKS",
        links: activeTabLinks
    }, (res) => {
        btnLoadPage.disabled = false;
        btnAppendPage.disabled = false;
        statusDl.textContent = `✅ Loaded ${res?.count || 0} collection posts into queue!`;
        refreshState();
    });
});

// Append current active view to existing queue
btnAppendPage.addEventListener('click', () => {
    if (activeTabLinks.length === 0) return;
    btnLoadPage.disabled = true;
    btnAppendPage.disabled = true;
    chrome.runtime.sendMessage({
        type: "APPEND_QUEUE_WITH_LINKS",
        links: activeTabLinks
    }, (res) => {
        btnLoadPage.disabled = false;
        btnAppendPage.disabled = false;
        statusDl.textContent = `➕ Added +${res?.addedCount || 0} posts! Total: ${res?.total || 0}`;
        refreshState();
    });
});

chkAutoHarvest.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: "SET_AUTO_HARVEST", enabled: chkAutoHarvest.checked }, () => {
        statusDl.textContent = chkAutoHarvest.checked ? "⚡ Auto-harvest enabled." : "🛑 Manual loading mode.";
        refreshState();
    });
});

chkAutoClear.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: "SET_AUTO_CLEAR_COMPLETED", enabled: chkAutoClear.checked }, () => {
        refreshState();
    });
});

chkScrollToTop.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: "SET_SCROLL_TO_TOP", enabled: chkScrollToTop.checked }, () => {
        refreshState();
    });
});

selScrollPacing.addEventListener('change', () => {
    const val = parseInt(selScrollPacing.value, 10) || 300;
    chrome.runtime.sendMessage({ type: "SET_SCROLL_PACING", scrollDelayMs: val }, () => {
        refreshState();
    });
});

chkZipMode.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: "SET_ZIP_MODE", enabled: chkZipMode.checked });
});

selSpeedMode.addEventListener('change', () => {
    const val = selSpeedMode.value;
    extremeWarning.style.display = val === 'extreme' ? 'block' : 'none';
    chrome.runtime.sendMessage({ type: "SET_SPEED_MODE", speedMode: val });
});

btnStart.addEventListener('click', () => {
    if (currentStatus === 'paused') {
        statusDl.textContent = "Resuming...";
        chrome.runtime.sendMessage({ type: "RESUME_DL" });
    } else {
        statusDl.textContent = "Starting...";
        chrome.runtime.sendMessage({ type: "START_DL" });
    }
});

btnPause.addEventListener('click', () => {
    statusDl.textContent = "Pausing...";
    chrome.runtime.sendMessage({ type: "PAUSE_DL" });
});

btnStop.addEventListener('click', () => {
    statusDl.textContent = "Stopping...";
    chrome.runtime.sendMessage({ type: "STOP_DL" });
});

btnRetry.addEventListener('click', () => {
    statusDl.textContent = "Retrying failed...";
    chrome.runtime.sendMessage({ type: "START_RETRY" });
});

// Safe Clear: Completed Only (Instant, no prompt)
btnClearCompleted.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: "CLEAR_COMPLETED" }, (res) => {
        statusDl.textContent = `Cleared ${res?.count || 0} completed items.`;
        refreshState();
    });
});

// Force Clear: Open Accessible Confirmation Banner
btnForceClear.addEventListener('click', () => {
    forceClearBox.style.display = 'block';
});

btnCancelForceClear.addEventListener('click', () => {
    forceClearBox.style.display = 'none';
});

btnConfirmForceClear.addEventListener('click', () => {
    forceClearBox.style.display = 'none';
    statusDl.textContent = "⚡ Force clear executed.";
    chrome.runtime.sendMessage({ type: "FORCE_CLEAR" }, () => {
        refreshState();
        checkActiveTab();
    });
});

btnExport.addEventListener('click', () => {
    const urls = Object.keys(currentState.urls);
    if (urls.length === 0) return;
    const blob = new Blob([urls.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
        url: url,
        filename: `ig_links_${Date.now()}.txt`,
        saveAs: false
    });
});

btnSaveLog.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: "GET_ALL_LOGS" }, (res) => {
        const logs = res?.logs || ["No logs recorded yet."];
        const blob = new Blob([logs.join('\n') + '\n'], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        chrome.downloads.download({
            url: url,
            filename: `ig_extension_debug_log_${Date.now()}.txt`,
            saveAs: false
        });
    });
});
