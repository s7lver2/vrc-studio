//! Ripper.store WebView auth service.
//!
//! Este módulo centraliza la lógica de WebView: detectar login,
//! construir el JS de búsqueda, y parsear respuestas de NodeBB.

use crate::services::riperstore::{RiperstoreProduct, RiperstoreSearchResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Un link de descarga enriquecido con los avatares mencionados en el mismo post.
/// Producido por `build_topic_scrape_deep_js` para que el frontend pueda
/// mostrar etiquetas de avatar por link y filtrar resultados irrelevantes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadLinkContext {
    pub url: String,
    /// Avatares canónicos detectados en el post que contenía este link.
    /// Vacío = el post no mencionaba ningún avatar conocido.
    pub avatars: Vec<String>,
}

pub const WEBVIEW_LABEL: &str = "ripper-auth";
pub const RIPPER_ORIGIN: &str = "https://forum.ripper.store";

// ── URL helpers ────────────────────────────────────────────────────────────────

pub fn is_logged_in_url(url: &str) -> bool {
    let blocked = ["/login", "/register", "/cdn-cgi/"];
    !blocked.iter().any(|p| url.contains(p))
        && (url.contains("forum.ripper.store") || url.starts_with('/'))
}

// ── Booth ID extraction ────────────────────────────────────────────────────────

/// Extrae IDs de items de Booth desde el contenido HTML/texto de un post.
///
/// Patrones reconocidos:
/// - `https://booth.pm/en/items/1234567`
/// - `https://booth.pm/items/1234567`
/// - `https://username.booth.pm/items/1234567`
///
/// boothplorer.com/avatar/XXXXXX no se extrae aquí (usar `extract_avatar_booth_id`).
pub fn extract_booth_ids(content: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut search_from = 0;

    while let Some(rel) = content[search_from..].find("booth.pm/") {
        let abs = search_from + rel;
        let after_domain = &content[abs + "booth.pm/".len()..];

        let path = if after_domain.starts_with("en/") {
            &after_domain[3..]
        } else {
            after_domain
        };

        if path.starts_with("items/") {
            let en_offset = if after_domain.starts_with("en/") { 3 } else { 0 };
            let digits_start =
                abs + "booth.pm/".len() + en_offset + "items/".len();
            let digits_str = &content[digits_start..];
            let id_len = digits_str
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(digits_str.len());
            if id_len > 0 {
                ids.push(digits_str[..id_len].to_string());
            }
        }

        search_from = abs + 1;
    }

    ids.sort();
    ids.dedup();
    ids
}

/// Extrae el Booth ID del avatar base desde una URL de boothplorer.
///
/// `https://boothplorer.com/avatar/6082686` → `Some("6082686")`
///
/// Este ID identifica el AVATAR BASE (e.g. Airi = 6082686), no un asset de ropa.
/// Se almacena en `avatar_booth_id` del producto, separado de `booth_ids` (assets).
pub fn extract_avatar_booth_id(content: &str) -> Option<String> {
    let marker = "boothplorer.com/avatar/";
    let pos = content.find(marker)?;
    let after = &content[pos + marker.len()..];
    let id_len = after.find(|c: char| !c.is_ascii_digit()).unwrap_or(after.len());
    if id_len == 0 { return None; }
    Some(after[..id_len].to_string())
}

// ── Known avatars catalogue ────────────────────────────────────────────────────

/// Mapa de alias (en minúsculas, incluyendo japonés/coreano) al nombre canónico.
/// Se usa para detectar qué avatares soporta un asset desde título/contenido.
pub const KNOWN_AVATARS: &[(&str, &str)] = &[
    ("airi",      "Airi"),   ("愛莉",   "Airi"),   ("아이리", "Airi"),
    ("manuka",    "Manuka"), ("マヌカ", "Manuka"), ("마누카", "Manuka"),
    ("shinano",   "Shinano"),("しなの", "Shinano"),("시나노", "Shinano"),
    ("milltina",  "Milltina"),("ミルチナ","Milltina"),
    ("kikyo",     "Kikyo"),  ("桔梗",   "Kikyo"),
    ("moe",       "Moe"),    ("萌",     "Moe"),
    ("sio",       "Sio"),    ("しお",   "Sio"),
    ("imeris",    "Imeris"), ("イメリス","Imeris"),
    ("selestia",  "Selestia"),("セレスティア","Selestia"),
    ("vina",      "Vina"),   ("ビナア", "Vina"),
    ("tolass",    "Tolass"),
    ("karin",     "Karin"),
    ("rindo",     "Rindo"),  ("竜胆",   "Rindo"),
    ("lime",      "Lime"),   ("らいむ", "Lime"),
    ("coco",      "Coco"),
    ("chiffon",   "Chiffon"),
    ("mira",      "Mira"),
    ("yuuko",     "Yuuko"),  ("裕子",   "Yuuko"),
    ("hakka",     "Hakka"),
    ("kuuta",     "Kuuta"),
    ("milfy",     "Milfy"),
    ("nagisa",    "Nagisa"), ("凪",     "Nagisa"),
    ("shinra",    "Shinra"), ("森羅",   "Shinra"),
];

/// Busca nombres de avatares conocidos en un texto (título, contenido, etc.)
/// Devuelve los nombres canónicos únicos encontrados.
///
/// Usa boundary check para evitar falsos positivos (e.g. "Moe" dentro de "model").
/// Para texto multilingüe (japonés/coreano) el boundary check es permisivo.
pub fn extract_supported_avatars(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut found = std::collections::HashSet::new();

    for (alias, canonical) in KNOWN_AVATARS {
        let alias_lower = alias.to_lowercase();

        // Para aliases puramente ASCII, verificar word boundaries
        let is_ascii_alias = alias.is_ascii();

        let mut search_from = 0;
        while let Some(pos) = lower[search_from..].find(alias_lower.as_str()) {
            let abs = search_from + pos;

            let boundary_ok = if is_ascii_alias {
                // Verificar que no esté embebido en una palabra más larga
                let before_ok = abs == 0 || {
                    let ch = lower.as_bytes()[abs - 1];
                    !ch.is_ascii_alphanumeric() && ch != b'_'
                };
                let after_pos = abs + alias_lower.len();
                let after_ok = after_pos >= lower.len() || {
                    let ch = lower.as_bytes()[after_pos];
                    !ch.is_ascii_alphanumeric() && ch != b'_'
                };
                before_ok && after_ok
            } else {
                // Para texto no-ASCII (japonés, coreano), aceptar siempre
                true
            };

            if boundary_ok {
                found.insert(canonical.to_string());
                break;
            }

            search_from = abs + 1;
        }
    }

    let mut result: Vec<String> = found.into_iter().collect();
    result.sort();
    result
}

