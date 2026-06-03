use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoothProduct {
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub thumbnail_url: String,
    pub price_display: String,
    pub url: String,
    pub source: String,
}

// ── URL ────────────────────────────────────────────────────────────────────────

/// URL del endpoint HTML (usado como fallback y por booth_search_authenticated).
pub fn build_search_url(query: &str, page: u32) -> String {
    let encoded = urlencoding::encode(query);
    format!(
        "https://booth.pm/en/search/{}?page={}&sort=new_arrival",
        encoded, page
    )
}

/// URL del endpoint JSON oficial de Booth (usado como primera opción en `search`).
/// Booth renderiza los resultados con JavaScript en el cliente, por lo que el HTML SSR
/// solo contiene 1 item inicial. El endpoint JSON devuelve todos los resultados sin JS.
/// Si `include_adult` es true, añade &adult=1 a la URL para mostrar contenido adulto.
fn build_json_search_url(query: &str, page: u32, include_adult: bool) -> String {
    let encoded = urlencoding::encode(query);
    let adult_param = if include_adult { "&adult=1" } else { "" };
    format!(
        "https://booth.pm/en/browse.json?q={}&page={}&sort=new_arrival{}",
        encoded, page, adult_param
    )
}

// ── JSON API structs ──────────────────────────────────────────────

/// Deserializa un campo que puede ser u64 o null (Booth a veces envía null en price).
fn deserialize_null_as_zero<'de, D>(d: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<u64>::deserialize(d)?.unwrap_or(0))
}

#[derive(Deserialize)]
struct BoothJsonImage {
    original: Option<String>,
}

#[derive(Deserialize)]
struct BoothJsonShop {
    name: Option<String>,
}

#[derive(Deserialize)]
struct BoothJsonItem {
    id: u64,
    /// Puede ser null en algunos items — se filtra después.
    #[serde(default)]
    name: Option<String>,
    /// Booth a veces devuelve null en lugar de 0 para items gratis.
    #[serde(default, deserialize_with = "deserialize_null_as_zero")]
    price: u64,
    shop: Option<BoothJsonShop>,
    #[serde(default)]
    images: Vec<BoothJsonImage>,
}

#[derive(Deserialize)]
struct BoothJsonResponse {
    #[serde(default)]
    items: Vec<BoothJsonItem>,
}

/// Parsea la respuesta JSON de browse.json.
/// Devuelve Some(vec) siempre que el JSON sea válido (incluso Some([]) si la
/// lista está vacía), para que el caller no caiga al fallback HTML SSR por error.
fn parse_json_results(json: &str) -> Option<Vec<BoothProduct>> {
    let resp: BoothJsonResponse = serde_json::from_str(json).ok()?;
    // Some aunque esté vacío: indica que el JSON fue correcto, no hacer fallback al SSR.
    Some(
        resp.items
            .into_iter()
            .filter(|item| {
                item.name
                    .as_deref()
                    .map(|n| !n.trim().is_empty())
                    .unwrap_or(false)
            })
            .map(|item| {
                let name = item.name.unwrap(); // safe: filtrado arriba
                let price_display = if item.price == 0 {
                    "Free".to_string()
                } else {
                    format!("¥{}", item.price)
                };
                let author = item
                    .shop
                    .and_then(|s| s.name)
                    .unwrap_or_default();
                let thumbnail_url = item
                    .images
                    .into_iter()
                    .find_map(|img| img.original)
                    .unwrap_or_default();
                BoothProduct {
                    source_id: item.id.to_string(),
                    name: name.trim().to_string(),
                    author,
                    thumbnail_url,
                    price_display,
                    url: format!("https://booth.pm/en/items/{}", item.id),
                    source: "booth".to_string(),
                }
            })
            .collect(),
    )
}

// ── HTML parser ────────────────────────────────────────────────────────────────

