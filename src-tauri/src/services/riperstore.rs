//! Riperstore (forum.ripper.store) — NOTA: el sitio está protegido por Cloudflare
//! Managed Challenge. Las peticiones HTTP directas siempre reciben 403.
//! La búsqueda y descarga se hacen a través del WebView autenticado.

use serde::{Deserialize, Serialize};

/// Entrada de descarga estructurada extraída del contexto de un link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadEntry {
    /// URL de descarga (puede ser hidelinks/r/... o directa)
    pub url: String,
    /// Host real conocido, extraído del texto del link o de la URL directa.
    /// Ej: "workupload.com", "mega.nz", "pixeldrain.com"
    pub display_host: Option<String>,
    /// Contraseña encontrada en el contexto inmediato del link.
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiperstoreProduct {
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub thumbnail_url: String,
    pub price_display: String,
    pub url: String,
    pub source: String,
    /// Booth item IDs found in the thread post content (assets de ropa/accesorios).
    pub booth_ids: Vec<String>,
    /// Booth ID del avatar BASE si el OP linkó a boothplorer.com/avatar/XXXXXX.
    pub avatar_booth_id: Option<String>,
    /// Lista estructurada de descargas con host real y contraseña.
    pub downloads: Vec<DownloadEntry>,
    /// Avatares que soporta este asset, extraídos del título/tags/contenido.
    /// Vacío = desconocido. Nombres canónicos: "Airi", "Manuka", "Shinano"…
    pub supported_avatars: Vec<String>,
}

/// Resultado envolvente de una búsqueda en RipperStore, con información de paginación.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiperstoreSearchResult {
    pub products: Vec<RiperstoreProduct>,
    pub page_count: u32,
    pub current_page: u32,
}

pub fn build_search_url(query: &str, page: u32) -> String {
    let encoded = urlencoding::encode(query);
    format!(
        "https://forum.ripper.store/search?term={}&page={}",
        encoded, page
    )
}

pub async fn search(
    _client: &reqwest::Client,
    _query: &str,
    _page: u32,
) -> Result<Vec<RiperstoreProduct>, String> {
    Err("Ripper.store requires browser-level access (Cloudflare protected). Only Booth results are shown.".to_string())
}

pub async fn get_download_url(
    _client: &reqwest::Client,
    _source_id: &str,
) -> Result<String, String> {
    Err("Ripper.store downloads not available (Cloudflare protected)".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_search_url() {
        let url = build_search_url("airi", 1);
        assert!(url.contains("forum.ripper.store"));
        assert!(url.contains("airi"));
    }

    #[test]
    fn test_riperstore_search_result_has_pagination() {
        let result = RiperstoreSearchResult {
            products: vec![],
            page_count: 7,
            current_page: 1,
        };
        assert_eq!(result.page_count, 7);
        assert_eq!(result.current_page, 1);
    }

    #[test]
    fn test_download_entry_fields() {
        let entry = DownloadEntry {
            url: "https://workupload.com/file/abc".to_string(),
            display_host: Some("workupload.com".to_string()),
            password: Some("ERPandUpvote".to_string()),
        };
        assert_eq!(entry.display_host.as_deref(), Some("workupload.com"));
        assert_eq!(entry.password.as_deref(), Some("ERPandUpvote"));
    }
}