// ── LF thread detection ────────────────────────────────────────────────────────

/// Devuelve true si el título parece ser un hilo "Looking For" / petición.
pub fn is_lf_thread(title: &str) -> bool {
    let lower = title.trim().to_lowercase();

    lower.starts_with("lf ")
        || lower.starts_with("lf:")
        || lower.starts_with("[lf]")
        || lower.starts_with("lf|")
        || lower.starts_with("looking for")
        || lower.starts_with("looking 4 ")
        || lower.starts_with("[looking for]")
        || lower.starts_with("[request]")
        || lower.starts_with("request:")
        || lower.starts_with("request |")
        || lower.starts_with("wtb ")
        || lower.starts_with("[wtb]")
        || lower.starts_with("does anyone have")
        || lower.starts_with("anyone have")
        || lower.starts_with("searching for")
        || lower.starts_with("seeking ")
        || lower.ends_with("lf thread")
        || lower.contains(" | lf")
    // NOTA: "for " (sin contexto) fue eliminado deliberadamente.
    // "FOR AIRI" es un título válido de gift thread (assets para un avatar),
    // no un hilo de búsqueda. El check "looking for" cubre el caso legítimo.
}

/// Devuelve true si el título indica que el hilo contiene descargas/gifts.
///
/// Útil para priorizar resultados. No es exhaustivo — muchos hilos gift
/// no tienen estos prefijos.
pub fn is_gift_thread(title: &str) -> bool {
    let lower = title.trim().to_lowercase();

    lower.starts_with("gift:")
        || lower.starts_with("gift :")
        || lower.starts_with("[gift]")
        || lower.starts_with("gf:")
        || lower.starts_with("gf :")
        || lower.starts_with("[gf]")
        || lower.starts_with("free:")
        || lower.starts_with("free :")
        || lower.starts_with("[free]")
        || lower.contains("gift repository")
        || lower.contains("sharing them")
        || lower.contains(" dump")  // "Airi dump" — repositorios de assets
}

// ── JS inyectable ──────────────────────────────────────────────────────────────

pub fn build_search_js(query: &str, page: u32) -> String {
    let encoded = urlencoding::encode(query);
    format!(
        r#"
(async () => {{
  try {{
    const res = await fetch('https://forum.ripper.store/api/search?term={encoded}&in=titlesposts&page={page}', {{
      headers: {{ 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }}
    }});
    if (!res.ok) {{
      throw new Error('HTTP ' + res.status);
    }}
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {{
      throw new Error('non-json response (got: ' + contentType + ')');
    }}
    const data = await res.json();
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'ripper:search-result',
      target: {{ kind: 'Any' }},
      payload: {{ ok: true, data: JSON.stringify(data) }}
    }});
  }} catch (e) {{
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'ripper:search-result',
      target: {{ kind: 'Any' }},
      payload: {{ ok: false, error: e.message }}
    }});
  }}
}})();
        "#,
        encoded = encoded,
        page = page,
    )
}

pub fn build_session_check_js() -> String {
    r#"
(async () => {
  try {
    let uid = (window.config && window.config.uid) || 0;

    if (uid === 0) {
      try {
        const res = await fetch('/api/me', {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        if (res.ok) {
          const me = await res.json();
          uid = (me && me.uid) || 0;
        }
      } catch (_) {}
    }

    const loggedIn = uid > 0;
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
      event: 'ripper:current-url',
      target: { kind: 'Any' },
      payload: { url: window.location.href, loggedIn }
    });
  } catch (_) {}
})();
    "#.to_string()
}

pub fn build_url_check_js() -> &'static str {
    r#"
(async () => {
  try {
    const uid = (window.config && window.config.uid) || 0;
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
      event: 'ripper:current-url',
      target: { kind: 'Any' },
      payload: { url: window.location.href, loggedIn: uid > 0 }
    });
  } catch (_) {}
})();
    "#
}

