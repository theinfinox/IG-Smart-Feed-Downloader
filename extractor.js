// Runs in the ghost tab for private posts / safety fallback
(async function() {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    
    try {
        const rawCurrentCode = location.pathname.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1] || "";
        const currentShortcode = rawCurrentCode.length > 11 ? rawCurrentCode.substring(0, 11) : rawCurrentCode;
        
        // Wait until React renders images on the page
        let wait = 25;
        while (wait > 0 && document.querySelectorAll('img').length === 0) {
            await sleep(400);
            wait--;
        }
        await sleep(1200); // Buffer for full resolution image swap
        
        let images = new Set();
        let maxAttempts = 12;
        
        function scanCurrentSlide() {
            const allImgs = document.querySelectorAll('article img, main img');
            const targetImgs = allImgs.length > 0 ? allImgs : document.querySelectorAll('img');
            
            targetImgs.forEach(img => {
                // Check both srcset and src to get the highest resolution candidate
                let bestUrl = '';
                if (img.srcset) {
                    const parts = img.srcset.split(',').map(s => s.trim().split(' ')[0]).filter(Boolean);
                    if (parts.length > 0) bestUrl = parts[parts.length - 1];
                }
                if (!bestUrl && img.src) bestUrl = img.src;
                if (!bestUrl) return;
                
                // 1. Must be hosted on Instagram CDNs
                const isCdn = bestUrl.includes('scontent') || bestUrl.includes('cdninstagram') || bestUrl.includes('fbcdn');
                if (!isCdn) return;
                
                // 2. Filter out user avatars and tiny icons
                const isAvatar = /([sp]\d+x\d+|150x150|75x75|50x50|32x32|44x44)/i.test(bestUrl);
                if (isAvatar) return;
                
                // 3. Filter out suggested posts in the "More posts from" grid
                const parentLink = img.closest('a[href*="/p/"], a[href*="/reel/"]');
                if (parentLink) {
                    const linkMatch = parentLink.href.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1] || "";
                    const cleanLinkCode = linkMatch.length > 11 ? linkMatch.substring(0, 11) : linkMatch;
                    if (cleanLinkCode && cleanLinkCode !== currentShortcode) {
                        return; // It's a suggested post thumbnail!
                    }
                }
                
                // 4. Check rendered size if available
                if (img.clientWidth > 0 && img.clientWidth < 140 && img.clientHeight < 140) {
                    return; // Too small
                }
                
                images.add(bestUrl);
            });
        }
        
        while (maxAttempts > 0) {
            scanCurrentSlide();
            
            // Look for carousel Next button
            let nextBtn = document.querySelector('button[aria-label="Next"], [aria-label="Next"], [aria-label="Next slide"]');
            if (!nextBtn) {
                // Fallback: look for buttons with right-arrow SVGs
                const buttons = document.querySelectorAll('button');
                for (const b of buttons) {
                    const aria = b.getAttribute('aria-label') || '';
                    if (aria.toLowerCase().includes('next')) { nextBtn = b; break; }
                }
            }
            
            if (!nextBtn) break;
            
            nextBtn.click();
            await sleep(700); // Allow slide transition
            maxAttempts--;
        }
        
        // Final scan after all clicks
        scanCurrentSlide();
        
        // Extract Caption
        let caption = "";
        const h1 = document.querySelector('h1');
        if (h1 && h1.textContent) {
            caption = h1.textContent;
        } else {
            const metaOg = document.querySelector('meta[property="og:title"]');
            if (metaOg && metaOg.content) caption = metaOg.content;
        }
        
        // Detect if main media is a video (only if no images were found)
        let is_video = false;
        if (images.size === 0) {
            const videoEl = document.querySelector('article video, main video');
            if (videoEl) is_video = true;
        }
        
        chrome.runtime.sendMessage({
            type: "EXTRACTOR_RESULT",
            success: true,
            images: Array.from(images),
            caption: caption,
            is_video: is_video
        });
        
    } catch (e) {
        chrome.runtime.sendMessage({
            type: "EXTRACTOR_RESULT",
            success: false,
            error: e.message
        });
    }
})();
