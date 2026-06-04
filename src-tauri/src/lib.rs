pub mod error;
pub mod db;
pub mod commands;
pub mod models;
pub mod services;

use std::sync::Mutex;
use tauri::Manager;
use crate::db::DbPool;

/// Estado de autenticación de Booth.pm.
/// `purchased_ids`: IDs de items comprados, cargados tras el login.
pub struct BoothState {
    pub webview_label: Mutex<Option<String>>,
    pub purchased_ids: Mutex<std::collections::HashSet<String>>,
    /// ID del listener de `booth:session-check`. Se deregistra en booth_logout.
    pub session_listener: Mutex<Option<tauri::EventId>>,
    /// True solo cuando el session-check confirmó sesión activa en booth.pm.
    /// A diferencia de webview_label, este flag no es un falso positivo por
    /// el mero hecho de que el WebviewWindow exista en memoria.
    pub authenticated: std::sync::Arc<std::sync::atomic::AtomicBool>,
}
impl Default for BoothState {
    fn default() -> Self {
        Self {
            webview_label: Mutex::new(None),
            purchased_ids: Mutex::new(std::collections::HashSet::new()),
            session_listener: Mutex::new(None),
            authenticated: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }
}

#[tauri::command]
fn read_file_as_string(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

pub fn app() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(BoothState::default())
        .manage(commands::build_monitor::BuildMonitorState::default())
        .manage(crate::services::discord_rpc::DiscordRpcState::default())
        .manage(crate::services::discord_auth::DiscordAuthState::default())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("app data dir unavailable")
                .to_string_lossy()
                .to_string();

            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app data directory");

            // Inicializar el pool sincronamente: garantiza que el state esté
            // disponible antes de que el primer command Tauri sea procesado.
            let pool = db::init_pool(&app_data_dir)
                .expect("DB initialization failed");
            app.manage(pool);

            let app_handle = app.handle().clone();

            // Grant FS scope access to the configured assets directory so that
            // custom paths (e.g. on a secondary drive) are readable by the frontend.
            crate::commands::app_settings::grant_assets_scope(&app.handle());
            

            let db_for_tracker = app.state::<DbPool>().inner().clone();
            crate::services::tracker_service::start_polling(app_handle, db_for_tracker);

            // System tray — mantiene la app viva cuando se cierra la ventana
            crate::services::tray::setup_tray(&app.handle().clone())
                .expect("Failed to setup system tray");

            // Interceptar cierre de ventana → ocultar al tray en lugar de salir
            let app_handle_close = app.handle().clone();
            app.get_webview_window("main")
                .expect("main window not found")
                .on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(win) = app_handle_close.get_webview_window("main") {
                            let _ = win.hide();
                        }
                    }
                });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // helpers
            read_file_as_string,

            commands::ping,
            // ── Projects ──
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::delete_project,
            commands::projects::list_unity_installations,
            commands::projects::get_running_unity_projects,
            commands::projects::fetch_vpm_index,
            commands::projects::create_project,
            commands::projects::open_project_in_unity,
            commands::projects::scan_for_projects,
            commands::projects::import_existing_project,
            commands::projects::save_project_screenshot,
            commands::projects::get_installed_vpm_packages,
            commands::projects::install_vpm_package_to_project,
            commands::projects::remove_vpm_package_from_project,
            // ── Packages ──
            commands::packages::list_packages,
            commands::packages::create_package,
            commands::packages::update_package,
            commands::packages::delete_package,
            commands::packages::build_package,
            commands::packages::get_vpm_package_files,
            // ── Shop ──
            commands::shop::search_shop,
            commands::shop::get_booth_product_detail,
            commands::shop::start_download,
            commands::shop::link_account,
            commands::shop::unlink_account,
            commands::shop::get_linked_providers,
            // ── Shop — Booth.pm WebView auth ──
            commands::shop::booth_open_auth,
            commands::shop::booth_logout,
            commands::shop::booth_is_authenticated,
            commands::shop::booth_fetch_purchases,
            commands::shop::booth_get_owned_ids,
            commands::shop::booth_list_downloadables,
            commands::shop::download_direct_url,
            // ── Inventory ──
            commands::inventory::list_inventory,
            commands::inventory::delete_inventory_item,
            commands::inventory::create_inventory_folder,
            commands::inventory::list_inventory_folders,
            commands::inventory::move_item_to_folder,
            commands::inventory::tag_inventory_item,
            commands::inventory::get_file_tree,
            commands::inventory::open_item_location,
            commands::inventory::read_unitypackage,
            commands::inventory::set_item_product_images,
            commands::inventory::get_item_product_images,
            commands::inventory::import_local_package,
            commands::inventory::compress_item,
            commands::inventory::decompress_item,
            commands::inventory::reimport_all_assets,
            // ── VCS ──
            commands::vcs::get_vcs_status,
            commands::vcs::vcs_commit,
            commands::vcs::get_vcs_log,
            commands::vcs::list_vcs_branches,
            commands::vcs::create_vcs_branch,
            commands::vcs::switch_vcs_branch,
            commands::vcs::vcs_add_remote,
            commands::vcs::vcs_push,
            commands::vcs::vcs_pull,
            commands::vcs::github_start_device_auth,
            commands::vcs::github_poll_token,
            commands::vcs::github_get_user,
            commands::vcs::github_get_token,
            commands::vcs::github_logout,
            commands::vcs::vcs_get_commit_diff,
            commands::vcs::vcs_get_file_diff,
            // ── Journal ──
            commands::journal::journal_list,
            commands::journal::journal_create,
            commands::journal::journal_update,
            commands::journal::journal_delete,
            // ── Terminal ──
            commands::terminal::run_in_project,
            // ── Build Monitor ──
            commands::build_monitor::start_build_monitor,
            commands::build_monitor::stop_build_monitor,
            // ── VCS Conflicts ──
            commands::conflicts::vcs_get_conflicts,
            commands::conflicts::vcs_resolve_conflict,
            // ── Updates ──
            commands::updates::check_for_update,
            commands::updates::download_and_install_update,
            commands::updates::list_available_versions,
            // tracker
            commands::tracker::tracker_list,
            commands::tracker::tracker_create,
            commands::tracker::tracker_update,
            commands::tracker::tracker_delete,
            commands::tracker::tracker_list_events,
            commands::tracker::tracker_mark_events_read,
            commands::tracker::tracker_unread_count,
            // ── App settings / Storage ──
            commands::app_settings::get_app_settings,
            commands::app_settings::set_app_settings,
            commands::app_settings::get_storage_stats,
            commands::app_settings::clear_orphaned_cache,
            commands::app_settings::migrate_assets,
            commands::app_settings::clear_thumbnails_cache,
            commands::app_settings::clear_all_cache,
            commands::inventory::update_item_metadata,
            commands::inventory::set_item_custom_cover,
            commands::inventory::reorder_items,
            commands::inventory::set_item_custom_images,
            commands::inventory::update_folder,
            commands::inventory::move_folder_to_parent,
            commands::inventory::delete_inventory_folder,
            commands::inventory::reset_all_folder_assignments,
            commands::inventory::export_database_data,        // si también añadiste backup
            commands::inventory::import_database_data,        // si también añadiste backup
            commands::inventory::check_duplicate_items,
            // ── Multi-Avatar ──
            commands::multi_avatar::list_zip_contents,
            commands::multi_avatar::extract_sub_zip_to_temp,
            commands::multi_avatar::get_item_variants,
            commands::multi_avatar::import_multi_avatar_package,
            commands::multi_avatar::delete_variant,
            commands::multi_avatar::compress_variant,
            commands::multi_avatar::decompress_variant,
            commands::multi_avatar::set_variant_custom_image,
            commands::multi_avatar::create_migration_backup,
            commands::multi_avatar::create_container_zip,
            commands::vrchat_photos::get_vrchat_photos_default_path,
            commands::vrchat_photos::scan_vrchat_photos,
            commands::tracker::tracker_run_now,
            commands::app_settings::scan_reclaimable_files,
            commands::app_settings::delete_reclaimable_files,
            commands::app_settings::get_app_version,
            commands::projects::find_unity_for_version,
            commands::inventory::launch_unity_for_project,
            commands::inventory::check_unity_running,
            commands::inventory::import_items_in_unity,
            commands::inventory::open_single_item_in_unity,
            commands::projects::focus_unity_window,
            commands::app_settings::read_vcc_repos,
            commands::app_settings::debug_vcc_sources,
            commands::app_settings::read_vcc_repos,
            commands::projects::fetch_vpm_repo,
            commands::app_settings::check_git_installed,
            commands::vcs::create_vcs_branch_from_commit,
            commands::vcs::github_list_repos,
            commands::vcs::github_create_repo,
            commands::vcs::vcs_merge_branch,
            commands::vcs::vcs_delete_branch,
            commands::vcs::vcs_create_branch_with_init,
            commands::vcs::vcs_read_gitignore,
            commands::vcs::vcs_write_gitignore,
            commands::vcs::vcs_merge_by_sha,
            commands::inventory::download_to_temp,
            commands::shop::booth_capture_session_cookie,
            commands::inventory::reorder_folders, 
            commands::shop::booth_download_free_item,
            commands::cart::cart_get_items,
            commands::cart::cart_add_item,
            commands::cart::cart_remove_item,
            commands::cart::cart_clear,
            commands::cart::cart_is_in_cart,
            commands::collections::collections_list,
            commands::collections::collection_create,
            commands::collections::collection_delete,
            commands::collections::collection_rename,
            commands::collections::collection_set_cover,
            commands::collections::collection_add_item,
            commands::collections::collection_remove_item,
            commands::collections::collection_get_items,
            commands::collections::collection_get_item_collections,
            // ── Booth Dependencies ──
            commands::booth_deps::booth_deps_read,
            commands::booth_deps::booth_deps_add,
            commands::booth_deps::booth_deps_update_gitignore,
            commands::booth_deps::booth_deps_check_modifications,
            commands::booth_deps::project_clone_from_github,
            // ── Discord Rich Presence ──
            crate::services::discord_rpc::discord_rpc_update,
            crate::services::discord_rpc::discord_rpc_clear,
            crate::services::discord_rpc::discord_rpc_set_enabled,
            // ── Discord Auth ──
            crate::services::discord_auth::discord_authorize,
            crate::services::discord_auth::discord_reauthenticate,
            crate::services::discord_auth::discord_logout,
        ])
}