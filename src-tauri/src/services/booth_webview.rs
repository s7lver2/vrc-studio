//! Booth.pm WebView auth service.
//!
//! Mismo patrón que ripper_webview: abrimos un WebView en booth.pm,
//! el usuario se loguea, detectamos la URL post-login y ocultamos la ventana.
//! La sesión (cookies) vive en el WebView mientras el proceso esté corriendo.

pub const WEBVIEW_LABEL: &str = "booth-auth";
pub const BOOTH_ORIGIN: &str = "https://booth.pm";

// ── URL helpers ────────────────────────────────────────────────────────────────

/// Devuelve true si la URL indica que el usuario ya completó el login
/// (es decir, no está en las páginas de autenticación de accounts.booth.pm).
pub fn is_logged_in_url(url: &str) -> bool {
    let on_auth_page = url.contains("accounts.booth.pm/sign_in")
        || url.contains("accounts.booth.pm/sign_up")
        || url.contains("accounts.booth.pm/users/sign_in")
        || url.contains("accounts.booth.pm/users/sign_up");
    !on_auth_page && url.contains("booth.pm")
}

// ── JS inyectable ──────────────────────────────────────────────────────────────

/// JS que lee window.location.href y lo emite como `booth:current-url`.
/// Se usa como fallback rápido cuando el WebView ya tenía sesión activa.
pub fn build_url_check_js() -> &'static str {
    r#"
(async () => {
  await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
    event: 'booth:current-url',
    target: { kind: 'Any' },
    payload: { url: window.location.href }
  });
})();
    "#
}

/// JS que verifica el estado de sesión inspeccionando el DOM actual de booth.pm.
///
/// No usamos fetch porque:
/// - booth.pm/account/purchases → 404
/// - accounts.booth.pm/orders  → CORS bloqueado desde origen booth.pm
///
/// Estrategia DOM: en booth.pm sin sesión el nav muestra un link a sign_in.
/// Con sesión activa ese link desaparece y aparece el avatar/menú de cuenta.
/// Esperamos 500ms para que la hidratación JS de Booth complete el nav.
pub fn build_session_check_js() -> &'static str {
    r#"
(async () => {
  // Dar tiempo a que el nav de Booth se hidrate tras la carga de la página.
  await new Promise(r => setTimeout(r, 500));

  // Sin sesión: hay un link de sign_in visible en el nav o en el body.
  // Con sesión: ese link no existe; en su lugar aparece el avatar del usuario.
  const hasSignInLink = !!(
    document.querySelector('a[href*="sign_in"]') ||
    document.querySelector('a[href*="accounts.booth.pm/sign"]')
  );

  await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
    event: 'booth:session-check',
    target: { kind: 'Any' },
    payload: { loggedIn: !hasSignInLink, url: window.location.href }
  });
})();
    "#
}