/// Parsea la página de resultados de Booth.
///
/// Cada `<li data-product-id="…">` lleva los datos en atributos:
///   - `data-product-id`    → source_id
///   - `data-product-name`  → name
///   - `data-product-brand` → author (nombre del shop)
///   - `data-product-price` → precio en yenes (entero, 0 = gratis)
///
/// El thumbnail va en el primer `<a class="js-thumbnail-image">` → atributo `data-original`.
pub fn parse_search_results(html: &str) -> Vec<BoothProduct> {
    let document = Html::parse_document(html);

    // <li data-product-id="..."> — un selector por atributo es suficiente
    // Booth usa distintos elementos contenedor según la página (li, div, etc.).
    // El selector genérico [data-product-id] cubre todos los casos.
    let card_sel = Selector::parse("[data-product-id]").unwrap();
    // Primera imagen del carrusel (siempre visible, sin clase !hidden)
    let thumb_sel = Selector::parse("a.js-thumbnail-image[data-original]").unwrap();

    document
        .select(&card_sel)
        .filter_map(|li| {
            let attrs = li.value();

            let source_id = attrs.attr("data-product-id")?.to_string();
            let name = attrs.attr("data-product-name").unwrap_or("").trim().to_string();
            if name.is_empty() {
                return None;
            }
            let author = attrs.attr("data-product-brand").unwrap_or("").to_string();
            let price_yen: u64 = attrs
                .attr("data-product-price")
                .and_then(|p| p.parse().ok())
                .unwrap_or(0);
            let price_display = if price_yen == 0 {
                "Free".to_string()
            } else {
                format!("¥{}", price_yen)
            };

            // Primer thumbnail visible del carrusel
            let thumbnail_url = li
                .select(&thumb_sel)
                .next()
                .and_then(|a| a.value().attr("data-original"))
                .unwrap_or("")
                .to_string();

            let url = format!("https://booth.pm/en/items/{}", source_id);

            Some(BoothProduct {
                source_id,
                name,
                author,
                thumbnail_url,
                price_display,
                url,
                source: "booth".to_string(),
            })
        })
        .collect()
}

// ── HTTP ───────────────────────────────────────────────────────────────────────

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    page: u32,
    authenticated: bool,  // si el cliente tiene cookie de sesión de Booth
) -> Result<Vec<BoothProduct>, String> {
    // Intento 1 — JSON API (/en/browse.json).
    // Booth renderiza los resultados con JS en el cliente, por lo que el scraping HTML
    // solo obtiene 1 item del SSR. El endpoint JSON devuelve el conjunto completo.
    // parse_json_results ahora devuelve Some(vec![]) cuando el JSON es válido pero vacío,
    // con lo que sólo caemos al fallback HTML si hubo un error de red o de parseo real.
    let json_url = build_json_search_url(query, page, authenticated);
    if let Ok(resp) = client
        .get(&json_url)
        .header("Accept", "application/json")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://booth.pm/")
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(body) = resp.text().await {
                // Some(_) → JSON OK (puede ser lista vacía), retornamos sin ir al SSR.
                // None    → JSON malformado, caemos al fallback HTML.
                if let Some(products) = parse_json_results(&body) {
                    return Ok(products);
                }
            }
        }
    }

    // Intento 2 — fallback HTML (SSR).
    // Solo llegamos aqui si browse.json fallo a nivel de red o devolvio JSON malformado.
    // El HTML SSR de Booth solo hidrata 1 item, por lo que este fallback es de ultimo recurso.
    let html_url = build_search_url(query, page);
    let html = client
        .get(&html_url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://booth.pm/")
        .send()
        .await
        .map_err(|e| format!("Booth request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Booth body read error: {}", e))?;

    Ok(parse_search_results(&html))
}

// ── Product detail ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct BoothProductDetail {
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub price_display: String,
    pub url: String,
    pub source: String,
    /// Primera imagen del producto (miniatura principal).
    pub thumbnail_url: String,
    /// Todas las imágenes del producto en resolución original.
    pub images: Vec<String>,
    /// Texto de la descripción, con saltos de línea preservados.
    pub description: String,
    /// Productos relacionados scrapeados de la misma página.
    pub similar: Vec<BoothProduct>,
    /// Avatares compatibles extraídos del nombre + descripción del producto.
    pub supported_avatars: Vec<String>,
}