/// Genera el snippet JS que obtiene la descripción de un topic de NodeBB.
///
/// MEJORAS vs versión anterior:
/// - Escanea TODOS los posts (no solo mainPost/posts[0]) — las respuestas
///   suelen contener los links de descarga reales (Task 1)
/// - Soporta paginación: si el topic tiene varias páginas, las descarga
///   en paralelo para no perder posts (Task 1)
/// - Clasificador de links con contexto: hidelinks prioritario, NEVER_DL_HOSTS
///   para redes sociales, GitHub solo en /releases/download/ (Task 2)
/// - Extrae host real y contraseña de cada link de descarga (Task 6)
/// - Extrae avatares soportados de las tags de NodeBB (Task 8)
pub fn build_topic_detail_js(source_id: &str) -> String {
    format!(
        r#"
(async () => {{
  try {{
    // ── 1. Página 1 + detectar número de páginas ──────────────────────────────
    const r1 = await fetch('/api/topic/{source_id}?page=1', {{
      headers: {{ 'Accept': 'application/json' }}
    }});
    if (!r1.ok) throw new Error('HTTP ' + r1.status);
    const d1 = await r1.json();

    const pageCount = (d1.pagination && (d1.pagination.pageCount || d1.pagination.pages)) || 1;
    const MAX_EXTRA_PAGES = 4;

    // ── 2. Páginas adicionales en paralelo ────────────────────────────────────
    const extraFetches = [];
    for (let p = 2; p <= Math.min(pageCount, MAX_EXTRA_PAGES + 1); p++) {{
      extraFetches.push(
        fetch('/api/topic/{source_id}?page=' + p, {{ headers: {{ 'Accept': 'application/json' }} }})
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      );
    }}
    const extraPages = await Promise.all(extraFetches);
    const allData = [d1, ...extraPages.filter(Boolean)];

    // ── 3. Recolectar todos los posts de todas las páginas ───────────────────
    const allPosts = [];
    for (const data of allData) {{
      const posts = Array.isArray(data.posts) ? data.posts : [];
      for (const post of posts) {{
        allPosts.push(post);
      }}
    }}
    if (d1.mainPost && !allPosts.find(p => p.pid === d1.mainPost.pid)) {{
      allPosts.unshift(d1.mainPost);
    }}

    // ── 4. Extraer metadatos del primer post ─────────────────────────────────
    const opPost = allPosts[0] || {{}};
    const opEl = document.createElement('div');
    opEl.innerHTML = opPost.content || '';
    const description = (opEl.innerText || opEl.textContent || '').trim();

    // Extraer imágenes de los primeros posts (no solo el OP)
    // booth.pximg.net y uploads del foro son las fuentes habituales.
    // Usar getAttribute en vez de .src para evitar problemas de resolución en divs no adjuntos.
    const IMAGE_SKIP_EXT = /\.(ico|svg|bmp|gif)(\?|$)/i;
    const seenImgSrcs = new Set();
    const images = [];
    const postScanLimit = Math.min(allPosts.length, 6);
    for (let pi = 0; pi < postScanLimit; pi++) {{
      const pel = pi === 0 ? opEl : (() => {{ const d = document.createElement('div'); d.innerHTML = allPosts[pi].content || ''; return d; }})();
      pel.querySelectorAll('img[src]').forEach(img => {{
        const raw = img.getAttribute('src') || '';
        if (!raw) return;
        // Resolver a URL absoluta
        const abs = raw.startsWith('http')
          ? raw
          : raw.startsWith('//')
            ? 'https:' + raw
            : raw.startsWith('/')
              ? 'https://forum.ripper.store' + raw
              : null;
        if (!abs) return;
        // Saltar íconos/SVG/GIF pequeños
        try {{ if (IMAGE_SKIP_EXT.test(new URL(abs).pathname)) return; }} catch {{}}
        if (!seenImgSrcs.has(abs)) {{
          seenImgSrcs.add(abs);
          images.push(abs);
        }}
      }});
    }}

    // ── 5. Extraer avatares de las tags de NodeBB ────────────────────────────
    const AVATAR_ALIASES = {{
      'airi': 'Airi', 'manuka': 'Manuka', 'shinano': 'Shinano',
      'milltina': 'Milltina', 'kikyo': 'Kikyo', 'sio': 'Sio',
      'moe': 'Moe', 'imeris': 'Imeris', 'selestia': 'Selestia',
      'vina': 'Vina', 'tolass': 'Tolass', 'karin': 'Karin',
      'rindo': 'Rindo', 'lime': 'Lime', 'coco': 'Coco',
      'chiffon': 'Chiffon', 'mira': 'Mira', 'yuuko': 'Yuuko',
      'hakka': 'Hakka', 'kuuta': 'Kuuta', 'milfy': 'Milfy',
      'nagisa': 'Nagisa', 'shinra': 'Shinra',
    }};
    const tags = (d1.tags || []).map(t => (typeof t === 'string' ? t : t.value || '').toLowerCase());
    const avatarsFromTags = [...new Set(
      tags.flatMap(tag => {{ const c = AVATAR_ALIASES[tag]; return c ? [c] : []; }})
    )];

    // ── 6. Clasificar links de TODOS los posts ───────────────────────────────
    const DOWNLOAD_HOSTS = [
      'workupload.com', 'mega.nz', 'mega.co.nz', 'drive.google.com',
      '1drv.ms', 'onedrive.live.com', 'dropbox.com', 'mediafire.com',
      'gofile.io', 'pixeldrain.com', 'catbox.moe', 'litterbox.catbox.moe',
      'files.catbox.moe', 'sendgb.com', 'wetransfer.com', 'filebin.net',
      'cdn.discordapp.com', 'terabox.com', '4shared.com',
      'anonfiles.com', 'zippyshare.com',
    ];

    const NEVER_DL_HOSTS = [
      'twitter.com', 'x.com', 't.co',
      'discord.gg',
      'youtube.com', 'youtu.be',
      'instagram.com', 'tiktok.com',
      'booth.pximg.net',
    ];

    const DL_CONTEXT_WORDS = ['dl', 'download', 'descarga', 'link', 'here', 'aquí', '🔗'];

    // Mapa de nombres de host en texto del link → hostname real
    const LINK_TEXT_HOST_MAP = {{
      'pixeldrain': 'pixeldrain.com',
      'mega':       'mega.nz',
      'mediafire':  'mediafire.com',
      'workupload': 'workupload.com',
      'gofile':     'gofile.io',
      'catbox':     'catbox.moe',
      'gdrive':     'drive.google.com',
      'google drive': 'drive.google.com',
      'onedrive':   'onedrive.live.com',
      'dropbox':    'dropbox.com',
    }};

    const PASSWORD_REGEX = /(?:password|pw|pass)\s*[:：]\s*(\S+)/i;

    function extractDisplayHost(linkText, href) {{
      const parenMatch = linkText.match(/\(([a-zA-Z0-9.-]+\.[a-zA-Z]{{2,}})\)/);
      if (parenMatch) return parenMatch[1].toLowerCase();

      const textLower = linkText.toLowerCase().trim();
      for (const [keyword, host] of Object.entries(LINK_TEXT_HOST_MAP)) {{
        if (textLower.includes(keyword)) return host;
      }}

      if (!href.includes('hidelinks')) {{
        try {{ return new URL(href).hostname.replace(/^www\./, ''); }} catch (_) {{}}
      }}
      return null;
    }}

    function findPasswordNear(el) {{
      const parent = el.parentElement;
      if (!parent) return null;
      const match = (parent.textContent || '').match(PASSWORD_REGEX);
      if (match) return match[1];
      let sibling = parent.nextElementSibling;
      for (let i = 0; i < 3 && sibling; i++) {{
        const m = (sibling.textContent || '').match(PASSWORD_REGEX);
        if (m) return m[1];
        sibling = sibling.nextElementSibling;
      }}
      return null;
    }}

    const downloadEntries = [];
    const boothLinksSet  = new Set();
    const otherLinksSet  = new Set();

    for (const post of allPosts) {{
      if (!post.content) continue;

      const postEl = document.createElement('div');
      postEl.innerHTML = post.content;

      postEl.querySelectorAll('a[href]').forEach(a => {{
        const raw = (a.getAttribute('href') || '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
        if (!raw || raw.startsWith('javascript') || raw.startsWith('#')) return;

        const href = raw.startsWith('http')
          ? raw
          : raw.startsWith('//')
            ? 'https:' + raw
            : raw.startsWith('/')
              ? 'https://forum.ripper.store' + raw
              : raw;

        if (href.includes('forum.ripper.store/search')) return;

        // ── hidelinks: siempre es descarga (clasificar primero) ───────────────
        if (href.includes('forum.ripper.store/hidelinks/')) {{
          const linkText = (a.textContent || a.innerText || '').trim();
          const displayHost = extractDisplayHost(linkText, href);
          const password = findPasswordNear(a);
          if (!downloadEntries.find(e => e.url === href)) {{
            downloadEntries.push({{ url: href, displayHost, password: password || null }});
          }}
          return;
        }}

        if (href.includes('booth.pm/items/') || href.includes('booth.pm/en/items/')) {{
          boothLinksSet.add(href);
          return;
        }}

        // ── Descarte de redes sociales y otros no-descarga ────────────────────
        let isNeverDl = false;
        let isKnownDl = false;
        let hostStr = '';
        let pathStr = '';
        try {{
          const u = new URL(href);
          hostStr = u.hostname.replace(/^www\./, '');
          pathStr = u.pathname;
          isNeverDl = NEVER_DL_HOSTS.some(h => href.includes(h));
          // GitHub: solo si es /releases/download/ o tiene texto de descarga
          if (hostStr === 'github.com') {{
            const linkText = (a.textContent || a.innerText || '').trim().toLowerCase();
            const hasDlCtx = DL_CONTEXT_WORDS.some(w => linkText.includes(w));
            isNeverDl = !pathStr.includes('/releases/download/') && !hasDlCtx;
          }}
          if (!isNeverDl) {{
            isKnownDl = DOWNLOAD_HOSTS.some(h => hostStr === h || hostStr.endsWith('.' + h));
          }}
        }} catch (_) {{}}

        if (isNeverDl) return;

        const linkText  = (a.textContent || a.innerText || '').trim();
        const parentTxt = (a.parentElement && (a.parentElement.textContent || '')).toLowerCase() || '';
        const hasDlContext = DL_CONTEXT_WORDS.some(w =>
          linkText.toLowerCase().includes(w) || parentTxt.includes(w)
        );

        if (isKnownDl || (hasDlContext && !href.includes('forum.ripper.store'))) {{
          const displayHost = extractDisplayHost(linkText, href);
          const password = findPasswordNear(a);
          if (!downloadEntries.find(e => e.url === href)) {{
            downloadEntries.push({{ url: href, displayHost, password: password || null }});
          }}
          return;
        }}

        if (!href.includes('forum.ripper.store')) {{
          otherLinksSet.add(href);
        }}
      }});
    }}

    const downloads     = downloadEntries;
    const downloadLinks = downloadEntries.map(e => e.url);
    const boothLinks    = [...boothLinksSet];
    const links         = [...downloadEntries.map(e => e.url)];  // retrocompatibilidad

    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'ripper:topic-detail',
      target: {{ kind: 'Any' }},
      payload: {{ ok: true, description, images, links, downloadLinks, downloads, boothLinks, avatarsFromTags }}
    }});
  }} catch (e) {{
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'ripper:topic-detail',
      target: {{ kind: 'Any' }},
      payload: {{ ok: false, error: e.message }}
    }});
  }}
}})();
        "#,
        source_id = source_id,
    )
}