/// JS que extrae los IDs de items del DOM de accounts.booth.pm/orders o /library
/// (página ya navegada por Rust). Espera a que el DOM esté listo antes de leer.
pub fn build_fetch_purchases_js(page: u32) -> String {
    format!(
        r#"
(async () => {{
    try {{
        await new Promise(r => setTimeout(r, 2000)); // Esperar carga inicial
        const currentUrl = window.location.href;
        if (currentUrl.includes('sign_in') || currentUrl.includes('sign_up')) {{
            await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
                event: 'booth:purchases-page',
                target: {{ kind: 'Any' }},
                payload: {{ ok: false, error: 'redirected_to_login', page: {page}, has_more: false }}
            }});
            return;
        }}

        // Buscar enlaces que contengan /items/ (tanto en /orders como /library)
        const links = Array.from(document.querySelectorAll('a[href*="/items/"]'));
        const ids = [];
        const seen = new Set();
        for (const a of links) {{
            const match = a.href.match(/\/items\/(\d+)/);
            if (match && !seen.has(match[1])) {{
                seen.add(match[1]);
                ids.push(match[1]);
            }}
        }}

        // También buscar elementos con data-product-id
        const cards = Array.from(document.querySelectorAll('[data-product-id]'));
        for (const card of cards) {{
            const id = card.getAttribute('data-product-id');
            if (id && !seen.has(id)) {{
                seen.add(id);
                ids.push(id);
            }}
        }}

        const has_more = !!(
          document.querySelector('.pagination .next') ||
          document.querySelector('a[rel="next"]') ||
          document.querySelector('.next_page') ||
          document.querySelector('[data-next-page]')
        );
        await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
            event: 'booth:purchases-page',
            target: {{ kind: 'Any' }},
            payload: {{ ok: true, ids, page: {page}, has_more }}
        }});
    }} catch (e) {{
        await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
            event: 'booth:purchases-page',
            target: {{ kind: 'Any' }},
            payload: {{ ok: false, error: e.message, page: {page}, has_more: false }}
        }});
    }}
}})();
"#,
        page = page
    )
}
/// Construye el JS que obtiene la URL de descarga de un item de Booth.
///
/// Estrategia v3 — fetch desde el webview autenticado:
///   En lugar de navegar el WebView al item y esperar a que el DOM cargue
///   (lo que provoca `DOM load timeout` porque booth.pm nunca llega a
///   `readyState === 'complete'` en contexto headless), hacemos un `fetch()`
///   desde el propio WebView, que ya está en booth.pm con las cookies de sesión.
///   Al ser mismo origen, las cookies se envían automáticamente con
///   `credentials: 'include'`. Parseamos el HTML de respuesta con regex y
///   extraemos el link `/downloadables/ID`.
///
///   El WebView puede estar en CUALQUIER página de booth.pm — no importa.
///   No se produce ninguna navegación visible ni cambio de URL.
/// Construye el JS que obtiene la URL de descarga de un item de Booth.
/// Construye el JS que obtiene la URL de descarga de un item de Booth.
pub fn build_get_download_url_js(source_id: &str) -> String {
    format!(
        r#"
(async () => {{
  const SOURCE_ID = '{source_id}';

  async function emit(payload) {{
    try {{
      await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
        event: 'booth:download-url',
        target: {{ kind: 'Any' }},
        payload
      }});
    }} catch(e) {{ console.error('[booth-dl] emit error:', e); }}
  }}

  async function emitDebug(level, msg, extra) {{
    try {{
      await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
        event: 'booth:download-debug',
        target: {{ kind: 'Any' }},
        payload: {{ level, msg, ...(extra || {{}}) }}
      }});
    }} catch(_) {{}}
  }}

  function parseDownloadablesUrl(html) {{
    let m = html.match(/href="(\/downloadables\/[^"]+)"/);
    if (m) return 'https://booth.pm' + m[1];
    m = html.match(/href="(https?:\/\/booth\.pm\/downloadables\/[^"]+)"/);
    if (m) return m[1];
    m = html.match(/"url"\s*:\s*"(https?:\/\/[^"]*downloadables[^"]*)"/);
    if (m) return m[1];
    m = html.match(/"url"\s*:\s*"(\/downloadables\/[^"]*)"/);
    if (m) return 'https://booth.pm' + m[1];
    return null;
  }}

  try {{
    const itemUrl = 'https://booth.pm/en/items/' + SOURCE_ID;
    await emitDebug('info', 'Fetching item page', {{ url: itemUrl }});

    let resp = await fetch(itemUrl, {{
      credentials: 'include',
      headers: {{ 'Accept': 'text/html' }},
    }});

    await emitDebug('info', 'Response received', {{ status: resp.status, finalUrl: resp.url }});

    if (!resp.ok) {{
      await emit({{ ok: false, error: `HTTP ${{resp.status}}` }});
      return;
    }}

    let html = await resp.text();

    // Manejar age gate (items con age_restriction)
    if (html.includes('age_confirmation') || html.includes('この商品は年齢確認')) {{
      await emitDebug('info', 'Age gate detected, fetching with age_confirmation=1', {{}});
      try {{
        const ageResp = await fetch(itemUrl + '?age_confirmation=1', {{
          credentials: 'include',
          headers: {{ 'Accept': 'text/html' }},
        }});
        if (ageResp.ok) html = await ageResp.text();
      }} catch(ageErr) {{
        await emitDebug('warn', 'Age gate bypass failed', {{ error: String(ageErr) }});
      }}
    }}

    const snippet = html.substring(0, 2000);
    await emitDebug('debug', 'HTML snippet', {{ snippet }});

    // Detectar si la página es de login
    if (html.includes('sign_in') || html.includes('accounts.booth.pm/sign')) {{
      await emit({{ ok: false, error: 'Not authenticated with Booth.pm' }});
      return;
    }}

    // Detectar si el item existe
    if (html.includes('This item is not available') || html.includes('404')) {{
      await emit({{ ok: false, error: 'Item not found (maybe removed or private)' }});
      return;
    }}

    const downloadablesUrl = parseDownloadablesUrl(html);
    if (!downloadablesUrl) {{
      const hasBuyButton = html.includes('Add to cart') || html.includes('購入する');
      const msg = hasBuyButton
        ? 'You have not purchased this item. Please buy it on Booth first.'
        : 'No download link found. The item may not be purchased, or Booth changed its layout.';
      await emit({{ ok: false, error: msg }});
      return;
    }}

    await emit({{ ok: true, url: downloadablesUrl }});
  }} catch(e) {{
    await emit({{ ok: false, error: e.message || String(e) }});
  }}
}})();
"#,
        source_id = source_id
    )
}