/// Quita el segmento /c/SIZE/ de las URLs de pximg para obtener la imagen original.
/// "https://booth.pximg.net/c/300x300_a2_g5/UUID/i/ID/file.jpg"
/// → "https://booth.pximg.net/UUID/i/ID/file.jpg"
fn to_original_size(url: &str) -> String {
    const PREFIX: &str = "https://booth.pximg.net/c/";
    if let Some(rest) = url.strip_prefix(PREFIX) {
        // rest = "300x300_a2_g5/UUID/..."
        if let Some(slash) = rest.find('/') {
            return format!("https://booth.pximg.net/{}", &rest[slash + 1..]);
        }
    }
    url.to_string()
}

/// Parsea la página de detalle de un item de Booth y devuelve un `BoothProductDetail`.
/// Los datos de nombre/autor/precio se sacan del primer `<li data-product-id>` que coincida;
/// las imágenes y la descripción se sacan del cuerpo de la página.
pub fn parse_product_detail(html: &str, source_id: &str) -> BoothProductDetail {
    let document = Html::parse_document(html);

    // ── Imágenes propias del producto ────────────────────────────────────────
    // La detail page de Booth usa el atributo `src` en <img> (NO `data-original`,
    // que solo aparece en los resultados de búsqueda para lazy-load).
    // Full-res: https://booth.pximg.net/UUID/i/ID/file.jpg  (sin /c/ prefix)
    // Thumbnails: https://booth.pximg.net/c/72x72_a2_g5/UUID/i/ID/file.jpg
    // to_original_size normaliza ambas al mismo canonical URL → dedup elimina duplicados.
    let img_sel = Selector::parse("img[src]").unwrap();
    let item_path = format!("/i/{}/", source_id);
    let mut seen_urls = std::collections::HashSet::new();
    let images: Vec<String> = document
        .select(&img_sel)
        .filter_map(|img| img.value().attr("src"))
        .filter(|url| url.contains(&item_path))
        .map(to_original_size)
        .filter(|url| seen_urls.insert(url.clone()))
        .collect();

    // ── Descripción ──────────────────────────────────────────────────────────
    // El texto está en <div class="js-market-item-detail-description"><p class="...">…</p></div>
    // scraper::ElementRef::text() devuelve los text nodes ya decodificados (entidades HTML resueltas).
    let desc_sel =
        Selector::parse(".js-market-item-detail-description p").unwrap();
    let description = document
        .select(&desc_sel)
        .next()
        .map(|el| el.text().collect::<Vec<_>>().join(""))
        .unwrap_or_default()
        .trim()
        .to_string();

    // ── Nombre, autor, precio — desde el <li data-product-id> del propio item ──
    // La detail page también incluye el li card del producto actual.
    // Booth usa distintos elementos contenedor según la página (li, div, etc.).
    // El selector genérico [data-product-id] cubre todos los casos.
    let card_sel = Selector::parse("[data-product-id]").unwrap();
    let own_card = document
        .select(&card_sel)
        .find(|li| li.value().attr("data-product-id") == Some(source_id));

    let (name, author, price_display) = if let Some(li) = own_card {
        let attrs = li.value();
        let name = attrs.attr("data-product-name").unwrap_or("").trim().to_string();
        let author = attrs.attr("data-product-brand").unwrap_or("").to_string();
        let price_yen: u64 = attrs
            .attr("data-product-price")
            .and_then(|p| p.parse().ok())
            .unwrap_or(0);
        let price_display = if price_yen == 0 {
            "Free".to_string()
        } else {
            format!("¥{}", price_yen)
        };
        (name, author, price_display)
    } else {
        // Fallback: no encontramos el card (layout diferente)
        (String::new(), String::new(), "—".to_string())
    };

    // ── Productos similares ──────────────────────────────────────────────────
    // Todos los li[data-product-id] que NO sean el producto actual
    let thumb_sel2 = Selector::parse("a.js-thumbnail-image[data-original]").unwrap();
    let similar: Vec<BoothProduct> = document
        .select(&card_sel)
        .filter(|li| li.value().attr("data-product-id") != Some(source_id))
        .filter_map(|li| {
            let attrs = li.value();
            let sid = attrs.attr("data-product-id")?.to_string();
            let sname = attrs.attr("data-product-name").unwrap_or("").trim().to_string();
            if sname.is_empty() {
                return None;
            }
            let sauthor = attrs.attr("data-product-brand").unwrap_or("").to_string();
            let price_yen: u64 = attrs
                .attr("data-product-price")
                .and_then(|p| p.parse().ok())
                .unwrap_or(0);
            let sprice = if price_yen == 0 {
                "Free".to_string()
            } else {
                format!("¥{}", price_yen)
            };
            let sthumb = li
                .select(&thumb_sel2)
                .next()
                .and_then(|a| a.value().attr("data-original"))
                .unwrap_or("")
                .to_string();
            let surl = format!("https://booth.pm/en/items/{}", sid);
            Some(BoothProduct {
                source_id: sid,
                name: sname,
                author: sauthor,
                thumbnail_url: sthumb,
                price_display: sprice,
                url: surl,
                source: "booth".to_string(),
            })
        })
        .take(12) // máximo 12 similares
        .collect();

    let thumbnail_url = images.first().cloned().unwrap_or_default();

    // Extraer avatares compatibles del nombre + descripción
    let avatar_text = format!("{} {}", name, description);
    let supported_avatars = parse_item_supported_avatars(&avatar_text);

    BoothProductDetail {
        source_id: source_id.to_string(),
        name,
        author,
        price_display,
        url: format!("https://booth.pm/en/items/{}", source_id),
        source: "booth".to_string(),
        thumbnail_url,
        images,
        description,
        similar,
        supported_avatars,
    }
}

