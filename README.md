# IG Bulk Downloader Ultimate

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](manifest.json)
[![Buy Me a Coffee](https://img.shields.io/badge/Donate-Buy%20Me%20A%20Coffee-ffdd00.svg)](https://buymeacoffee.com/theinfinox)

A high-performance, private, client-side Chrome Extension (Manifest V3) to bulk download Instagram posts, carousels, and saved collections directly to your local computer in full resolution.

---

## ⚖️ Legal & Fair Use Disclaimer

> **IMPORTANT:**  
> This extension is an independent, client-side open-source utility developed strictly for personal data archiving, backup, and educational research purposes.  
> It is **not affiliated with, associated with, authorized, endorsed by, or in any way officially connected to Instagram, Meta Platforms, Inc.**, or any of their subsidiaries.  
> The name "Instagram" as well as related names, marks, emblems, and images are registered trademarks of their respective owners.  
> Users are solely responsible for ensuring their usage complies with Instagram's Terms of Use, applicable local laws, and the intellectual property rights of original content creators. **Do not use this software for commercial redistribution or unauthorized scraping.**

---

## ✨ Features

* **🏎️ Adaptive Auto-Scroll Engine:**  
  Automatically scrolls collections and profile feeds with adjustable network pacing:
  * `⚡ Fast (~300ms)` - Default for broadband/fiber connections.
  * `🏎️ Blazing (~150ms)` - Ultra-low-latency instant jumping with zero animation lag.
  * `🛡️ Balanced (~700ms)` - Safe pacing for shared connections.
  * `⏳ Throttled (~1.5s)` - Ideal for slow or harsh networks.
* **🛡️ 2-Stage Smart End Verification:**  
  Detects the true end of collections with non-bouncing micro-nudges, ensuring no lazy-loaded posts are left behind.
* **🧹 Scoped Ephemeral Queues:**  
  Queues are strictly scoped to the active page view. Navigating to a new collection or refreshing the page automatically resets the queue to zero—no leftover links from past sessions or other profiles.
* **📦 100% Client-Side Offline ZIP:**  
  Bundles multiple posts into organized, structured `.zip` files completely inside the browser using `JSZip` and Chrome's Offscreen Document API. Zero data leaves your machine.
* **📁 Clean Folder Hierarchy:**  
  Single-image posts download directly, while multi-slide carousels are neatly extracted into subfolders (`Post_Title/1.jpg`, `2.jpg`).
* **🔄 Native Auto-Recovery:**  
  Detects and automatically clicks Instagram's native "Retry" / "Try again" buttons if pagination temporarily stumbles.
* **🔒 Zero Telemetry & Privacy Focused:**  
  No tracking, no analytics, no third-party APIs, and no external servers. Operates using your existing logged-in browser session.

---

## 📥 Installation

1. Clone or download this repository to your computer:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ig-bulk-downloader.git
   ```
2. Open Google Chrome (or any Chromium browser such as Brave, Edge, or Vivaldi).
3. Navigate to:
   ```text
   chrome://extensions/
   ```
4. Enable **Developer mode** using the toggle switch in the top-right corner.
5. Click **Load unpacked** in the top-left corner.
6. Select the `ig_ultimate_extension` folder.
7. The extension icon will now appear in your browser toolbar!

---

## 🚀 How to Use

1. Navigate to any Instagram page (e.g. your **Saved Collections**, a **Profile Grid**, or an Explore feed).
2. Click the **IG Bulk Downloader** icon in your toolbar.
3. Choose your desired **Target Limit** (e.g., `100` posts, or `0` for All until the end of the collection).
4. Click **`📜 Start Auto-Scroll`**. The extension will smoothly harvest the post links in the current view.
5. When scrolling finishes, select your preferred speed mode (`Turbo`, `Balanced`, or `Extreme`) and click **`▶ Start`**.
6. Your media will be compiled into a neat ZIP archive in your default Downloads directory!

---

## ☕ Support the Project

If this tool saved you time or made your workflow easier, consider supporting its open-source maintenance:

[![Buy Me a Coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=☕&slug=theinfinox&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/theinfinox)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — see the LICENSE file for details.
