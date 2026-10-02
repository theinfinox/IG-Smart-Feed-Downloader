# Privacy Policy for Bulk Downloader for IG

*Last Updated: October 2026*

**Bulk Downloader for IG** is committed to protecting your privacy. This Privacy Policy explains our practices regarding user data, permissions, and security.

---

### 1. Data Collection & Telemetry: None
* **We do not collect, store, or transmit any personal data.**
* The extension contains **zero tracking pixels, zero analytics scripts, and zero telemetry**.
* No user accounts, email addresses, passwords, or browsing histories are ever tracked or stored.

### 2. Client-Side Only Processing
* All media extraction, image buffering, ZIP compilation, and file downloads are executed **100% locally on your computer** using client-side browser APIs (`chrome.downloads`, `JSZip`, and `chrome.offscreen`).
* No images, URLs, or metadata are ever transmitted to external servers.

### 3. Instagram Authentication & Session Cookies
* The extension operates strictly within your existing browser session.
* It does not prompt for, capture, or store your Instagram password.
* When requesting media information, your browser communicates directly with Instagram's servers using your existing authenticated session cookies, exactly as if you were browsing the website yourself.

### 4. Permissions Usage & Justification
* **`downloads`:** Required to save downloaded images and compiled `.zip` archives directly to your computer's Downloads folder.
* **`storage`:** Required to save your local UI preferences (such as speed mode, ZIP bundling toggle, and scroll delay) locally in your browser.
* **`offscreen`:** Required under Chrome Manifest V3 to create in-memory binary Blob objects for ZIP downloads without DOM limitations in background workers.
* **`tabs` & `scripting`:** Required to send collection commands to the active Instagram tab and check page URLs.
* **Host Permissions (`instagram.com`, `cdninstagram.com`, `fbcdn.net`):** Strictly restricted to Instagram's web domains and their public media Content Delivery Networks (CDNs) to fetch media files.

### 5. Third-Party Sharing
* We do not sell, rent, trade, or transfer any user data to outside parties.

### 6. Updates to This Policy
If this Privacy Policy is updated, the revision date at the top will be updated accordingly.

### 7. Contact & Open Source Transparency
This extension is open-source. You can review the full source code or report issues on GitHub:  
[https://github.com/theinfinox/IG-Smart-Feed-Downloader](https://github.com/theinfinox/IG-Smart-Feed-Downloader)