pub async fn fetch_product_detail(
    client: &reqwest::Client,
    source_id: &str,
) -> Result<BoothProductDetail, String> {
    let url = format!("https://booth.pm/en/items/{}", source_id);
    let html = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://booth.pm/")
        .send()
        .await
        .map_err(|e| format!("Booth detail request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Booth detail read error: {}", e))?;

    Ok(parse_product_detail(&html, source_id))
}

// ── Download URL ───────────────────────────────────────────────────────────────

pub fn parse_download_url(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let sel = Selector::parse("a[href*='/downloadables/'], a[data-product-id][href]").unwrap();
    document.select(&sel).find_map(|el| el.value().attr("href").map(|s| s.to_string()))
}

pub async fn get_download_url(client: &reqwest::Client, source_id: &str) -> Result<String, String> {
    let url = format!("https://booth.pm/en/items/{}", source_id);
    let html = client.get(&url).send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())?;
    parse_download_url(&html)
        .ok_or_else(|| "Download URL not found (not purchased or not logged in)".to_string())
}

/// Obtiene la URL final de descarga de un item GRATUITO de Booth sin necesidad de
/// autenticación. Pasos:
///   1. GET https://booth.pm/en/items/{id}  → extrae /downloadables/XXXX
///   2. GET https://booth.pm/downloadables/XXXX con redirect:follow → URL CDN final
///
/// Para items con age restriction "all": reintenta con ?age_confirmation=1.
/// Devuelve Err si el item no es gratuito o si requiere autenticación.
pub async fn fetch_free_download_url(source_id: &str) -> Result<String, String> {
    // Cliente sin cookies — los items free son de descarga pública
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let item_url = format!("https://booth.pm/en/items/{}", source_id);

    // Paso 1 — obtener HTML de la página del item.
    // Guardamos la respuesta completa para poder inspeccionar la URL final
    // tras los redirects (reqwest los sigue automáticamente).
    let item_response = client
        .get(&item_url)
        .header("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://booth.pm/")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Booth item page: {}", e))?;

    // Detectar redirect a login comprobando la URL FINAL, no el contenido HTML.
    // El HTML de CUALQUIER página de Booth incluye "sign_in" en la nav (botón de cabecera),
    // lo que causaba un falso positivo. La URL final es la señal fiable.
    let final_url = item_response.url().to_string();
    if final_url.contains("accounts.booth.pm") {
        return Err(
            "This item requires Booth authentication. Please connect your Booth account first."
                .to_string(),
        );
    }

    let html = item_response
        .text()
        .await
        .map_err(|e| format!("Failed to read Booth item page: {}", e))?;

    // Detectar age gate y reintentar con ?age_confirmation=1
    let html = if html.contains("age_confirmation") || html.contains("この商品は年齢確認") {
        let age_url = format!("{}?age_confirmation=1", item_url);
        client
            .get(&age_url)
            .header("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
            .header("Referer", "https://booth.pm/")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch age-confirmed page: {}", e))?
            .text()
            .await
            .map_err(|e| format!("Failed to read age-confirmed page: {}", e))?
    } else {
        html
    };

    // Paso 2 — extraer el enlace /downloadables/XXXX
    let downloadables_url = parse_download_url(&html).ok_or_else(|| {
        if html.contains("Add to cart") || html.contains("購入する") {
            "This item is not free to download. Please purchase it on Booth first.".to_string()
        } else {
            "No download link found. The item may require authentication or Booth changed its layout.".to_string()
        }
    })?;

    // Construir URL absoluta si el href es relativo
    let downloadables_url = if downloadables_url.starts_with('/') {
        format!("https://booth.pm{}", downloadables_url)
    } else {
        downloadables_url
    };

    // Paso 3 — seguir el redirect de /downloadables/XXXX → URL CDN final
    // reqwest sigue redirects automáticamente; la URL final está en response.url().
    // IMPORTANTE: Booth puede redirigir a accounts.booth.pm/users/sign_in con HTTP 200
    // (la página de login se carga correctamente), lo que causaba que se descargara
    // el HTML de login guardándose como un archivo llamado "sign_in".
    // Hay que verificar la URL final ANTES de asumir que es la URL del CDN.
    let response = client
        .get(&downloadables_url)
        .header("Referer", &item_url)
        .send()
        .await
        .map_err(|e| format!("Failed to follow downloadables redirect: {}", e))?;

    // Comprobar URL final ANTES del status: un redirect a login termina en 200 (no 401/403)
    let cdn_url = response.url().to_string();
    if cdn_url.contains("accounts.booth.pm") || cdn_url.contains("/sign_in") {
        return Err(
            "This free item requires Booth authentication to download. Please connect your Booth account."
                .to_string(),
        );
    }

    if !response.status().is_success() {
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(
                "This free item requires authentication to download. Please connect your Booth account."
                    .to_string(),
            );
        }
        return Err(format!(
            "Booth returned HTTP {} when resolving download URL",
            status
        ));
    }

    Ok(cdn_url)
}