/// Genera el snippet JS para scrape profundo de un topic (todos los posts, todas las páginas).
pub fn build_topic_scrape_deep_js(source_id: &str, max_pages: u32) -> String {
    format!(
        r#"
(async () => {{
  try {{
    const BASE      = '/api/topic/{source_id}';
    const MAX_PAGES = {max_pages};

    const NEVER_DL_HOSTS = [
      'x.com', 'twitter.com', 't.co', 'fxtwitter.com',
      'pbs.twimg.com', 'abs.twimg.com', 'twimg.com',
      'booth.pm', 'booth.pximg.net', 'asset.booth.pm',
      'youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com',
      'discord.gg', 'nicovideo.jp', 'nico.ms', 'sketchfab.com',
      'linktree', 'lit.link',
    ];
    const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|ico|svg|bmp|avif|tiff?)(\?|$)/i;

    // Alias de avatares conocidos para etiquetar links por post
    const AVATAR_ALIASES = {{
      'airi': 'Airi', '\u611b\u8392': 'Airi',
      'manuka': 'Manuka', '\u30de\u30cc\u30ab': 'Manuka',
      'shinano': 'Shinano', '\u3057\u306a\u306e': 'Shinano',
      'milltina': 'Milltina', '\u30df\u30eb\u30c1\u30ca': 'Milltina',
      'kikyo': 'Kikyo', '\u6854\u68d2': 'Kikyo',
      'moe': 'Moe', '\u841d': 'Moe',
      'sio': 'Sio', '\u3057\u304a': 'Sio',
      'imeris': 'Imeris', '\u30a4\u30e1\u30ea\u30b9': 'Imeris',
      'selestia': 'Selestia', '\u30bb\u30ec\u30b9\u30c6\u30a3\u30a2': 'Selestia',
      'vina': 'Vina', '\u30d3\u30ca\u30a2': 'Vina',
      'tolass': 'Tolass',
      'karin': 'Karin', '\u30ab\u30ea\u30f3': 'Karin',
      'rindo': 'Rindo', '\u7af9\u80c3': 'Rindo',
      'lime': 'Lime', '\u3089\u3044\u3080': 'Lime',
      'coco': 'Coco', 'chiffon': 'Chiffon', 'mira': 'Mira',
      'yuuko': 'Yuuko', '\u88d5\u5b50': 'Yuuko',
      'hakka': 'Hakka', 'kuuta': 'Kuuta', 'milfy': 'Milfy',
      'nagisa': 'Nagisa', '\u51aa': 'Nagisa',
      'shinra': 'Shinra', '\u68ee\u7f85': 'Shinra',
    }};

    function extractAvatars(text) {{
      const lower = text.toLowerCase();
      const found = new Set();
      for (const [alias, canonical] of Object.entries(AVATAR_ALIASES)) {{
        const aliasLower = alias.toLowerCase();
        const idx = lower.indexOf(aliasLower);
        if (idx === -1) continue;
        if (/^[a-z]+$/i.test(alias)) {{
          const before = idx === 0 ? '' : lower[idx - 1];
          const after  = lower[idx + aliasLower.length] ?? '';
          if (/[a-z0-9_]/i.test(before) || /[a-z0-9_]/i.test(after)) continue;
        }}
        found.add(canonical);
      }}
      return [...found];
    }}

    function isSkipped(href) {{
      try {{
        const u = new URL(href);
        const host = u.hostname.replace(/^www\./, '');
        if (host === 'forum.ripper.store') return !u.pathname.startsWith('/hidelinks/r/');
        if (host === 'ripper.store' || host.endsWith('.ripper.store')) return true;
        if (IMAGE_EXT_RE.test(u.pathname)) return true;
        return NEVER_DL_HOSTS.some(s => host === s || host.endsWith('.' + s));
      }} catch {{ return true; }}
    }}

    function resolveHref(raw) {{
      const url = (raw || '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/[.,;:!?)]+$/, '').trim();
      if (!url || url.startsWith('javascript') || url.startsWith('#') || url.length < 12) return null;
      if (url.startsWith('http'))  return url;
      if (url.startsWith('//'))    return 'https:' + url;
      if (url.startsWith('/'))     return 'https://forum.ripper.store' + url;
      return null;
    }}

    const r1 = await fetch(BASE + '?page=1', {{ headers: {{ 'Accept': 'application/json' }} }});
    if (!r1.ok) throw new Error('HTTP ' + r1.status + ' on page 1');
    const d1 = await r1.json();

    const rawCount   = (d1.pagination && (d1.pagination.pageCount || d1.pagination.pages)) || 1;
    const totalPages = Math.min(typeof rawCount === 'number' ? rawCount : 1, MAX_PAGES);

    const pagePromises = [];
    for (let p = 2; p <= totalPages; p++) {{
      pagePromises.push(
        fetch(BASE + '?page=' + p, {{ headers: {{ 'Accept': 'application/json' }} }})
          .then(r => r.ok ? r.json() : null).catch(() => null)
      );
    }}
    const allData = [d1, ...(await Promise.all(pagePromises)).filter(Boolean)];

    // Resultado: array de {{url, avatars}} — primera ocurrencia de cada URL gana
    const seen    = new Set();
    const results = [];

    for (const data of allData) {{
      const posts = [...(data.posts || [])];
      if (data.mainPost && !posts.find(p => p.pid === data.mainPost.pid)) {{
        posts.unshift(data.mainPost);
      }}

      for (const post of posts) {{
        const content = post.content || '';
        if (!content) continue;

        const el = document.createElement('div');
        el.innerHTML = content;
        const postText    = (el.innerText || el.textContent || '') + ' ' + (post.title || '');
        const postAvatars = extractAvatars(postText);

        function addLink(raw) {{
          const abs = resolveHref(raw);
          if (!abs || isSkipped(abs) || seen.has(abs)) return;
          seen.add(abs);
          results.push({{ url: abs, avatars: postAvatars }});
        }}

        el.querySelectorAll('a[href]').forEach(a => addLink((a.getAttribute('href') || '').trim()));
        (content.match(/https?:\/\/[^\s<>"')\]{{}}\\]+/g) || []).forEach(addLink);
      }}
    }}

    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'ripper:scrape-deep-result',
      target: {{ kind: 'Any' }},
      payload: {{ ok: true, links: results, pages_scanned: allData.length }}
    }});
  }} catch (e) {{
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'ripper:scrape-deep-result',
      target: {{ kind: 'Any' }},
      payload: {{ ok: false, error: e.message }}
    }});
  }}
}})();
        "#,
        source_id = source_id,
        max_pages = max_pages,
    )
}

