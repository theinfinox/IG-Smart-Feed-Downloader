// Runs on Instagram pages
let collected = new Set();
let lastSize = 0;
let lastPath = location.pathname;
let autoHarvestEnabled = true; // Default: ON per user preference (with toggle)
let isAutoScrolling = false;

// Load user's auto-harvest preference from storage (defaults to true if unset)
chrome.storage.local.get(['igbdl_state'], (result) => {
  if (result?.igbdl_state?.autoHarvest !== undefined) {
    autoHarvestEnabled = !!result.igbdl_state.autoHarvest;
  }
});

// Mathematical shortcode to media_id decoder (0ms)
function shortcodeToMediaId(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  // Standard Instagram shortcode is strictly 11 chars. Truncate any tracking suffix.
  const clean = shortcode.length > 11 ? shortcode.substring(0, 11) : shortcode;
  let id = 0n;
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) return null;
    id = id * 64n + BigInt(idx);
  }
  return id.toString();
}

function scan(returnOnly = false) {
  // STRICT SCOPING: Only scan inside <main role="main"> (ignores sidebars, headers, notifications)
  const main = document.querySelector('main');
  if (!main) return returnOnly ? [] : undefined;
  
  const found = new Set();
  
  main.querySelectorAll('a[href]').forEach(a => {
    // 1. Ignore links inside recommendation trays or suggestions
    if (a.closest('[aria-label*="Suggested"], [aria-label*="Recommended"], [data-nosnippet]')) {
      return;
    }
    
    // 2. Ignore collection folder links (e.g. /saved/my_collection/12345/)
    const href = a.getAttribute('href') || a.href;
    if (href.includes('/saved/')) {
      return;
    }
    
    // 3. Match /p/ or /reel/ links
    const m = a.href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
    if (!m) return;
    
    const type = m[1];
    let rawCode = m[2];
    
    // Normalize shortcode: Instagram shortcodes are strictly 11 chars (strip any tracking suffix)
    const shortcode = rawCode.length > 11 ? rawCode.substring(0, 11) : rawCode;
    
    // Validate valid shortcode length
    if (shortcode.length >= 9 && shortcode.length <= 11) {
      const cleanUrl = `https://www.instagram.com/${type}/${shortcode}/`;
      if (returnOnly) {
        found.add(cleanUrl);
      } else {
        collected.add(cleanUrl);
      }
    }
  });
  
  if (returnOnly) {
    return Array.from(found);
  }
  
  // Track count changes
  if (collected.size > lastSize) {
    lastSize = collected.size;
    
    // Auto-stream to background if autoHarvest is enabled (default: ON)
    if (autoHarvestEnabled) {
      chrome.runtime.sendMessage({
        type: "NEW_URLS",
        urls: Array.from(collected),
        isCollection: location.pathname.includes('/saved/')
      }).catch(() => {});
    }
  }
}

// ── Native Instagram Helpers (Adapted from IGScript.js) ──
function clickRetryIfPresent() {
  for (const el of document.querySelectorAll('button, [role="button"]')) {
    const t = (el.textContent || '').trim().toLowerCase();
    if (t === 'retry' || t === 'try again') {
      try {
        el.click();
        return true;
      } catch (e) {}
    }
  }
  return false;
}

function isInstagramLoading() {
  const main = document.querySelector('main') || document.body;
  if (!main) return false;
  if (document.querySelector('[data-visualcompletion="loading-state"]')) return true;
  const spinners = main.querySelectorAll(
    'svg[aria-label*="Loading"], [role="progressbar"], div[data-visualcompletion="loading-state"], circle'
  );
  for (const s of spinners) {
    if (s.offsetParent !== null || (s.getBoundingClientRect && s.getBoundingClientRect().height > 0)) {
      return true;
    }
  }
  return false;
}

function isNearBottom(threshold = 120) {
  const scrollY = window.scrollY || window.pageYOffset || (document.documentElement ? document.documentElement.scrollTop : 0);
  const winHeight = window.innerHeight;
  const docHeight = Math.max(
    document.body ? document.body.scrollHeight : 0,
    document.documentElement ? document.documentElement.scrollHeight : 0,
    document.body ? document.body.offsetHeight : 0,
    document.documentElement ? document.documentElement.offsetHeight : 0
  );
  return (scrollY + winHeight) >= (docHeight - threshold);
}

function isFooterInView() {
  const footer = document.querySelector('footer, [role="contentinfo"]');
  if (!footer) return false;
  const rect = footer.getBoundingClientRect();
  return rect.top <= window.innerHeight && rect.bottom >= 0;
}