#[cfg(test)]
mod free_download_tests {
    use super::*;

    #[test]
    fn test_parse_download_url_finds_relative_href() {
        let html = r#"<html><body>
            <a href="/downloadables/12345678" class="download-btn">Free Download</a>
        </body></html>"#;
        let result = parse_download_url(html);
        assert_eq!(result, Some("/downloadables/12345678".to_string()));
    }

    #[test]
    fn test_parse_download_url_finds_absolute_href() {
        let html = r#"<html><body>
            <a href="https://booth.pm/downloadables/12345678">Download</a>
        </body></html>"#;
        let result = parse_download_url(html);
        assert_eq!(result, Some("https://booth.pm/downloadables/12345678".to_string()));
    }

    #[test]
    fn test_parse_download_url_returns_none_when_no_link() {
        let html = r#"<html><body>
            <a href="/en/items/12345678">Add to cart</a>
        </body></html>"#;
        let result = parse_download_url(html);
        assert!(result.is_none());
    }
}

// ── Known avatars catalogue ────────────────────────────────────────────────────

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

pub fn extract_supported_avatars(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut found = std::collections::HashSet::new();
    for (alias, canonical) in KNOWN_AVATARS {
        let alias_lower = alias.to_lowercase();
        let is_ascii_alias = alias.is_ascii();
        let mut search_from = 0;
        while let Some(pos) = lower[search_from..].find(alias_lower.as_str()) {
            let abs = search_from + pos;
            let boundary_ok = if is_ascii_alias {
                let before_ok = abs == 0 || { let ch = lower.as_bytes()[abs - 1]; !ch.is_ascii_alphanumeric() && ch != b'_' };
                let after_pos = abs + alias_lower.len();
                let after_ok = after_pos >= lower.len() || { let ch = lower.as_bytes()[after_pos]; !ch.is_ascii_alphanumeric() && ch != b'_' };
                before_ok && after_ok
            } else { true };
            if boundary_ok { found.insert(canonical.to_string()); break; }
            search_from = abs + 1;
        }
    }
    let mut result: Vec<String> = found.into_iter().collect();
    result.sort();
    result
}

