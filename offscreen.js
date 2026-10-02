// Offscreen document script: handles DOM-dependent operations (Blob URLs) in MV3
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "OFFSCREEN_DOWNLOAD_ZIP") {
        try {
            const { base64Data, filename } = message;
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Uint8Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const blob = new Blob([byteNumbers], { type: 'application/zip' });
            const blobUrl = URL.createObjectURL(blob);
            
            chrome.downloads.download({
                url: blobUrl,
                filename: filename,
                saveAs: false,
                conflictAction: 'overwrite'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                    URL.revokeObjectURL(blobUrl);
                } else {
                    sendResponse({ ok: true, downloadId });
                    // Revoke after 60s to ensure the browser has read and saved the stream
                    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
                }
            });
        } catch (err) {
            sendResponse({ ok: false, error: err.message });
        }
        return true; // Keep message channel open for async response
    }
});