/// Genera JS que navega una categoría de NodeBB y devuelve sus topics.
///
/// Emite `ripper:category-result` con los topics de la página indicada.
pub fn build_category_browse_js(cid: u32, page: u32) -> String {
    format!(
        r#"
(async () => {{
  try {{
    const res = await fetch('/api/category/{cid}?page={page}&sort=recent', {{
      headers: {{ 'Accept': 'application/json' }}
    }});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const topics = (data.topics || []).map(t => ({{
      tid: t.tid,
      title: t.title,
      slug: t.slug,
      thumb: t.thumb || '',
      user: t.user || {{}},
      postcount: t.postcount || 0,
    }}));

    const pageCount = (data.pagination && (data.pagination.pageCount || data.pagination.pages)) || 1;

    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'ripper:category-result',
      target: {{ kind: 'Any' }},
      payload: {{ ok: true, topics, pageCount, cid: {cid}, page: {page} }}
    }});
  }} catch (e) {{
    await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{
      event: 'ripper:category-result',
      target: {{ kind: 'Any' }},
      payload: {{ ok: false, error: e.message }}
    }});
  }}
}})();
        "#,
        cid = cid,
        page = page,
    )
}

// ── Internal parser helpers ────────────────────────────────────────────────────

fn parse_topic(t: &Value) -> Option<RiperstoreProduct> {
    let tid = t.get("tid")?.as_u64()?;
    let title = t.get("title")?.as_str()?.trim().to_string();
    if title.is_empty() {
        return None;
    }
    let slug = t.get("slug").and_then(|s| s.as_str()).unwrap_or("");
    let author = t
        .get("user")
        .and_then(|u| u.get("username"))
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    let thumbnail_url = t
        .get("thumb")
        .and_then(|th| th.as_str())
        .unwrap_or("")
        .to_string();
    let url = if slug.is_empty() {
        format!("{}/topic/{}", RIPPER_ORIGIN, tid)
    } else {
        format!("{}/topic/{}/{}", RIPPER_ORIGIN, tid, slug)
    };

    Some(RiperstoreProduct {
        source_id: tid.to_string(),
        name: title,
        author,
        thumbnail_url,
        price_display: "Free".to_string(),
        url,
        source: "riperstore".to_string(),
        booth_ids: vec![],
        avatar_booth_id: None,
        downloads: vec![],
        supported_avatars: vec![],
    })
}