/// JS que se ejecuta en una ventana efímera para obtener la URL final de descarga.
pub fn build_ephemeral_download_js(source_id: &str) -> String {
    format!(
        r#"
(async () => {{
    const sourceId = '{source_id}';
    const itemUrl = 'https://booth.pm/en/items/' + sourceId;

    async function emit(payload) {{
        await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
            event: 'booth:ephemeral-dl',
            target: {{ kind: 'Any' }},
            payload
        }});
    }}

    try {{
        // 1. Obtener HTML del item
        let resp = await fetch(itemUrl, {{ credentials: 'include' }});
        if (!resp.ok) throw new Error(`HTTP ${{resp.status}}`);
        let html = await resp.text();

        // 2. Manejar age gate si el item tiene age restriction
        if (html.includes('age_confirmation') || html.includes('age-confirmation') ||
            html.includes('この商品は年齢確認')) {{
            const ageUrl = itemUrl + (itemUrl.includes('?') ? '&' : '?') + 'age_confirmation=1';
            const ageResp = await fetch(ageUrl, {{
                credentials: 'include',
                headers: {{ 'Accept': 'text/html' }},
            }});
            if (ageResp.ok) {{
                html = await ageResp.text();
            }}
        }}

        // 3. Extraer URL de downloadables
        let match = html.match(/href="(\/downloadables\/[^"]+)"/);
        if (!match) match = html.match(/href="(https?:\/\/booth\.pm\/downloadables\/[^"]+)"/);
        if (!match) throw new Error('No downloadables link found');
        let dlUrl = match[1];
        if (dlUrl.startsWith('/')) dlUrl = 'https://booth.pm' + dlUrl;

        // 4. Seguir redirect (evita CORS porque usamos fetch con redirect)
        const dlResp = await fetch(dlUrl, {{ credentials: 'include', redirect: 'follow' }});
        const finalUrl = dlResp.url;

        await emit({{ ok: true, url: finalUrl }});
    }} catch (e) {{
        await emit({{ ok: false, error: e.message || String(e) }});
    }}
}})();
"#,
        source_id = source_id
    )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_logged_in_url_on_booth_home() {
        assert!(is_logged_in_url("https://booth.pm/"));
        assert!(is_logged_in_url("https://booth.pm/en/search/airi"));
        assert!(is_logged_in_url("https://booth.pm/account/purchases"));
    }

    #[test]
    fn test_is_logged_in_url_on_auth_pages() {
        assert!(!is_logged_in_url("https://accounts.booth.pm/sign_in"));
        assert!(!is_logged_in_url("https://accounts.booth.pm/users/sign_in"));
        assert!(!is_logged_in_url("https://accounts.booth.pm/sign_up"));
    }

    #[test]
    fn test_build_fetch_purchases_js_contains_page() {
        let js = build_fetch_purchases_js(3);
        // El payload lleva "page: 3" (no "page=3" — eso era una URL de paginación antigua)
        assert!(js.contains("page: 3"), "debe incluir número de página en el payload");
        assert!(js.contains("booth:purchases-page"));
        assert!(js.contains("__TAURI_INTERNALS__"));
        // Debe esperar a que la página cargue y loguear en consola
        assert!(js.contains("document.readyState"));
        assert!(js.contains("console.log"));
        assert!(js.contains("sign_in"), "debe detectar redirect a login");
    }
    #[test]
    fn test_build_get_download_url_js_uses_fetch_not_dom() {
        let js = build_get_download_url_js("1234567");
        // v3: usa fetch() al item page, no scraping del DOM actual
        assert!(js.contains("fetch(itemUrl"), "JS debe hacer fetch al item page");
        assert!(js.contains("credentials: 'include'"), "JS debe incluir cookies");
        assert!(js.contains("booth:download-url"), "JS debe emitir el evento correcto");
        assert!(js.contains("1234567"), "JS debe incluir el source_id");
        // No debe esperar readyState (causa el timeout)
        assert!(!js.contains("readyState !== 'complete'"), "JS NO debe esperar readyState complete");
        // No debe navegar por su cuenta
        assert!(!js.contains("window.location.href ="), "JS NO debe auto-navegar");
    }

    #[test]
    fn test_build_get_download_url_js_has_multiple_downloadables_patterns() {
        let js = build_get_download_url_js("9999999");
        // Debe buscar el patrón relativo y absoluto en el HTML
        assert!(js.contains("downloadables"), "JS debe buscar /downloadables/");
        assert!(js.contains("booth.pm' + rel[1]") || js.contains("booth.pm' + anyRel[1]"),
            "JS debe construir URL absoluta desde relativa");
        // Debe tener fallback si el CDN fetch falla
        assert!(js.contains("CDN fetch"), "JS debe tener fallback al CDN redirect");
    }

    #[test]
    fn test_build_get_download_url_js_emits_debug_on_missing_link() {
        let js = build_get_download_url_js("9999999");
        // Debe emitir snapshot para diagnóstico si no encuentra la URL
        assert!(js.contains("booth:download-debug"), "JS debe emitir debug");
        assert!(js.contains("hasLogin"), "JS debe detectar redirección a login");
    }
}