// ── High-Speed Auto-Scroll Engine with Throttling & 4-Stage Verification ──
async function startAutoScroll(targetLimit = 0, scrollDelayMs = 300, scrollToTopWhenDone = false) {
  if (isAutoScrolling) return;
  isAutoScrolling = true;
  
  const delay = Math.max(100, Math.min(4000, parseInt(scrollDelayMs, 10) || 300));
  // High-speed optimization: instant scroll for <400ms prevents animation queue lag
  const scrollBehavior = delay < 400 ? 'instant' : 'smooth';
  
  function notify(status, message) {
    chrome.runtime.sendMessage({
      type: "AUTO_SCROLL_STATUS",
      status: status,
      message: message,
      count: collected.size,
      targetLimit: targetLimit,
      scrollDelayMs: delay,
      isScrolling: isAutoScrolling
    }).catch(() => {});
  }

  notify("running", `Starting fast auto-scroll (${delay}ms)${targetLimit > 0 ? ` (Target: ${targetLimit} posts)` : ''}...`);

  let lastCollectedCount = collected.size;
  let bottomStreak = 0;
  let cycle = 0;
  const ABSOLUTE_MAX_CYCLES = 1000; // Safeguard

  while (isAutoScrolling && cycle < ABSOLUTE_MAX_CYCLES) {
    cycle++;
    
    // 1. Check if user-specified target limit has been reached
    if (targetLimit > 0 && collected.size >= targetLimit) {
      notify("completed", `✅ Target of ${targetLimit} posts reached!`);
      break;
    }

    // 2. Auto-click 'Retry' button if Instagram pagination stumbles
    if (clickRetryIfPresent()) {
      notify("running", `↺ Clicked IG Retry button... (${collected.size} posts)`);
      await new Promise(r => setTimeout(r, 600));
    }
    
    // 3. Perform scroll: ~85% of viewport height (adapted from IGScript.js)
    const scrollDistance = Math.round(window.innerHeight * 0.85);
    window.scrollBy({ top: scrollDistance, behavior: scrollBehavior });
    
    // 4. Scan DOM for newly rendered posts
    scan();
    
    if (targetLimit > 0 && collected.size >= targetLimit) {
      notify("completed", `✅ Target of ${targetLimit} posts reached!`);
      break;
    }

    // 5. Adaptive Network Delay: User pacing (Default: 300ms)
    await new Promise(r => setTimeout(r, delay));
    
    // 6. Network Check: if Instagram is actively loading next batch, wait quietly
    let spinnerWait = 0;
    const maxSpinnerWait = Math.max(5, Math.ceil(2500 / delay));
    while (isAutoScrolling && isInstagramLoading() && spinnerWait < maxSpinnerWait) {
      spinnerWait++;
      notify("running", `⏳ Waiting for network... (${collected.size} posts)`);
      await new Promise(r => setTimeout(r, Math.max(300, delay)));
      scan();
    }
    
    // 7. Check if new unique posts were discovered
    const countChanged = collected.size > lastCollectedCount;
    if (countChanged) {
      lastCollectedCount = collected.size;
      bottomStreak = 0;
      notify("running", `Auto-scrolling... (${collected.size} posts${targetLimit > 0 ? ` / ${targetLimit}` : ''})`);
      continue;
    }

    // 8. Stagnation / End of Collection Detection (2-Stage Micro-Nudge Verification)
    const atBottom = isNearBottom(120) || isFooterInView();
    if (atBottom) {
      bottomStreak++;

      if (bottomStreak === 1) {
        // Micro-Nudge 1: Subtle shift to re-trigger IntersectionObserver
        notify("running", `Verifying end of feed (1/2)... (${collected.size} posts)`);
        window.scrollBy({ top: -80, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 250));
        window.scrollBy({ top: 120, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 800));
        scan();
        if (collected.size > lastCollectedCount) {
          lastCollectedCount = collected.size;
          bottomStreak = 0;
          continue;
        }
      } else if (bottomStreak === 2) {
        // Micro-Nudge 2: Second verification nudge
        notify("running", `Verifying end of feed (2/2)... (${collected.size} posts)`);
        window.scrollBy({ top: -100, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 250));
        window.scrollBy({ top: 140, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 900));
        scan();
        if (collected.size > lastCollectedCount) {
          lastCollectedCount = collected.size;
          bottomStreak = 0;
          continue;
        }
      } else {
        // Confirmed: 2 micro-nudges passed with zero new posts
        notify("completed", `✅ Reached end of collection! (${collected.size} posts found)`);
        break;
      }
    } else {
      bottomStreak = 0;
    }
  }
  
  const wasUserStopped = !isAutoScrolling;
  isAutoScrolling = false;
  
  // Final capture scan
  scan();

  // Viewport Position handling: Option A stays at bottom; Option B scrolls to top if enabled
  if (scrollToTopWhenDone && !wasUserStopped) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  
  if (wasUserStopped) {
    notify("stopped", `⏹ Auto-scroll paused by user. (${collected.size} posts collected)`);
  }
}