/// Parsea el JSON de NodeBB `/api/search?in=titlesposts`.
///
/// Devuelve un `RiperstoreSearchResult` con productos y paginación.
/// Los productos de gift threads aparecen primero en la lista.
pub fn parse_search_response(json_str: &str) -> Result<RiperstoreSearchResult, String> {
    let v: Value = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON parse error: {}", e))?;

    // Extraer paginación
    let page_count = v.get("pagination")
        .and_then(|p| p.get("pageCount").or_else(|| p.get("pages")))
        .and_then(|c| c.as_u64())
        .unwrap_or(1) as u32;
    let current_page = v.get("pagination")
        .and_then(|p| p.get("currentPage"))
        .and_then(|c| c.as_u64())
        .unwrap_or(1) as u32;

    let mut seen_tids = std::collections::HashSet::<u64>::new();
    let mut products: Vec<RiperstoreProduct> = Vec::new();
    let mut tid_to_idx: std::collections::HashMap<u64, usize> = std::collections::HashMap::new();

    // ── 1. Topics cuyo título coincide ──────────────────────────────────────────
    if let Some(topics) = v.get("topics").and_then(|t| t.as_array()) {
        for t in topics {
            if let Some(tid_val) = t.get("tid").and_then(|x| x.as_u64()) {
                if seen_tids.insert(tid_val) {
                    if let Some(mut product) = parse_topic(t) {
                        if !is_lf_thread(&product.name) {
                            product.supported_avatars = extract_supported_avatars(&product.name);
                            let idx = products.len();
                            tid_to_idx.insert(tid_val, idx);
                            products.push(product);
                        }
                    }
                }
            }
        }
    }

    // ── 2. Posts cuyo CONTENIDO coincide ────────────────────────────────────────
    if let Some(posts) = v.get("posts").and_then(|p| p.as_array()) {
        for post in posts {
            if let Some(topic) = post.get("topic") {
                if let Some(tid_val) = topic.get("tid").and_then(|x| x.as_u64()) {
                    let content = post
                        .get("content")
                        .and_then(|c| c.as_str())
                        .unwrap_or("");
                    let booth_ids = extract_booth_ids(content);
                    let avatar_id = extract_avatar_booth_id(content);
                    let content_avatars = extract_supported_avatars(content);

                    if seen_tids.contains(&tid_val) {
                        // Enriquecer producto existente
                        if let Some(&idx) = tid_to_idx.get(&tid_val) {
                            if !booth_ids.is_empty() {
                                let existing = &mut products[idx].booth_ids;
                                for id in booth_ids {
                                    if !existing.contains(&id) {
                                        existing.push(id);
                                    }
                                }
                            }
                            if products[idx].avatar_booth_id.is_none() {
                                products[idx].avatar_booth_id = avatar_id;
                            }
                            for av in content_avatars {
                                if !products[idx].supported_avatars.contains(&av) {
                                    products[idx].supported_avatars.push(av);
                                }
                            }
                            products[idx].supported_avatars.sort();
                        }
                    } else {
                        seen_tids.insert(tid_val);
                        if let Some(mut product) = parse_topic(topic) {
                            if !is_lf_thread(&product.name) {
                                product.booth_ids = booth_ids;
                                product.avatar_booth_id = avatar_id;
                                // Avatares del título + del contenido del post
                                let mut avatars = extract_supported_avatars(&product.name);
                                for av in content_avatars {
                                    if !avatars.contains(&av) {
                                        avatars.push(av);
                                    }
                                }
                                avatars.sort();
                                product.supported_avatars = avatars;
                                tid_to_idx.insert(tid_val, products.len());
                                products.push(product);
                            }
                        }
                    }
                }
            }
        }
    }

    // Ordenar: gift threads primero, luego el resto
    products.sort_by(|a, _b| {
        if is_gift_thread(&a.name) {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(RiperstoreSearchResult {
        products,
        page_count,
        current_page,
    })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── extract_booth_ids ──────────────────────────────────────────────────────

    #[test]
    fn test_extract_booth_ids_en_path() {
        let content = "BL: https://booth.pm/en/items/7772055";
        assert_eq!(extract_booth_ids(content), vec!["7772055"]);
    }

    #[test]
    fn test_extract_booth_ids_short_path() {
        let content = "https://booth.pm/items/5516420";
        assert_eq!(extract_booth_ids(content), vec!["5516420"]);
    }

    #[test]
    fn test_extract_booth_ids_seller_subdomain() {
        let content = "BL: https://yoki1004.booth.pm/items/7772055 DL: [link]";
        assert_eq!(extract_booth_ids(content), vec!["7772055"]);
    }

    #[test]
    fn test_extract_booth_ids_multiple() {
        let content = r#"
            BL: https://yoki1004.booth.pm/items/7772055
            BL: https://dayflypopup.booth.pm/items/5516420
            BL: https://booth.pm/en/items/6390765
        "#;
        let mut ids = extract_booth_ids(content);
        ids.sort();
        assert_eq!(ids, vec!["5516420", "6390765", "7772055"]);
    }

    #[test]
    fn test_extract_booth_ids_dedup() {
        let content = "https://booth.pm/items/123 https://booth.pm/en/items/123";
        assert_eq!(extract_booth_ids(content), vec!["123"]);
    }

    #[test]
    fn test_extract_booth_ids_no_match() {
        assert!(extract_booth_ids("no links here").is_empty());
        assert!(extract_booth_ids("https://booth.pm/en/search/airi").is_empty());
    }

    // ── boothplorer ───────────────────────────────────────────────────────────

    #[test]
    fn test_extract_booth_ids_boothplorer() {
        let content = "https://boothplorer.com/avatar/6082686";
        let ids = extract_booth_ids(content);
        assert!(ids.is_empty(), "boothplorer.com NO debe generar booth_ids de assets");
    }

    #[test]
    fn test_extract_avatar_booth_id_from_boothplorer() {
        let content = "https://boothplorer.com/avatar/6082686";
        let avatar_id = extract_avatar_booth_id(content);
        assert_eq!(avatar_id, Some("6082686".to_string()));
    }

    #[test]
    fn test_extract_avatar_booth_id_none_for_regular() {
        assert_eq!(extract_avatar_booth_id("https://booth.pm/en/items/123"), None);
        assert_eq!(extract_avatar_booth_id("no links here"), None);
    }

    // ── extract_supported_avatars ─────────────────────────────────────────────

    #[test]
    fn test_extract_supported_avatars_title_patterns() {
        assert_eq!(extract_supported_avatars("FOR AIRI"), vec!["Airi"]);
        assert_eq!(extract_supported_avatars("[AIRI ONLY]"), vec!["Airi"]);

        let r1 = extract_supported_avatars("GIFT: Sabotage【VRChat】[AIRI ONLY]");
        assert!(r1.contains(&"Airi".to_string()));

        let r2 = extract_supported_avatars("Gift : Airi dump");
        assert!(r2.contains(&"Airi".to_string()));
    }

    #[test]
    fn test_extract_supported_avatars_japanese() {
        let mut result = extract_supported_avatars("対応アバター: しなの,マヌカ,愛莉");
        result.sort();
        assert_eq!(result, vec!["Airi", "Manuka", "Shinano"]);
    }

    #[test]
    fn test_extract_supported_avatars_multiple_english() {
        let mut result = extract_supported_avatars("bump for shinano please, and manuka too");
        result.sort();
        assert_eq!(result, vec!["Manuka", "Shinano"]);
    }

    #[test]
    fn test_extract_supported_avatars_no_false_positives() {
        let result = extract_supported_avatars("this is a model for VRChat");
        assert!(!result.contains(&"Moe".to_string()), "no debe detectar 'Moe' dentro de 'model'");
    }

    #[test]
    fn test_extract_supported_avatars_full_means_unknown() {
        let result = extract_supported_avatars("bump full");
        assert!(result.is_empty(), "'full' solo no identifica avatares concretos");
    }

    // ── is_lf_thread ──────────────────────────────────────────────────────────

    #[test]
    fn test_is_lf_thread_common_prefixes() {
        assert!(is_lf_thread("LF Sio makeup"));
        assert!(is_lf_thread("lf: Airi avatar"));
        assert!(is_lf_thread("[LF] Manuka textures"));
        assert!(is_lf_thread("Looking for Sio Make Up, EyeTexture"));
        assert!(is_lf_thread("looking for kipfel outfit"));
        assert!(is_lf_thread("[Request] Milltina hair"));
        assert!(is_lf_thread("request: Shinano clothes"));
        assert!(is_lf_thread("WTB Manuka outfit"));
        assert!(is_lf_thread("[WTB] Airi 3.0"));
    }

    #[test]
    fn test_is_lf_thread_false_for_gift_threads() {
        assert!(!is_lf_thread("GF: Sio dynamic expression"));
        assert!(!is_lf_thread("HIROKUU'S GIFT REPOSITORY"));
        assert!(!is_lf_thread("Bought a few Sio assets and sharing them"));
        assert!(!is_lf_thread("【しお用】Sio dynamic expression Ver.1.02"));
        assert!(!is_lf_thread("Airi Avatar 3.0 FULL SET"));
        assert!(!is_lf_thread("[GIFT] Manuka textures"));
    }

    #[test]
    fn test_is_lf_thread_suffix() {
        assert!(is_lf_thread("Tolass, Hakka, and Kuuta LF thread"));
    }

    #[test]
    fn test_is_lf_thread_does_not_filter_for_avatar_gift_threads() {
        assert!(!is_lf_thread("FOR AIRI"), "'FOR AIRI' no es un hilo LF — es un gift para Airi");
        assert!(!is_lf_thread("FOR MANUKA AIRI"), "título de gift no debe ser filtrado");
    }

    // ── is_gift_thread ────────────────────────────────────────────────────────

    #[test]
    fn test_is_gift_thread_patterns() {
        assert!(is_gift_thread("GIFT: Sabotage【VRChat】[AIRI ONLY]"));
        assert!(is_gift_thread("Gift : Airi dump"));
        assert!(is_gift_thread("[GIFT] Manuka textures"));
        assert!(is_gift_thread("GF: Sio dynamic expression"));
        assert!(is_gift_thread("FREE: UrbisVortex for Airi"));
        assert!(is_gift_thread("HIROKUU'S GIFT REPOSITORY"));
        assert!(is_gift_thread("Bought a few assets and sharing them"));
    }

    #[test]
    fn test_is_gift_thread_false_for_lf() {
        assert!(!is_gift_thread("LF: Airi assets"));
        assert!(!is_gift_thread("Looking for UrbisVortex"));
    }

    // ── parse_search_response ─────────────────────────────────────────────────

    #[test]
    fn test_parse_search_response_title_match() {
        let json = serde_json::json!({
            "topics": [
                {
                    "tid": 456,
                    "title": "Airi Avatar 3.0",
                    "slug": "airi-avatar-3-0",
                    "user": { "username": "uploader123" },
                    "thumb": "https://forum.ripper.store/assets/thumb.jpg"
                }
            ],
            "posts": []
        });
        let result = parse_search_response(&json.to_string()).unwrap();
        assert_eq!(result.products.len(), 1);
        assert_eq!(result.products[0].source_id, "456");
        assert_eq!(result.products[0].name, "Airi Avatar 3.0");
        assert!(result.products[0].booth_ids.is_empty());
    }

    #[test]
    fn test_parse_search_response_post_content_extracts_booth_ids() {
        let json = serde_json::json!({
            "topics": [],
            "posts": [
                {
                    "pid": 999,
                    "content": "BL: https://rescery.booth.pm/items/6684243 DL: [link]",
                    "topic": {
                        "tid": 789,
                        "title": "Airi Glasses",
                        "slug": "airi-glasses",
                        "user": { "username": "Kimi_Cutie" }
                    }
                }
            ]
        });
        let result = parse_search_response(&json.to_string()).unwrap();
        assert_eq!(result.products.len(), 1);
        assert_eq!(result.products[0].source_id, "789");
        assert_eq!(result.products[0].booth_ids, vec!["6684243"]);
    }

    #[test]
    fn test_parse_search_response_dedup_enriches_booth_ids() {
        let json = serde_json::json!({
            "topics": [
                { "tid": 100, "title": "Airi Hat", "slug": "airi-hat", "user": { "username": "u1" } }
            ],
            "posts": [
                {
                    "pid": 200,
                    "content": "BL: https://booth.pm/items/9999999",
                    "topic": { "tid": 100, "title": "Airi Hat", "slug": "airi-hat", "user": { "username": "u1" } }
                }
            ]
        });
        let result = parse_search_response(&json.to_string()).unwrap();
        assert_eq!(result.products.len(), 1, "no debe duplicar el topic");
        assert_eq!(result.products[0].booth_ids, vec!["9999999"], "debe enriquecer con booth_ids del post");
    }

    #[test]
    fn test_parse_search_response_filters_lf_threads() {
        let json = serde_json::json!({
            "topics": [
                { "tid": 1, "title": "LF Sio makeup", "slug": "lf-sio-makeup", "user": { "username": "x" } },
                { "tid": 2, "title": "Airi Avatar 3.0", "slug": "airi-avatar", "user": { "username": "y" } }
            ],
            "posts": [
                {
                    "pid": 10,
                    "content": "Looking for kipfel",
                    "topic": { "tid": 3, "title": "Looking for kipfel outfit", "slug": "lf-kipfel", "user": { "username": "z" } }
                }
            ]
        });
        let result = parse_search_response(&json.to_string()).unwrap();
        assert_eq!(result.products.len(), 1);
        assert_eq!(result.products[0].source_id, "2");
    }

    #[test]
    fn test_parse_search_response_empty() {
        let result = parse_search_response(r#"{"topics":[],"posts":[]}"#).unwrap();
        assert_eq!(result.products.len(), 0);
    }

    #[test]
    fn test_parse_search_response_no_keys() {
        let result = parse_search_response(r#"{"error":"not found"}"#).unwrap();
        assert_eq!(result.products.len(), 0);
    }

    #[test]
    fn test_parse_search_response_returns_page_count() {
        let json = serde_json::json!({
            "topics": [],
            "posts": [],
            "pagination": { "currentPage": 1, "pageCount": 7 }
        });
        let result = parse_search_response(&json.to_string()).unwrap();
        assert_eq!(result.page_count, 7);
        assert_eq!(result.current_page, 1);
    }

    #[test]
    fn test_parse_search_response_populates_supported_avatars() {
        let json = serde_json::json!({
            "topics": [
                { "tid": 1, "title": "GIFT: Sabotage [AIRI ONLY]", "slug": "gift-sabotage", "user": { "username": "u1" } }
            ],
            "posts": []
        });
        let result = parse_search_response(&json.to_string()).unwrap();
        assert_eq!(result.products.len(), 1);
        assert!(result.products[0].supported_avatars.contains(&"Airi".to_string()));
    }

    // ── build_search_js ───────────────────────────────────────────────────────

    #[test]
    fn test_build_search_js_uses_titlesposts() {
        let js = build_search_js("airi avatar", 1);
        assert!(js.contains("in=titlesposts"), "debe buscar en título Y contenido");
        assert!(js.contains("ripper:search-result"));
        assert!(js.contains("__TAURI_INTERNALS__"));
        assert!(js.contains("https://forum.ripper.store/api/search"), "debe usar URL absoluta");
    }

    #[test]
    fn test_build_search_js_page_parameter() {
        let js_p1 = build_search_js("airi", 1);
        let js_p2 = build_search_js("airi", 2);
        assert!(js_p1.contains("page=1"), "debe incluir page=1");
        assert!(js_p2.contains("page=2"), "debe incluir page=2 para paginación");
        assert_ne!(js_p1, js_p2, "páginas distintas deben generar JS distinto");
    }

    // ── build_session_check_js ────────────────────────────────────────────────

    #[test]
    fn test_build_session_check_js_checks_uid() {
        let js = build_session_check_js();
        assert!(js.contains("window.config"), "debe leer window.config de NodeBB");
        assert!(js.contains("uid"), "debe comprobar el uid");
        assert!(js.contains("loggedIn"), "debe emitir campo loggedIn");
        assert!(js.contains("ripper:current-url"), "debe emitir al evento correcto");
    }

    // ── is_logged_in_url ──────────────────────────────────────────────────────

    #[test]
    fn test_detect_login_success_on_home() {
        assert!(is_logged_in_url("https://forum.ripper.store/"));
        assert!(is_logged_in_url("https://forum.ripper.store/category/28"));
        assert!(!is_logged_in_url("https://forum.ripper.store/login"));
        assert!(!is_logged_in_url("https://forum.ripper.store/register"));
        assert!(!is_logged_in_url("https://forum.ripper.store/cdn-cgi/challenge"));
    }

    // ── build_topic_detail_js ─────────────────────────────────────────────────

    #[test]
    fn test_topic_detail_js_scans_all_posts_not_just_op() {
        let js = build_topic_detail_js("99999");
        assert!(
            js.contains("data.posts") || js.contains("posts.forEach") || js.contains("for (const post"),
            "debe iterar sobre todos los posts, no solo mainPost/posts[0]"
        );
    }

    #[test]
    fn test_topic_detail_js_pagination_aware() {
        let js = build_topic_detail_js("99999");
        assert!(
            js.contains("pageCount") || js.contains("page=2") || js.contains("pagination"),
            "debe ser consciente de la paginación"
        );
    }

    #[test]
    fn test_topic_detail_js_categorizes_links() {
        let js = build_topic_detail_js("12345");
        assert!(js.contains("downloadLinks"), "debe categorizar links de descarga");
        assert!(js.contains("boothLinks"), "debe categorizar links de booth");
        assert!(js.contains("hidelinks"), "debe reconocer URLs hidelinks/r/");
        assert!(js.contains("workupload.com"), "debe reconocer workupload como descarga");
        assert!(js.contains("getAttribute"), "debe usar getAttribute para evitar resolución de URLs relativas");
        assert!(!js.contains("a.href "), "no debe usar a.href (resuelve URLs contra el origen)");
    }

    #[test]
    fn test_topic_detail_js_links_excludes_booth() {
        let js = build_topic_detail_js("12345");
        assert!(js.contains("[...downloadEntries.map(e => e.url)]"), "links solo debe contener downloadLinks, no boothLinks");
    }

    #[test]
    fn test_topic_detail_js_excludes_social_media() {
        let js = build_topic_detail_js("1");
        assert!(!js.contains("\"twitter.com\""), "twitter.com no debe ser host de descarga");
        assert!(!js.contains("\"discord.gg\""), "discord.gg no debe ser host de descarga");
        assert!(!js.contains("\"x.com\""), "x.com no debe ser host de descarga");
    }

    #[test]
    fn test_topic_detail_js_github_only_releases() {
        let js = build_topic_detail_js("1");
        assert!(js.contains("github.com"), "github.com debe estar reconocido");
    }

    #[test]
    fn test_topic_detail_js_hidelinks_always_download() {
        let js = build_topic_detail_js("1");
        assert!(js.contains("hidelinks"), "hidelinks siempre debe clasificarse como descarga");
        let hidelinks_pos = js.find("hidelinks").unwrap();
        let known_hosts_pos = js.find("DOWNLOAD_HOSTS").unwrap();
        assert!(hidelinks_pos < known_hosts_pos, "hidelinks debe procesarse antes que DOWNLOAD_HOSTS");
    }

    #[test]
    fn test_topic_detail_js_extracts_password() {
        let js = build_topic_detail_js("1");
        assert!(js.contains("Password") || js.contains("password") || js.contains("PW") || js.contains("pass"),
            "debe intentar extraer contraseñas del contexto de los links");
    }

    #[test]
    fn test_topic_detail_js_extracts_host_from_link_text() {
        let js = build_topic_detail_js("1");
        assert!(js.contains("displayHost") || js.contains("display_host"),
            "debe extraer el host del texto del link");
    }

    // ── build_category_browse_js ──────────────────────────────────────────────

    #[test]
    fn test_build_category_browse_js_exists() {
        let js = build_category_browse_js(38, 1);
        assert!(js.contains("/api/category/38"), "debe apuntar a la categoría correcta");
        assert!(js.contains("ripper:category-result"), "debe emitir al evento correcto");
        assert!(js.contains("__TAURI_INTERNALS__"), "debe usar el puente Tauri");
    }

    #[test]
    fn test_build_category_browse_js_pagination() {
        let js_p1 = build_category_browse_js(38, 1);
        let js_p2 = build_category_browse_js(38, 2);
        assert!(js_p1.contains("page=1"));
        assert!(js_p2.contains("page=2"));
    }
}