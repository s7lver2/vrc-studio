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
/// Se usa para detectar sesión ya activa al abrir la ventana.
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

/// JS que obtiene una página de la lista de compras de Booth y emite
/// los `data-product-id` encontrados como `booth:purchases-page`.
///
/// Booth renderiza /account/purchases con `<li data-product-id="…">` exactamente
/// igual que los resultados de búsqueda — misma estructura que ya parseamos en Rust.
/// Hacemos fetch del HTML y usamos DOMParser en el WebView para extraer los IDs,
/// sin depender de ningún endpoint JSON propietario.
pub fn build_fetch_purchases_js(page: u32) -> String {
    format!(
        r#"
(async () => {{
  try {{
    const res = await fetch('/account/purchases?page={page}', {{
      headers: {{ 'Accept': 'text/html,application/xhtml+xml,*/*' }}
    }});
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const cards = Array.from(doc.querySelectorAll('li[data-product-id]'));
    const ids = cards
      .map(li => li.getAttribute('data-product-id'))
      .filter(id => id && id.length > 0);
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'booth:purchases-page',
      target: {{ kind: 'Any' }},
      payload: {{ ok: true, ids, page: {page}, has_more: ids.length > 0 }}
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
        page = page,
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
        assert!(js.contains("page=3"));
        assert!(js.contains("booth:purchases-page"));
        assert!(js.contains("__TAURI_INTERNALS__"));
        assert!(js.contains("DOMParser"));
    }
}