function stopAutoScroll() {
  isAutoScrolling = false;
}

// ── Detect SPA Navigation (e.g. user opens a specific Saved Collection) ──
setInterval(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    const isSaved = location.pathname.includes('/saved/');
    // Reset local cache to cleanly scope to the new collection/view
    collected.clear();
    lastSize = 0;
    isAutoScrolling = false;
    
    chrome.runtime.sendMessage({
      type: "PAGE_VIEW_CHANGED",
      path: location.pathname,
      isCollection: isSaved
    }).catch(() => {});
    
    scan();
  }
}, 600);

// ── Message Listener ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CLEAR_COLLECTOR") {
    collected.clear();
    lastSize = 0;
    isAutoScrolling = false;
    sendResponse({ ok: true });
    return false;
  }
  
  if (msg.type === "START_AUTO_SCROLL") {
    const limit = parseInt(msg.targetLimit, 10) || 0;
    const delay = parseInt(msg.scrollDelayMs, 10) || 300;
    const scrollToTop = !!msg.scrollToTop;
    startAutoScroll(limit, delay, scrollToTop);
    sendResponse({ ok: true, isScrolling: true });
    return false;
  }
  
  if (msg.type === "STOP_AUTO_SCROLL") {
    stopAutoScroll();
    sendResponse({ ok: true, isScrolling: false });
    return false;
  }
  
  if (msg.type === "GET_AUTO_SCROLL_STATE") {
    sendResponse({ ok: true, isScrolling: isAutoScrolling, count: collected.size });
    return false;
  }
  
  if (msg.type === "SET_AUTO_HARVEST") {
    autoHarvestEnabled = !!msg.enabled;
    // If user turned auto-harvest ON, immediately flush currently collected links
    if (autoHarvestEnabled && collected.size > 0) {
      chrome.runtime.sendMessage({
        type: "NEW_URLS",
        urls: Array.from(collected),
        isCollection: location.pathname.includes('/saved/')
      }).catch(() => {});
    }
    sendResponse({ ok: true, autoHarvest: autoHarvestEnabled });
    return false;
  }
  
  if (msg.type === "GET_PAGE_LINKS") {
    const links = scan(true);
    const isSaved = location.pathname.includes('/saved/');
    const heading = document.querySelector('main h1, main h2, header h1, header h2')?.textContent?.trim() || "";
    sendResponse({
      ok: true,
      path: location.pathname,
      isCollection: isSaved,
      title: heading,
      links: links,
      isScrolling: isAutoScrolling
    });
    return false;
  }
  
  // High-Speed Page-Context API Bridge (runs inside https://www.instagram.com with full session cookies)
  if (msg.type === "FETCH_MEDIA_API") {
    const cleanCode = msg.shortcode.length > 11 ? msg.shortcode.substring(0, 11) : msg.shortcode;
    const mediaId = shortcodeToMediaId(cleanCode);
    if (!mediaId) {
      sendResponse({ success: false, error: "Invalid shortcode" });
      return false;
    }
    
    // Extract CSRF token from active cookies if available
    const csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';
    
    const headers = {
      'X-IG-App-ID': '936619743392459',
      'X-Requested-With': 'XMLHttpRequest',
      'X-ASBD-ID': '129477'
    };
    if (csrfToken) headers['X-CSRFToken'] = csrfToken;
    
    fetch(`https://www.instagram.com/api/v1/media/${mediaId}/info/`, {
      headers: headers,
      credentials: 'include'
    })
    .then(async (res) => {
      if (res.status === 401 || res.status === 429) {
        sendResponse({ success: false, rateLimit: true, status: res.status });
        return;
      }
      if (!res.ok) {
        sendResponse({ success: false, status: res.status, error: `HTTP ${res.status}` });
        return;
      }
      const data = await res.json();
      sendResponse({ success: true, data: data });
    })
    .catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    
    return true; // Keep channel open for async response
  }
});

// Observe mutations for infinite scroll inside collection/feed
const observer = new MutationObserver(() => {
  scan();
});
observer.observe(document.body, { childList: true, subtree: true });
scan(); // Initial scan
