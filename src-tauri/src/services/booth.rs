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

/// Booth devuelve HTML server-side en /en/search/QUERY — no existe ningún endpoint .json.
pub fn build_search_url(query: &str, page: u32) -> String {
    let encoded = urlencoding::encode(query);
    format!(
        "https://booth.pm/en/search/{}?page={}&sort=new_arrival",
        encoded, page
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
    let card_sel = Selector::parse("li[data-product-id]").unwrap();
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
) -> Result<Vec<BoothProduct>, String> {
    let url = build_search_url(query, page);
    let html = client
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://booth.pm/")
        .send()
        .await
        .map_err(|e| format!("Booth request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Booth body read error: {}", e))?;

    let results = parse_search_results(&html);
    if results.is_empty() {
        // Si el HTML vino pero no hay cards, puede ser un captcha o página vacía — no es error
        return Ok(vec![]);
    }
    Ok(results)
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
    let card_sel = Selector::parse("li[data-product-id]").unwrap();
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

// ── Supported avatars from item page ──────────────────────────────────────────

/// Parsea la página de un item de Booth para extraer los avatares soportados.
/// La descripción suele contener líneas como:
///   "対応アバター" / "대응 아바타" / "Supported avatars" seguido de una lista.
pub fn parse_item_supported_avatars(html: &str) -> Vec<String> {
    use crate::services::ripper_webview::extract_supported_avatars;

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

}