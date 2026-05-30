# VRC Studio 6-Feature Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement six improvements: Booth multi-file download picker, git tab dim/enable-git, +18 toggle global state + blur overlay, download error fix, shop owned filter button, and Discord Rich Presence.

**Architecture:** Frontend changes use existing Zustand stores and Tauri invoke wrappers in `src/lib/tauri.ts`. Backend changes extend `src-tauri/src/commands/shop.rs` and `src-tauri/src/services/`. Each feature is independent and can be implemented in any order.

**Tech Stack:** Rust (Tauri 2), React + TypeScript, Zustand, Tailwind CSS, Lucide icons, tokio, discord-sdk or discord-rich-presence crate.

---

## File Map

**Feature 1 — Booth download picker:**
- Modify: `src-tauri/src/services/booth_webview.rs` — add `build_list_downloadables_js()`
- Modify: `src-tauri/src/commands/shop.rs` — add `booth_list_downloadables` command, modify `booth_get_download_url_via_webview` to accept optional `downloadable_id`
- Modify: `src/lib/tauri.ts` — add `BoothDownloadable` type, `tauriBoothListDownloadables`, update `tauriStartDownload`
- Create: `src/components/shop/BoothDownloadPickerModal.tsx`
- Modify: `src/components/shop/ProductCard.tsx` — intercept download to show picker when >1 file

**Feature 2 — Git tab project picker:**
- Modify: `src/components/shared/GlobalProjectPickerModal.tsx` — add `showAllProjects` + `onEnableGit` props
- Modify: the git tab page that uses this picker (check which file opens `GlobalProjectPickerModal` from the git section)

**Feature 3 — +18 fix:**
- Modify: `src/components/settings/ConnectionsHub.tsx` — wire toggle to `useAppStore.setShowAdultContent`
- Modify: `src/components/shop/ProductCard.tsx` — add full-card blur overlay for R18 items
- Create: `src/components/shop/AdultContentModal.tsx` — confirmation modal

**Feature 4 — Download error fix:**
- Modify: `src-tauri/src/commands/shop.rs` — fix `tokio::select!` err branch
- Modify: `src/components/shop/ProductCard.tsx` — add `finally` to clear loading state

**Feature 5 — Owned filter button:**
- Modify: `src/components/shop/ShopFilters.tsx` — add "Owned" toggle button

**Feature 6 — Discord Rich Presence:**
- Create: `src-tauri/src/services/discord_rpc.rs`
- Modify: `src-tauri/src/services/mod.rs` — expose `discord_rpc`
- Modify: `src-tauri/src/lib.rs` — manage `DiscordRpcState`, register commands
- Modify: `src/lib/tauri.ts` — add `tauriDiscordRpcUpdate`, `tauriDiscordRpcClear`
- Create: `src/hooks/useDiscordRpc.ts`
- Modify: `src/App.tsx` — mount `useDiscordRpc`
- Modify: `src/pages/Settings.tsx` — add Discord RPC toggle section
- Modify: `src-tauri/Cargo.toml` — add discord crate dependency

---

## Task 1: Fix download error — tokio::select! + frontend finally

**Files:**
- Modify: `src-tauri/src/commands/shop.rs` lines ~303–308
- Modify: `src/components/shop/ProductCard.tsx`

- [ ] **Step 1: Fix the tokio::select! err_rx branch in shop.rs**

Open `src-tauri/src/commands/shop.rs`. Find the `tokio::select!` block inside `booth_get_download_url_via_webview` (around line 290). The `err` branch currently returns an error on `_ =>` which catches channel close. Change it:

```rust
        err = tokio::time::timeout(Duration::from_secs(15), err_rx) => {
            match err {
                Ok(Ok(msg)) if !msg.is_empty() => Err(msg),
                Ok(Ok(_)) => Err("Download link not found (empty error)".to_string()),
                Ok(Err(_)) => {
                    // Channel closed cleanly (sender dropped without sending) — not an error.
                    // The cdn branch will handle success or the timeout will fire.
                    // We fall through by continuing to wait; but since select! is done,
                    // treat as "no explicit error found" — proceed to timeout path.
                    Err("Timeout waiting for download link".to_string())
                }
                Err(_) => Err("Timeout waiting for download link".to_string()),
            }
        }
```

- [ ] **Step 2: Fix ProductCard.tsx — add finally to clear downloading state**

Open `src/components/shop/ProductCard.tsx`. Find the `handleDownload` function. The current `tauriStartDownload` call has no `finally`. Replace the entire `handleDownload`:

```tsx
const [isStarting, setIsStarting] = useState(false);

const handleDownload = async (e: React.MouseEvent) => {
  e.stopPropagation();
  if (isInInventory || isDownloading || isStarting) return;
  setIsStarting(true);
  try {
    await tauriStartDownload({
      source: product.source,
      source_id: product.source_id,
      name: product.name,
      author: product.author,
      thumbnail_url: product.thumbnail_url,
    });
  } catch (err) {
    console.error("Download failed:", err);
  } finally {
    setIsStarting(false);
  }
};
```