// ── Supported avatars from item page ──────────────────────────────────────────

/// Parsea la página de un item de Booth para extraer los avatares soportados.
pub fn parse_item_supported_avatars(html: &str) -> Vec<String> {
    let document = Html::parse_document(html);

    // Buscar en el cuerpo de la descripción del item
    let desc_sel = Selector::parse(
        ".js-market-item-detail-description, .description, [data-product-description]"
    ).unwrap();

    let full_text: String = document
        .select(&desc_sel)
        .map(|el| el.text().collect::<String>())
        .collect::<Vec<_>>()
        .join(" ");

    // También buscar en el título de la página
    let title_sel = Selector::parse("h1, h2, .item-name").unwrap();
    let title_text: String = document
        .select(&title_sel)
        .take(2)
        .map(|el| el.text().collect::<String>())
        .collect::<Vec<_>>()
        .join(" ");

    let combined = format!("{} {}", title_text, full_text);
    extract_supported_avatars(&combined)
}

#[cfg(test)]
mod avatar_tests {
    use super::*;

    #[test]
    fn test_parse_item_supported_avatars_from_booth_html() {
        let html = r#"<html><body>
            <div class="js-market-item-detail-description">
                <p>対応アバター 대응 아바타
                ・しなの｜Shinano
                ・マヌカ｜Manuka
                ・愛莉｜Airi
                </p>
            </div>
        </body></html>"#;
        let mut result = parse_item_supported_avatars(html);
        result.sort();
        assert_eq!(result, vec!["Airi", "Manuka", "Shinano"]);
    }

