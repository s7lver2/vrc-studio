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
    // Esperar a que la página cargue completamente (máx 8s)
    if (document.readyState !== 'complete') {{
      await new Promise((resolve, reject) => {{
        const t = setTimeout(() => reject(new Error('timeout')), 8000);
        window.addEventListener('load', () => {{ clearTimeout(t); resolve(); }}, {{ once: true }});
      }});
    }}
    // 400ms extra para hidratación JS de la página
    await new Promise(r => setTimeout(r, 400));

    const currentUrl = window.location.href;
    console.log('[VRCStudio] booth scrape | url:', currentUrl, '| page: {page}');

    // Si nos redirigieron al login, abortar
    if (currentUrl.includes('sign_in') || currentUrl.includes('sign_up')) {{
      console.warn('[VRCStudio] booth scrape aborted — redirigido a login');
      await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
        event: 'booth:purchases-page',
        target: {{ kind: 'Any' }},
        payload: {{ ok: false, error: 'redirected_to_login', page: {page}, has_more: false }}
      }});
      return;
    }}

    // Buscar links a items (funcionan en /orders y en /library)
    const itemLinks = Array.from(document.querySelectorAll('a[href*="/items/"]'));
    console.log('[VRCStudio] booth scrape | links encontrados:', itemLinks.length);

    const seen = new Set();
    const ids = itemLinks
      .map(a => {{
        const m = (a.href || '').match(/\/items\/(\d+)/);
        return m ? m[1] : null;
      }})
      .filter(id => id && !seen.has(id) && seen.add(id));

    console.log('[VRCStudio] booth scrape | IDs únicos:', ids.length, ids.slice(0, 5));

    // Si esta página tiene items, puede haber más en la siguiente
    const has_more = ids.length >= 1;

    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'booth:purchases-page',
      target: {{ kind: 'Any' }},
      payload: {{ ok: true, ids, page: {page}, has_more }}
    }});
  }} catch (e) {{
    console.error('[VRCStudio] booth scrape error:', e.message);
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'booth:purchases-page',
      target: {{ kind: 'Any' }},
      payload: {{ ok: false, error: e.message, page: {page}, has_more: false }}
    }});
  }}
}})();
        "#,
        page = page,
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

  async function emitDebug(msg, extra) {{
    try {{
      await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
        event: 'booth:download-debug',
        target: {{ kind: 'Any' }},
        payload: {{ msg, ...(extra || {{}}) }}
      }});
    }} catch(_) {{}}
  }}

  /// Extrae el link de downloadables del HTML de la página del item.
  /// Booth incrusta la URL en el atributo href de un <a> o dentro de un
  /// bloque JSON embebido en el HTML (Stimulus/Turbo).
  function parseDownloadablesUrl(html) {{
    // Patrón 1: href="/downloadables/XXXX" o href="https://booth.pm/downloadables/XXXX"
    const rel = html.match(/href="(\/downloadables\/[^"]+)"/);
    if (rel) return 'https://booth.pm' + rel[1];

    const abs = html.match(/href="(https?:\/\/booth\.pm\/downloadables\/[^"]+)"/);
    if (abs) return abs[1];

    // Patrón 2: "url":"https://booth.pm/downloadables/..." (JSON en data-controller o similar)
    const jsonAbs = html.match(/"url"\s*:\s*"(https?:\/\/[^"]*downloadables[^"]*)"/);
    if (jsonAbs) return jsonAbs[1];

    const jsonRel = html.match(/"url"\s*:\s*"(\/downloadables\/[^"]*)"/);
    if (jsonRel) return 'https://booth.pm' + jsonRel[1];

    // Patrón 3: cualquier ocurrencia de /downloadables/ fuera de atributo href
    const any = html.match(/["'](https?:\/\/booth\.pm\/downloadables\/[^"']+)["']/);
    if (any) return any[1];

    const anyRel = html.match(/["'](\/downloadables\/[^"'?#]+)["']/);
    if (anyRel) return 'https://booth.pm' + anyRel[1];

    return null;
  }}

  try {{
    const itemUrl = 'https://booth.pm/en/items/' + SOURCE_ID;
    console.log('[booth-dl] fetching item page:', itemUrl);
    await emitDebug('fetch al item page', {{ url: itemUrl }});

    const resp = await fetch(itemUrl, {{
      credentials: 'include',
      headers: {{
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'ja,en;q=0.9',
      }},
      redirect: 'follow',
    }});

    await emitDebug('respuesta recibida', {{ status: resp.status, finalUrl: resp.url }});

    if (!resp.ok) {{
      await emit({{ ok: false, error: 'Item page returned HTTP ' + resp.status }});
      return;
    }}

    const html = await resp.text();
    await emitDebug('HTML recibido', {{ length: html.length, hasDownloadables: html.includes('downloadables') }});

    const downloadablesUrl = parseDownloadablesUrl(html);

    if (!downloadablesUrl) {{
      // Diagnóstico: emitir fragmento del HTML para ver qué devolvió Booth
      const snippet = html.substring(0, 8000);
      const hasLogin = html.includes('sign_in') || html.includes('login');
      await emitDebug('no downloadables en HTML — posible falta de sesión o no comprado', {{
        snippet,
        hasLogin,
        hasDownloadText: html.includes('download') || html.includes('\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9'),
      }});
      await emit({{ ok: false, error: 'No downloadables link found in item page — item may not be purchased' }});
      return;
    }}

    console.log('[booth-dl] downloadables URL encontrada:', downloadablesUrl);
    await emitDebug('downloadables URL encontrada', {{ url: downloadablesUrl }});

    // Resolver el redirect CDN: /downloadables/ID → 302 → URL firmada S3
    // Si fetch falla (p.ej. CORS en el CDN), devolver la URL directa para que Rust la siga.
    let finalUrl = downloadablesUrl;
    try {{
      const dlResp = await fetch(downloadablesUrl, {{ credentials: 'include', redirect: 'follow' }});
      if (dlResp.url && dlResp.url !== downloadablesUrl) {{
        finalUrl = dlResp.url;
        await emitDebug('URL CDN resuelta', {{ url: finalUrl }});
      }}
    }} catch (fetchErr) {{
      await emitDebug('CDN fetch falló, usando URL directa', {{ error: fetchErr.message }});
    }}

    await emit({{ ok: true, url: finalUrl }});

  }} catch(e) {{
    console.error('[booth-dl] unhandled error:', e.message || String(e));
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