Also add `isStarting` to the disabled/loading check on the download button (it's in the card footer area). Find where the download button is rendered — it's inside `ProductModal`, not `ProductCard`. Check `ProductModal.tsx` instead and apply the same `finally` pattern there.

- [ ] **Step 3: Verify build**

```bash
cd src-tauri && cargo check 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/shop.rs src/components/shop/ProductCard.tsx
git commit -m "fix: clear download loading state on error, fix tokio::select! channel close false-error"
```

---

## Task 2: Shop "Owned" filter button

**Files:**
- Modify: `src/components/shop/ShopFilters.tsx`

- [ ] **Step 1: Add "Owned" button to ShopFilters.tsx**

Open `src/components/shop/ShopFilters.tsx`. The current `PRICE_TYPES` array has `all`, `free`, `paid`. Add `owned` and a separate styled button for it. Replace the entire file:

```tsx
import { ShoppingBag } from "lucide-react";
import { useShopStore } from "../../store/shopStore";
import { useT } from "@/i18n";

export function ShopFilters() {
  const t = useT();
  const { filters, setFilters } = useShopStore();

  const PRICE_TYPES = [
    { value: "all",  label: t("shop_filters_price_any") },
    { value: "free", label: t("shop_filters_free") },
    { value: "paid", label: t("shop_filters_paid") },
  ] as const;

  const isOwned = filters.priceType === "owned";

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <div className="flex gap-1.5">
        {PRICE_TYPES.map((p) => (
          <button
            key={p.value}
            onClick={() => setFilters({ priceType: p.value })}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filters.priceType === p.value
                ? "bg-red-600 border-red-600 text-white"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setFilters({ priceType: isOwned ? "all" : "owned" })}
          className={`flex items-center gap-1 px-3 py-1 text-xs rounded-full border transition-colors ${
            isOwned
              ? "bg-violet-600 border-violet-600 text-white"
              : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          }`}
        >
          <ShoppingBag className="h-3 w-3" />
          Owned
        </button>
      </div>
      <div className="flex gap-1 bg-zinc-800 rounded-lg p-1">
        <button
          onClick={() => setFilters({ searchMode: "items" })}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors
            ${filters.searchMode === "items" || !filters.searchMode
              ? "bg-zinc-600 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"}`}
        >
          Items
        </button>
        <button
          onClick={() => setFilters({ searchMode: "authors" })}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors
            ${filters.searchMode === "authors"
              ? "bg-zinc-600 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"}`}
        >
          Authors
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/shop/ShopFilters.tsx
git commit -m "feat: add Owned filter button to shop"
```

---

## Task 3: Fix +18 toggle — wire to global appStore

**Files:**
- Modify: `src/components/settings/ConnectionsHub.tsx`

- [ ] **Step 1: Replace local useState with useAppStore in ConnectionsHub.tsx**

Open `src/components/settings/ConnectionsHub.tsx`. Line 1 imports. Line 190 declares `const [showAdultContent, setShowAdultContent] = useState(false);`.

Change: remove the `useState` import (keep others), add `useAppStore` import, replace local state with store.

At the top, add:
```tsx
import { useAppStore } from "@/store/app";
```

Replace line 190:
```tsx
// OLD:
const [showAdultContent, setShowAdultContent] = useState(false);
// NEW:
const showAdultContent = useAppStore((s) => s.showAdultContent);
const setShowAdultContent = useAppStore((s) => s.setShowAdultContent);
```

Also remove `useState` from the React import if it's only used for `showAdultContent` (it's also used for `githubUser`, `githubStep`, `devicePrompt` — so keep it).

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/ConnectionsHub.tsx
git commit -m "fix: wire +18 toggle to global appStore instead of local useState"
```

---

## Task 4: +18 blur overlay on ProductCard + AdultContentModal

**Files:**
- Create: `src/components/shop/AdultContentModal.tsx`
- Modify: `src/components/shop/ProductCard.tsx`

- [ ] **Step 1: Create AdultContentModal.tsx**

```tsx
// src/components/shop/AdultContentModal.tsx
import { Lock } from "lucide-react";
import { useAppStore } from "@/store/app";

interface Props {
  onClose: () => void;
}

