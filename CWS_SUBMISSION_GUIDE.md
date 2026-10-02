# Chrome Web Store Submission Guide

Use this copy-paste reference when filling out the **Chrome Web Store Developer Dashboard** listing.

---

## 1. Store Listing Details

* **Extension Name:**  
  `Bulk Downloader for IG`
* **Short Description (under 132 chars):**  
  `Fast, private client-side bulk downloader for your saved Instagram collections, posts, and carousels.`
* **Category:**  
  `Photos` (or `Productivity`)
* **Privacy Policy URL:**  
  `https://github.com/theinfinox/IG-Smart-Feed-Downloader/blob/master/PRIVACY.md`

### Detailed Description (Copy-paste into CWS):
```text
Bulk Downloader for IG is a fast, 100% private client-side extension that allows you to save your Instagram posts, carousels, and collections directly to your local computer in full resolution.

KEY FEATURES:
• Adaptive Auto-Scroll: Automatically harvests post links from your saved collections and profile feeds with adjustable network pacing.
• Full-Resolution Carousels: Neatly organizes multi-slide carousel posts into subfolders.
• Offline ZIP Compilation: Compiles multiple posts into a clean ZIP archive completely inside your browser using client-side Web APIs. Zero data is sent to external servers.
• Ephemeral Scoped Queues: Automatically scopes your queue to your active page view; navigating to a new collection resets your queue to zero with no stale link pollution.
• Pure Client-Side Privacy: Operates directly within your existing logged-in browser session. No passwords, tracking, analytics, or third-party servers.

HOW TO USE:
1. Navigate to your Instagram Saved Collections or any profile grid.
2. Click the extension icon in your browser toolbar.
3. Select your target post limit (or 0 for All) and click "Start Auto-Scroll".
4. Once harvesting completes, click "Start" to download your media directly into an offline ZIP archive.

DISCLAIMER:
This extension is an independent client-side utility developed for personal data backup and archival purposes. It is not affiliated with, sponsored by, or endorsed by Instagram or Meta Platforms, Inc.
```

---

## 2. Privacy Practices Tab (CWS Questionnaire)

### Single Purpose Description:
```text
To allow users to bulk download and archive their saved Instagram posts and carousel images directly to their local computer in structured ZIP files.
```

### Permission Justifications:
* **`downloads`:**  
  `Required to save the downloaded images and compiled ZIP archives to the user's local Downloads directory.`
* **`offscreen`:**  
  `Required under Chrome Manifest V3 to generate binary Blob URLs for ZIP archives without DOM limitations in background service workers.`
* **`storage`:**  
  `Required to save user UI preferences locally (such as download speed, ZIP bundling toggle, and scroll delay pacing).`
* **`tabs` & `scripting`:**  
  `Required to detect active Instagram tab URLs and re-inject the content collector if the extension is reloaded.`
* **Host Permissions (`instagram.com`, `cdninstagram.com`, `fbcdn.net`):**  
  `Required to fetch public image assets and query post media details from Instagram's content delivery networks.`

### Data Usage Declarations:
* Check **"No, I am not collecting or using user data"** for all categories (Personal info, Location, Financial, Health, Browsing history).
* Check the certification:
  * *"I certify that my extension adheres to the Chrome Web Store Developer Program Policies, including the Limited Use policy."*

---

## 3. How to Package the Extension for Upload

In the root of `ig_ultimate_extension/`, select all files and package them into a `.zip` archive:
* Make sure `manifest.json` is at the **root** of the zip file (not inside a subfolder).
* Exclude `.git/`, `.gitignore`, `README.md`, `LICENSE`, and `CWS_SUBMISSION_GUIDE.md`.