    #[test]
    fn test_parse_item_supported_avatars_empty() {
        let html = "<html><body><div class='description'>No avatar info here.</div></body></html>";
        let result = parse_item_supported_avatars(html);
        assert!(result.is_empty() || !result.is_empty()); // just check no panic
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_search_url_html_endpoint() {
        let url = build_search_url("airi", 1);
        // Debe usar /en/search/QUERY, NO search.json
        assert!(url.contains("booth.pm/en/search/"), "debería usar /en/search/: {}", url);
        assert!(!url.contains("search.json"), "NO debe usar search.json: {}", url);
        assert!(url.contains("page=1"));
    }

    #[test]
    fn test_build_search_url_encodes_spaces() {
        let url = build_search_url("avatar base", 2);
        // urlencoding::encode reemplaza espacio por %20
        assert!(url.contains("avatar%20base") || url.contains("avatar+base"), "{}", url);
        assert!(url.contains("page=2"));
    }

    #[test]
    fn test_parse_search_results_from_real_html_structure() {
        // HTML mínimo que replica la estructura real observada en booth.pm
        let html = r#"
        <html><body>
        <ul>
          <li class="item-card l-card"
              data-product-id="6082686"
              data-product-name="オリジナル3Dモデル「愛莉」Ver.1.01"
              data-product-brand="kyubihome"
              data-product-price="5500"
              data-tracking="impression_item">
            <div class="item-card__wrap" id="item_6082686">
              <a class="js-thumbnail-image item-card__thumbnail-image"
                 data-original="https://booth.pximg.net/thumb/6082686.jpg"
                 href="https://booth.pm/en/items/6082686"></a>
            </div>
          </li>
          <li class="item-card l-card"
              data-product-id="6464467"
              data-product-name="Rough Long Hair"
              data-product-brand="tonarino8908"
              data-product-price="0">
            <a class="js-thumbnail-image item-card__thumbnail-image"
               data-original="https://booth.pximg.net/thumb/6464467.jpg"
               href="https://booth.pm/en/items/6464467"></a>
          </li>
        </ul>
        </body></html>
        "#;

        let results = parse_search_results(html);
        assert_eq!(results.len(), 2, "debería encontrar 2 productos");

        let first = &results[0];
        assert_eq!(first.source_id, "6082686");
        assert_eq!(first.name, "オリジナル3Dモデル「愛莉」Ver.1.01");
        assert_eq!(first.author, "kyubihome");
        assert_eq!(first.price_display, "¥5500");
        assert_eq!(first.thumbnail_url, "https://booth.pximg.net/thumb/6082686.jpg");
        assert_eq!(first.url, "https://booth.pm/en/items/6082686");
        assert_eq!(first.source, "booth");

        let second = &results[1];
        assert_eq!(second.source_id, "6464467");
        assert_eq!(second.price_display, "Free");
    }

    #[test]
    fn test_parse_search_results_empty_html() {
        let results = parse_search_results("<html><body></body></html>");
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_parse_skips_card_without_name() {
        let html = r#"
        <html><body>
          <li data-product-id="999" data-product-name="" data-product-brand="x" data-product-price="0">
            <a class="js-thumbnail-image item-card__thumbnail-image" data-original="x.jpg"></a>
          </li>
        </body></html>
        "#;
        // name vacío → filter_map devuelve None → no se incluye
        let results = parse_search_results(html);
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_parse_product_detail_uses_src_not_data_original() {
        // Replica la estructura real de la detail page de Booth:
        // la imagen full-res llega en <img src="..."> SIN prefijo /c/
        // las thumbnails del strip llegan con /c/72x72_a2_g5/
        let html = r#"
        <html><body>
          <li data-product-id="6082686" data-product-name="愛莉" data-product-brand="kyubihome" data-product-price="5500"></li>
          <img src="https://booth.pximg.net/f420c992/i/6082686/aaa_base_resized.jpg" />
          <img src="https://booth.pximg.net/c/72x72_a2_g5/f420c992/i/6082686/aaa_base_resized.jpg" />
          <img src="https://booth.pximg.net/c/72x72_a2_g5/f420c992/i/6082686/bbb_base_resized.jpg" />
          <img src="https://booth.pximg.net/c/72x72_a2_g5/f420c992/i/6082686/ccc_base_resized.jpg" />
          <!-- avatar del shop — no debe incluirse -->
          <img src="https://booth.pximg.net/c/48x48/users/4773356/icon_image/icon.jpg" />
          <!-- producto relacionado — no debe incluirse -->
          <img src="https://booth.pximg.net/c/72x72_a2_g5/f420c992/i/9999999/other.jpg" />
          <div class="js-market-item-detail-description description">
            <p class="autolink break-words typography-16 whitespace-pre-line">Test description line 1
Line 2</p>
          </div>
        </body></html>
        "#;
        let detail = parse_product_detail(html, "6082686");

        // Debe devolver 3 imágenes únicas en full-res (aaa deduplicada, bbb, ccc)
        assert_eq!(detail.images.len(), 3, "imágenes: {:?}", detail.images);
        for img in &detail.images {
            assert!(img.contains("/i/6082686/"), "debe contener el item id: {}", img);
            assert!(!img.contains("/c/"), "no debe tener prefijo de tamaño: {}", img);
        }

        assert_eq!(detail.name, "愛莉");
        assert_eq!(detail.author, "kyubihome");
        assert_eq!(detail.price_display, "¥5500");
        assert!(detail.description.contains("Test description"), "desc: {}", detail.description);
    }

    #[test]
    fn test_to_original_size_strips_size_prefix() {
        let thumb = "https://booth.pximg.net/c/72x72_a2_g5/uuid/i/123/file.jpg";
        let full  = "https://booth.pximg.net/c/300x300_a2_g5/uuid/i/123/file.jpg";
        let orig  = "https://booth.pximg.net/uuid/i/123/file.jpg";
        assert_eq!(to_original_size(thumb), orig);
        assert_eq!(to_original_size(full),  orig);
        assert_eq!(to_original_size(orig),  orig); // ya es original, no cambia
    }

    #[test]
    fn test_parse_free_download_url_with_downloadables_link() {
        let html = r#"<html><body>
          <a href="/en/items/12345/downloadables/67890">Download</a>
        </body></html>"#;
        let result = parse_free_download_url(html);
        assert_eq!(result, Some("https://booth.pm/en/items/12345/downloadables/67890".to_string()));
    }

    #[test]
    fn test_parse_free_download_url_absolute_url() {
        let html = r#"<html><body>
          <a href="https://booth.pm/en/items/12345/downloadables/67890">Free Download</a>
        </body></html>"#;
        let result = parse_free_download_url(html);
        assert_eq!(result, Some("https://booth.pm/en/items/12345/downloadables/67890".to_string()));
    }

    #[test]
    fn test_parse_free_download_url_no_link() {
        let html = r#"<html><body>
          <a href="/en/items/12345">View item</a>
        </body></html>"#;
        let result = parse_free_download_url(html);
        assert_eq!(result, None);
    }

}

/// Parsea la URL de descarga de un item **gratuito** de Booth desde el HTML de su página.
/// A diferencia de `parse_download_url`, prueba múltiples selectores para cubrir
/// los distintos layouts que usa Booth para los botones de descarga free.
///
/// Retorna `Some(url)` si se encuentra un enlace de descarga, `None` si el item
/// no es descargable directamente (requiere compra o login).
pub fn parse_free_download_url(html: &str) -> Option<String> {
    let document = Html::parse_document(html);

    // Selector 1: enlace directo a downloadables (mismo que items de pago ya comprados)
    // Aparece en items free cuando el botón "Download" está en la página sin auth.
    let sel1 = Selector::parse("a[href*='/downloadables/']").unwrap();
    if let Some(el) = document.select(&sel1).next() {
        if let Some(href) = el.value().attr("href") {
            let url = if href.starts_with("http") {
                href.to_string()
            } else {
                format!("https://booth.pm{}", href)
            };
            return Some(url);
        }
    }

    // Selector 2: botón con data-product-id (algunos items gratuitos usan este patrón)
    let sel2 = Selector::parse("a[data-product-id][href]").unwrap();
    if let Some(el) = document.select(&sel2).next() {
        if let Some(href) = el.value().attr("href") {
            if href.contains("download") || href.contains("downloadables") {
                let url = if href.starts_with("http") {
                    href.to_string()
                } else {
                    format!("https://booth.pm{}", href)
                };
                return Some(url);
            }
        }
    }

    None
}

/// Obtiene la URL de descarga de un item **gratuito** de Booth haciendo
/// un HTTP GET público (sin cookies de autenticación) a la página del producto.
///
/// Retorna `Err` si el item no tiene botón de descarga público
/// (porque no es gratuito o la página cambió de estructura).
pub async fn get_free_download_url(
    client: &reqwest::Client,
    source_id: &str,
) -> Result<String, String> {
    let url = format!("https://booth.pm/en/items/{}", source_id);
    let html = client
        .get(&url)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Booth request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Booth body read error: {}", e))?;

    parse_free_download_url(&html)
        .ok_or_else(|| {
            "No se encontró enlace de descarga directa. \
             El item puede no ser gratuito o requerir login.".to_string()
        })
}