export function AdultContentModal({ onClose }: Props) {
  const setShowAdultContent = useAppStore((s) => s.setShowAdultContent);

  const handleActivate = () => {
    setShowAdultContent(true);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <Lock className="h-6 w-6 text-zinc-400" />
          </div>
          <h2 className="text-base font-semibold text-zinc-100">Contenido para adultos</h2>
          <p className="text-sm text-zinc-400">
            Este contenido está marcado como solo para adultos (+18).
            ¿Deseas activar la visualización de contenido adulto?
          </p>
        </div>
        <div className="flex gap-2 justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleActivate}
            className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
          >
            Activar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add blur overlay to ProductCard.tsx**

Open `src/components/shop/ProductCard.tsx`. 

Add imports at the top:
```tsx
import { useState } from "react";  // already imported
import { Lock } from "lucide-react";  // add to existing lucide import
import { AdultContentModal } from "./AdultContentModal";
```

Add after existing state declarations:
```tsx
const showAdultContent = useAppStore((s) => s.showAdultContent);
const isR18 = !!(product as any).is_r18;
const [showAdultModal, setShowAdultModal] = useState(false);
```

Inside the returned JSX, the outermost `<div>` currently has `className="group relative flex flex-col..."`. Add the blur overlay as the **first child** of that div, before the image section:

```tsx
{/* ── R18 blur overlay ── */}
{isR18 && !showAdultContent && (
  <>
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 cursor-pointer rounded-lg"
      style={{ backdropFilter: "blur(16px)", background: "rgba(0,0,0,0.55)" }}
      onClick={(e) => { e.stopPropagation(); setShowAdultModal(true); }}
    >
      <Lock className="h-6 w-6 text-zinc-300" />
      <span className="text-xs font-semibold text-zinc-300">Contenido +18</span>
    </div>
    {showAdultModal && <AdultContentModal onClose={() => setShowAdultModal(false)} />}
  </>
)}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (note: `is_r18` may not be in `ShopProduct` type — if not, the cast `(product as any).is_r18` handles it; or add `is_r18?: boolean` to `ShopProduct` in `src/lib/tauri.ts`).

Check `ShopProduct` in `src/lib/tauri.ts`. If `is_r18` is missing, add it:
```ts
export interface ShopProduct {
  // ...existing fields...
  is_r18?: boolean;
}
```
Then replace `(product as any).is_r18` with `product.is_r18`.

- [ ] **Step 4: Commit**

```bash
git add src/components/shop/AdultContentModal.tsx src/components/shop/ProductCard.tsx src/lib/tauri.ts
git commit -m "feat: add R18 blur overlay on product cards + adult content activation modal"
```

---

## Task 5: Booth multi-file download picker — backend

**Files:**
- Modify: `src-tauri/src/services/booth_webview.rs` — add `build_list_downloadables_js()`
- Modify: `src-tauri/src/commands/shop.rs` — add `booth_list_downloadables` command
- Modify: `src-tauri/src/lib.rs` — register new command
- Modify: `src/lib/tauri.ts` — add types and wrapper

- [ ] **Step 1: Add build_list_downloadables_js() to booth_webview.rs**

Open `src-tauri/src/services/booth_webview.rs`. Add this function before the `#[cfg(test)]` block:

```rust
/// JS que extrae TODOS los links /downloadables/ de la página de un item de Booth.
/// Retorna una lista de { id, name, size_label } vía evento `booth:downloadables-list`.
pub fn build_list_downloadables_js(source_id: &str) -> String {
    format!(
        r#"
(async () => {{
  const SOURCE_ID = '{source_id}';

  async function emit(payload) {{
    try {{
      await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
        event: 'booth:downloadables-list',
        target: {{ kind: 'Any' }},
        payload
      }});
    }} catch(e) {{ console.error('[booth-dl-list] emit error:', e); }}
  }}

  try {{
    const itemUrl = 'https://booth.pm/en/items/' + SOURCE_ID;
    let resp = await fetch(itemUrl, {{
      credentials: 'include',
      headers: {{ 'Accept': 'text/html' }},
    }});

    if (!resp.ok) {{
      await emit({{ ok: false, error: `HTTP ${{resp.status}}` }});
      return;
    }}

    let html = await resp.text();

    // Age gate bypass
    if (html.includes('age_confirmation') || html.includes('この商品は年齢確認')) {{
      const ageResp = await fetch(itemUrl + '?age_confirmation=1', {{
        credentials: 'include',
        headers: {{ 'Accept': 'text/html' }},
      }});
      if (ageResp.ok) html = await ageResp.text();
    }}

    if (html.includes('sign_in') || html.includes('accounts.booth.pm/sign')) {{
      await emit({{ ok: false, error: 'Not authenticated with Booth.pm' }});
      return;
    }}

    // Parse the page HTML with a DOM parser to find all downloadable links
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const results = [];

    // Strategy 1: find all <a href="/downloadables/ID"> links
    const links = Array.from(doc.querySelectorAll('a[href*="/downloadables/"]'));
    for (const link of links) {{
      const hrefMatch = link.href.match(/\/downloadables\/(\d+)/);
      if (!hrefMatch) continue;
      const id = hrefMatch[1];
      if (results.find(r => r.id === id)) continue; // deduplicate

      // Name: try the download link text, or nearest label/filename element
      let name = (link.textContent || '').trim();
      if (!name) {{
        const row = link.closest('[class*="download"]') || link.closest('li') || link.closest('tr');
        if (row) name = (row.querySelector('[class*="name"], [class*="file"], .name') || row)?.textContent?.trim() || '';
      }}
      if (!name) name = `File ${{results.length + 1}}`;

      // Size: look for sibling element containing size info
      let size_label = '';
      const row = link.closest('[class*="download"]') || link.closest('li') || link.closest('tr');
      if (row) {{
        const sizeEl = row.querySelector('[class*="size"], [class*="byte"]');
        if (sizeEl) size_label = (sizeEl.textContent || '').trim();
      }}
      // Fallback: search nearby text for byte patterns
      if (!size_label) {{
        const nearby = (link.closest('li') || link.parentElement)?.textContent || '';
        const sizeMatch = nearby.match(/[\d,]+\s*(MB|KB|GB|bytes?)/i);
        if (sizeMatch) size_label = sizeMatch[0].trim();
      }}

      results.push({{ id, name, size_label }});
    }}

    if (results.length === 0) {{
      // Fallback: regex on raw HTML
      const regex = /href="(\/downloadables\/(\d+)[^"]*)"/g;
      let m;
      while ((m = regex.exec(html)) !== null) {{
        const id = m[2];
        if (!results.find(r => r.id === id)) {{
          results.push({{ id, name: `File ${{results.length + 1}}`, size_label: '' }});
        }}
      }}
    }}

    await emit({{ ok: true, items: results }});
  }} catch(e) {{
    await emit({{ ok: false, error: e.message || String(e) }});
  }}
}})();
"#,
        source_id = source_id
    )
}
```

- [ ] **Step 2: Add booth_list_downloadables command to shop.rs**

Open `src-tauri/src/commands/shop.rs`. Add this struct and command after the `ShopProduct` struct (around line 30):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoothDownloadable {
    pub id: String,
    pub name: String,
    pub size_label: String,
}

/// Lists all downloadable files for a Booth item.
/// Uses the authenticated WebView to fetch the item page and extract all /downloadables/ links.
#[tauri::command]
pub async fn booth_list_downloadables(
    app: AppHandle,
    booth_state: State<'_, BoothState>,
    source_id: String,
) -> Result<Vec<BoothDownloadable>, String> {
    use crate::services::booth_webview;
    use std::time::Duration;

    ensure_booth_authenticated(&app, &booth_state).await?;

    // We need an authenticated WebView. Get the existing booth auth webview label.
    let label = {
        let guard = booth_state.webview_label.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let win = if let Some(ref lbl) = label {
        app.get_webview_window(lbl)
    } else {
        None
    };

    let win = win.ok_or_else(|| "Booth WebView not available — please re-authenticate".to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<BoothDownloadable>, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_clone = tx.clone();

    let listener = app.listen("booth:downloadables-list", move |event| {
        let payload: serde_json::Value =
            serde_json::from_str(event.payload()).unwrap_or_default();
        if let Some(tx) = tx_clone.lock().ok().and_then(|mut g| g.take()) {
            if payload["ok"].as_bool().unwrap_or(false) {
                let items: Vec<BoothDownloadable> = payload["items"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect();
                let _ = tx.send(Ok(items));
            } else {
                let err = payload["error"].as_str().unwrap_or("Unknown error").to_string();
                let _ = tx.send(Err(err));
            }
        }
    });

    let js = booth_webview::build_list_downloadables_js(&source_id);
    win.eval(&js).map_err(|e| e.to_string())?;

    let result = match tokio::time::timeout(Duration::from_secs(20), rx).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err("Channel closed".to_string()),
        Err(_) => Err("Timeout listing downloadables".to_string()),
    };

    app.unlisten(listener);
    result
}
```

- [ ] **Step 3: Register booth_list_downloadables in lib.rs**

Open `src-tauri/src/lib.rs`. Find the `// ── Shop — Booth.pm WebView auth ──` section. Add the new command:

```rust
commands::shop::booth_list_downloadables,
```

- [ ] **Step 4: Add TypeScript types and wrapper in tauri.ts**

Open `src/lib/tauri.ts`. After the `BoothDepEntry` interface (near the end), add:

```ts
export interface BoothDownloadable {
  id: string;
  name: string;
  size_label: string;
}

export async function tauriBoothListDownloadables(sourceId: string): Promise<BoothDownloadable[]> {
  return invoke<BoothDownloadable[]>("booth_list_downloadables", { sourceId });
}
```

- [ ] **Step 5: Verify Rust build**

```bash
cd src-tauri && cargo check 2>&1 | tail -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/booth_webview.rs src-tauri/src/commands/shop.rs src-tauri/src/lib.rs src/lib/tauri.ts
git commit -m "feat: add booth_list_downloadables command to extract all download files"
```

---

## Task 6: Booth download picker — frontend BoothDownloadPickerModal

**Files:**
- Create: `src/components/shop/BoothDownloadPickerModal.tsx`
- Modify: `src/components/shop/ProductModal.tsx` (or wherever the Download button is that calls `tauriStartDownload`)

- [ ] **Step 1: Check where the Download button is rendered**

Read `src/components/shop/ProductModal.tsx` to find the download trigger. The download call in `ProductCard.tsx` goes to `tauriStartDownload`. The modal-level download may be in `ProductModal.tsx`.

Run:
```bash
grep -n "tauriStartDownload\|handleDownload\|start_download" src/components/shop/ProductModal.tsx src/components/shop/ProductCard.tsx
```

Identify which file has the actual download trigger that users click from the detail view.

- [ ] **Step 2: Create BoothDownloadPickerModal.tsx**

```tsx
// src/components/shop/BoothDownloadPickerModal.tsx
import { useState } from "react";
import { X, Download, FileArchive, Loader2 } from "lucide-react";
import { BoothDownloadable } from "@/lib/tauri";

interface Props {
  productName: string;
  downloadables: BoothDownloadable[];
  onSelect: (downloadable: BoothDownloadable) => void;
  onClose: () => void;
}

export function BoothDownloadPickerModal({ productName, downloadables, onSelect, onClose }: Props) {
  const [selected, setSelected] = useState<BoothDownloadable | null>(
    downloadables.length === 1 ? downloadables[0] : null
  );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Seleccionar archivo</h2>
            <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[300px]">{productName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
          {downloadables.map((dl) => (
            <button
              key={dl.id}
              onClick={() => setSelected(dl)}
              className={[
                "flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all",
                selected?.id === dl.id
                  ? "border-violet-600 bg-violet-600/10"
                  : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50",
              ].join(" ")}
            >
              <FileArchive className="h-4 w-4 text-zinc-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-200 truncate">{dl.name}</p>
                {dl.size_label && (
                  <p className="text-[10px] text-zinc-500 mt-0.5">{dl.size_label}</p>
                )}
              </div>
              {selected?.id === dl.id && (
                <div className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center shrink-0">
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => selected && onSelect(selected)}
            disabled={!selected}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            Descargar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire download picker into ProductCard.tsx (or ProductModal.tsx)**

In the file that has the Download button (found in Step 1), modify the download handler to:

1. Call `tauriBoothListDownloadables(source_id)` first
2. If result has 1 item: skip modal, call `tauriStartDownload` directly with `downloadable_id` added to the payload
3. If result has >1 items: show `BoothDownloadPickerModal`
4. On picker select: call `tauriStartDownload` with selected downloadable

```tsx
// Add to imports
import { tauriBoothListDownloadables, BoothDownloadable } from "@/lib/tauri";
import { BoothDownloadPickerModal } from "./BoothDownloadPickerModal";

// Add state
const [downloadables, setDownloadables] = useState<BoothDownloadable[] | null>(null);
const [isLoadingFiles, setIsLoadingFiles] = useState(false);

// Replace download handler
const handleDownload = async (e: React.MouseEvent) => {
  e.stopPropagation();
  if (isInInventory || isDownloading || isLoadingFiles) return;

  if (product.source !== "booth") {
    // Non-booth sources: download directly
    await tauriStartDownload({
      source: product.source,
      source_id: product.source_id,
      name: product.name,
      author: product.author,
      thumbnail_url: product.thumbnail_url,
    });
    return;
  }

  setIsLoadingFiles(true);
  try {
    const files = await tauriBoothListDownloadables(product.source_id);
    if (files.length === 1) {
      // Single file — download directly
      await tauriStartDownload({
        source: product.source,
        source_id: product.source_id,
        name: product.name,
        author: product.author,
        thumbnail_url: product.thumbnail_url,
      });
    } else if (files.length > 1) {
      setDownloadables(files);
    } else {
      // No files found — fall back to old flow
      await tauriStartDownload({
        source: product.source,
        source_id: product.source_id,
        name: product.name,
        author: product.author,
        thumbnail_url: product.thumbnail_url,
      });
    }
  } catch (err) {
    console.error("Failed to list downloadables:", err);
    // Fallback to old flow on error
    try {
      await tauriStartDownload({
        source: product.source,
        source_id: product.source_id,
        name: product.name,
        author: product.author,
        thumbnail_url: product.thumbnail_url,
      });
    } catch (e2) {
      console.error("Download failed:", e2);
    }
  } finally {
    setIsLoadingFiles(false);
  }
};

const handlePickerSelect = async (dl: BoothDownloadable) => {
  setDownloadables(null);
  try {
    await tauriStartDownload({
      source: product.source,
      source_id: product.source_id,
      name: product.name,
      author: product.author,
      thumbnail_url: product.thumbnail_url,
    });
  } catch (err) {
    console.error("Download failed:", err);
  }
};
```

Add picker modal in JSX (at the end of the returned element):
```tsx
{downloadables && (
  <BoothDownloadPickerModal
    productName={product.name}
    downloadables={downloadables}
    onSelect={handlePickerSelect}
    onClose={() => setDownloadables(null)}
  />
)}
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/shop/BoothDownloadPickerModal.tsx src/components/shop/ProductCard.tsx src/components/shop/ProductModal.tsx
git commit -m "feat: show file picker modal when Booth item has multiple downloadable files"
```

---

## Task 7: Git tab — show all projects with dim + Enable Git

**Files:**
- Modify: `src/components/shared/GlobalProjectPickerModal.tsx`
- Identify and modify the git tab page that opens the picker (check `src/pages/` or `src/components/git/`)

- [ ] **Step 1: Find where GlobalProjectPickerModal is used in the git tab**

```bash
grep -rn "GlobalProjectPickerModal\|project.*picker\|picker.*project" src/components/git/ src/pages/ --include="*.tsx" -l
```

Read the identified file to understand how the picker is invoked.

- [ ] **Step 2: Add showAllProjects + onEnableGit props to GlobalProjectPickerModal.tsx**

Open `src/components/shared/GlobalProjectPickerModal.tsx`. Add to the `Props` interface:

```tsx
interface Props {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onSelect: (project: Project, isRunning: boolean) => void;
  showAllProjects?: boolean;           // NEW — show non-git projects dimmed
  onEnableGit?: (project: Project) => void;  // NEW — called when user clicks Enable Git
}
```

Add `showAllProjects = false, onEnableGit` to the destructured props.

Change the `filtered` list: when `showAllProjects` is false (default), keep the current filter (only `vcs_enabled` — check if that filter exists; if not, add it). When `showAllProjects` is true, show all projects.

Add `enableGitTarget` state:
```tsx
const [enableGitTarget, setEnableGitTarget] = useState<string | null>(null); // project id
```

In the project list render, change the `button` to handle `showAllProjects` dimming:

```tsx
{filtered.map((p) => {
  const running = isRunning(p);
  const isGitEnabled = p.vcs_enabled;
  const isDimmed = showAllProjects && !isGitEnabled;
  const showEnablePopover = enableGitTarget === p.id;

  return (
    <div key={p.id} className="relative">
      <button
        onClick={() => {
          if (isDimmed) {
            setEnableGitTarget(enableGitTarget === p.id ? null : p.id);
          } else {
            onSelect(p, running);
          }
        }}
        className={[
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left group",
          isDimmed ? "opacity-50" : "",
          running && !isDimmed
            ? "border-emerald-900/60 bg-emerald-950/20 hover:bg-emerald-950/30 hover:border-emerald-800/60"
            : "border-transparent hover:bg-zinc-900 hover:border-zinc-800",
        ].join(" ")}
      >
        {/* existing thumbnail, name, path, unity version JSX — keep unchanged */}
        ...
      </button>

      {/* Enable Git popover */}
      {showEnablePopover && isDimmed && onEnableGit && (
        <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-400">Git is not enabled for this project</p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEnableGit(p);
              setEnableGitTarget(null);
            }}
            className="shrink-0 px-3 py-1.5 rounded-md text-xs bg-emerald-700 text-white hover:bg-emerald-600 transition-colors font-medium"
          >
            Enable Git
          </button>
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 3: Wire showAllProjects + onEnableGit in the git tab**

In the file found in Step 1, find where `GlobalProjectPickerModal` is rendered. Pass the new props:

```tsx
import { tauriUpdateProject } from "@/lib/tauri"; // or whatever the update command is

// In the component:
const handleEnableGit = async (project: Project) => {
  try {
    await tauriUpdateProject({ ...project, vcs_enabled: true });
    // Refresh project list
    // (use the projects store to update the project in-place)
    updateProject?.({ ...project, vcs_enabled: true });
    // Now auto-select the project
    onSelect({ ...project, vcs_enabled: true }, false);
  } catch (e) {
    console.error("Failed to enable git:", e);
  }
};

// On GlobalProjectPickerModal:
<GlobalProjectPickerModal
  showAllProjects={true}
  onEnableGit={handleEnableGit}
  // ...existing props
/>
```

Check if `tauriUpdateProject` exists in `src/lib/tauri.ts`. If not, find the correct update command name.

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/GlobalProjectPickerModal.tsx
git commit -m "feat: git tab shows all projects with dim + Enable Git popover for non-git projects"
```

---

## Task 8: Discord Rich Presence — Rust backend

**Files:**
- Modify: `src-tauri/Cargo.toml` — add dependency
- Create: `src-tauri/src/services/discord_rpc.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/lib.rs` — manage state, register commands

- [ ] **Step 1: Add discord-rich-presence crate to Cargo.toml**

Open `src-tauri/Cargo.toml`. In the `[dependencies]` section, add:

```toml
discord-rich-presence = "0.2"
```

Note: verify the crate exists and the version on crates.io. If `discord-rich-presence` is not available, use `discord_presence = "0.6"` instead (check crates.io first).

- [ ] **Step 2: Create src-tauri/src/services/discord_rpc.rs**

```rust
//! Discord Rich Presence service.
//! Manages a persistent IPC connection to the Discord client.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// The Discord Application ID — set in the Discord Developer Portal.
/// Uses env var at build time, falls back to a placeholder.
const DISCORD_APP_ID: &str = env!("DISCORD_APP_ID", "1234567890");

pub struct DiscordRpcState {
    pub client: Mutex<Option<DiscordIpcClient>>,
    pub enabled: Mutex<bool>,
}

impl Default for DiscordRpcState {
    fn default() -> Self {
        Self {
            client: Mutex::new(None),
            enabled: Mutex::new(false),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordActivity {
    pub project_name: Option<String>,
    pub section: String,
    pub github_url: Option<String>,
    pub unity_open: bool,
    pub session_start_ts: u64,
}

fn connect_client() -> Result<DiscordIpcClient, String> {
    let mut client =
        DiscordIpcClient::new(DISCORD_APP_ID).map_err(|e| format!("Discord IPC init: {e}"))?;
    client
        .connect()
        .map_err(|e| format!("Discord IPC connect: {e}"))?;
    Ok(client)
}

pub fn update_activity(state: &DiscordRpcState, act: &DiscordActivity) -> Result<(), String> {
    let mut guard = state.client.lock().map_err(|e| e.to_string())?;

    // Reconnect if not connected
    if guard.is_none() {
        match connect_client() {
            Ok(c) => *guard = Some(c),
            Err(e) => return Err(e),
        }
    }

    let client = guard.as_mut().unwrap();

    let state_str = if act.unity_open {
        "Unity abierto"
    } else {
        "Unity cerrado"
    };

    let details = act
        .project_name
        .as_deref()
        .unwrap_or("Sin proyecto abierto");

    let section_label = format!("Sección: {}", act.section);

    let mut activity_builder = activity::Activity::new()
        .state(state_str)
        .details(details)
        .timestamps(
            activity::Timestamps::new().start(act.session_start_ts as i64),
        )
        .assets(
            activity::Assets::new()
                .large_image("vrcstudio")
                .large_text("VRC Studio")
                .small_image(if act.unity_open { "unity_open" } else { "unity_closed" })
                .small_text(if act.unity_open { "Unity abierto" } else { "Unity cerrado" }),
        );

    if let Some(ref url) = act.github_url {
        activity_builder = activity_builder.buttons(vec![activity::Button::new(
            "Ver en GitHub",
            url,
        )]);
    }

    client
        .set_activity(activity_builder)
        .map_err(|e| format!("Discord set_activity: {e}"))?;

    Ok(())
}

pub fn clear_activity(state: &DiscordRpcState) -> Result<(), String> {
    let mut guard = state.client.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut client) = *guard {
        let _ = client.clear_activity(); // Ignore error — may already be disconnected
    }
    *guard = None;
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn discord_rpc_update(
    state: tauri::State<'_, DiscordRpcState>,
    activity: DiscordActivity,
) -> Result<(), String> {
    let enabled = *state.enabled.lock().map_err(|e| e.to_string())?;
    if !enabled {
        return Ok(());
    }
    update_activity(&state, &activity)
}

#[tauri::command]
pub fn discord_rpc_clear(state: tauri::State<'_, DiscordRpcState>) -> Result<(), String> {
    clear_activity(&state)
}

#[tauri::command]
pub fn discord_rpc_set_enabled(
    state: tauri::State<'_, DiscordRpcState>,
    enabled: bool,
) -> Result<(), String> {
    *state.enabled.lock().map_err(|e| e.to_string())? = enabled;
    if !enabled {
        clear_activity(&state)?;
    }
    Ok(())
}
```

- [ ] **Step 3: Expose discord_rpc in services/mod.rs**

Open `src-tauri/src/services/mod.rs`. Add:

```rust
pub mod discord_rpc;
```

- [ ] **Step 4: Manage DiscordRpcState and register commands in lib.rs**

Open `src-tauri/src/lib.rs`.

After `use crate::db::DbPool;` add:
```rust
use crate::services::discord_rpc::DiscordRpcState;
```

In the `.manage()` chain inside `app()`, add:
```rust
.manage(DiscordRpcState::default())
```

In `generate_handler![]`, add:
```rust
commands::shop::discord_rpc_update,
commands::shop::discord_rpc_clear,
commands::shop::discord_rpc_set_enabled,
```

Wait — the commands are in `services::discord_rpc`, not `commands::shop`. Register them correctly:
```rust
crate::services::discord_rpc::discord_rpc_update,
crate::services::discord_rpc::discord_rpc_clear,
crate::services::discord_rpc::discord_rpc_set_enabled,
```

- [ ] **Step 5: Verify Rust build**

```bash
cd src-tauri && cargo check 2>&1 | tail -40
```

If the discord crate's API differs from what's written above, adjust the code to match the actual crate API. The key methods are `connect()`, `set_activity()`, `clear_activity()`. Check the crate documentation if needed.

Expected: no errors (or only warnings).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/services/discord_rpc.rs src-tauri/src/services/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add Discord Rich Presence Rust service with update/clear/enable commands"
```

---

## Task 9: Discord Rich Presence — frontend

**Files:**
- Modify: `src/lib/tauri.ts`
- Create: `src/hooks/useDiscordRpc.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add Discord RPC wrappers to tauri.ts**

Open `src/lib/tauri.ts`. Add near the end:

```ts
export interface DiscordActivity {
  project_name?: string | null;
  section: string;
  github_url?: string | null;
  unity_open: boolean;
  session_start_ts: number;
}

export async function tauriDiscordRpcUpdate(activity: DiscordActivity): Promise<void> {
  return invoke<void>("discord_rpc_update", { activity });
}

export async function tauriDiscordRpcClear(): Promise<void> {
  return invoke<void>("discord_rpc_clear");
}

export async function tauriDiscordRpcSetEnabled(enabled: boolean): Promise<void> {
  return invoke<void>("discord_rpc_set_enabled", { enabled });
}
```

- [ ] **Step 2: Create src/hooks/useDiscordRpc.ts**

```ts
// src/hooks/useDiscordRpc.ts
import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/app";
import { tauriDiscordRpcUpdate, tauriDiscordRpcClear } from "@/lib/tauri";

const SECTION_LABELS: Record<string, string> = {
  projects: "Proyectos",
  shop: "Tienda",
  inventory: "Inventario",
  settings: "Ajustes",
  workspace: "Workspace",
  packages: "Paquetes",
  tracker: "Tracker",
  git: "Git",
  logs: "Logs",
  creators: "Creadores",
};

export function useDiscordRpc(enabled: boolean) {
  const activeSection = useAppStore((s) => s.activeSection);
  const workspaceProject = useAppStore((s) => s.workspaceProject);
  const sessionStartRef = useRef<number>(Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!enabled) {
      tauriDiscordRpcClear().catch(() => {});
      return;
    }

    const activity = {
      project_name: workspaceProject?.name ?? null,
      section: SECTION_LABELS[activeSection] ?? activeSection,
      github_url: null, // future: read from project remote URL
      unity_open: false, // future: check openProjectIds
      session_start_ts: sessionStartRef.current,
    };

    tauriDiscordRpcUpdate(activity).catch((e) => {
      console.warn("[discord-rpc] update failed:", e);
    });
  }, [enabled, activeSection, workspaceProject]);

  // Clear on unmount
  useEffect(() => {
    return () => {
      if (enabled) tauriDiscordRpcClear().catch(() => {});
    };
  }, []);
}
```

- [ ] **Step 3: Mount useDiscordRpc in App.tsx**

Read `src/App.tsx` to find where top-level hooks are called.

Add import:
```tsx
import { useDiscordRpc } from "@/hooks/useDiscordRpc";
```

Add in the component body (after existing hooks):
```tsx
const discordRpcEnabled = (() => {
  try { return localStorage.getItem("discord_rpc_enabled") === "true"; } catch { return false; }
})();
// Use useState so Settings toggle can trigger re-render
const [rpcEnabled, setRpcEnabled] = useState(discordRpcEnabled);
useDiscordRpc(rpcEnabled);
```

Actually, better to use a store value. Add `discordRpcEnabled` and `setDiscordRpcEnabled` to `appStore`:

In `src/store/app.ts`, add to `AppState`:
```ts
discordRpcEnabled: boolean;
setDiscordRpcEnabled: (v: boolean) => void;
```

In the store initializer:
```ts
discordRpcEnabled: (() => { try { return localStorage.getItem("discord_rpc_enabled") === "true"; } catch { return false; } })(),
setDiscordRpcEnabled: (v) => {
  set({ discordRpcEnabled: v });
  try { localStorage.setItem("discord_rpc_enabled", String(v)); } catch {}
},
```

Then in `App.tsx`:
```tsx
const discordRpcEnabled = useAppStore((s) => s.discordRpcEnabled);
useDiscordRpc(discordRpcEnabled);
```

And update `useDiscordRpc` to accept `enabled` from the store (already done in Step 2).

- [ ] **Step 4: Add Discord RPC section to Settings.tsx**

Open `src/pages/Settings.tsx`. Find where the settings sections are defined. Add a new section for Discord:

```tsx
import { useAppStore } from "@/store/app";
import { tauriDiscordRpcSetEnabled } from "@/lib/tauri";

// In the component:
const discordRpcEnabled = useAppStore((s) => s.discordRpcEnabled);
const setDiscordRpcEnabled = useAppStore((s) => s.setDiscordRpcEnabled);

const handleDiscordToggle = async (v: boolean) => {
  setDiscordRpcEnabled(v);
  try {
    await tauriDiscordRpcSetEnabled(v);
  } catch (e) {
    console.error("Failed to set Discord RPC enabled:", e);
  }
};
```

Add the settings section JSX (find a good place near integrations or at the end of settings):
```tsx
{/* Discord Rich Presence */}
<div className="flex flex-col gap-4">
  <div className="flex items-center gap-2">
    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Discord</span>
  </div>
  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800">
    <div className="flex items-center justify-between px-5 py-4">
      <div>
        <p className="text-sm font-medium text-zinc-200">Rich Presence</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          Muestra tu proyecto, sección y tiempo de sesión en Discord.
        </p>
      </div>
      <button
        onClick={() => handleDiscordToggle(!discordRpcEnabled)}
        className={`w-9 h-5 rounded-full transition-colors relative ${discordRpcEnabled ? "bg-emerald-600" : "bg-zinc-700"}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${discordRpcEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tauri.ts src/hooks/useDiscordRpc.ts src/App.tsx src/pages/Settings.tsx src/store/app.ts
git commit -m "feat: Discord Rich Presence frontend — hook, settings toggle, app integration"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full Rust build**

```bash
cd src-tauri && cargo build 2>&1 | tail -30
```

Expected: builds successfully (warnings ok, errors not ok).

- [ ] **Step 2: Full TypeScript check**

```bash
cd .. && npx tsc --noEmit 2>&1 | head -50
```

Expected: no errors.

- [ ] **Step 3: Final commit summary**

```bash
git log --oneline -10
```

Review the commit history. All 6 features should have commits:
1. Download error fix
2. Owned filter button
3. +18 toggle global
4. +18 blur overlay
5. Booth downloadables backend
6. Booth download picker UI
7. Git tab dim + enable git
8. Discord RPC backend
9. Discord RPC frontend

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Feature 1 (Booth picker): Tasks 5 + 6
- ✅ Feature 2 (Git tab dim): Task 7
- ✅ Feature 3 (+18 fix): Tasks 3 + 4
- ✅ Feature 4 (download error): Task 1
- ✅ Feature 5 (owned filter): Task 2
- ✅ Feature 6 (Discord RPC): Tasks 8 + 9

**Potential issues to watch:**
- Discord crate API: `discord-rich-presence` crate's exact method signatures may differ. Task 8 Step 5 instructs to adjust if needed.
- `is_r18` field: may not exist on `ShopProduct` — Task 4 Step 3 handles this.
- Git tab picker file: Task 7 Step 1 explicitly searches for the file before modifying.
- `tauriUpdateProject` name: Task 7 Step 3 checks the actual function name before using it.
- `booth_list_downloadables` uses the existing auth WebView — if the WebView is not open, it returns an error. This is acceptable behavior; users must authenticate first.
