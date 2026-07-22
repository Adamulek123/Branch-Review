mod commands;
mod persistence;
mod state;

use std::sync::Arc;

use commands::*;
use github_diff::Backend;
use persistence::ProjectStore;
use serde::Serialize;
use state::AppState;
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
struct RepositoryUpdatedPayload {
    repo_id: String,
    generation: u64,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let backend = Backend::system();
            let mut updates = backend.registry().subscribe();
            let default_project_path = app.path().app_config_dir()?.join("projects.json");
            #[cfg(debug_assertions)]
            let project_path = std::env::var_os("BRANCH_REVIEW_PROJECTS_PATH")
                .map(std::path::PathBuf::from)
                .unwrap_or(default_project_path);
            #[cfg(not(debug_assertions))]
            let project_path = default_project_path;
            app.manage(AppState {
                backend,
                projects: Arc::new(ProjectStore::new(project_path)),
            });

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match updates.recv().await {
                        Ok(update) => {
                            let _ = handle.emit_to(
                                "main",
                                "repository://updated",
                                RepositoryUpdatedPayload {
                                    repo_id: update.repo_id.0,
                                    generation: update.generation,
                                },
                            );
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_capabilities,
            open_repository,
            close_repository,
            list_open_repositories,
            refresh_repository,
            get_repository_snapshot,
            create_comparison,
            get_file_comparison,
            pick_repository_directory,
            load_projects,
            save_project,
            delete_project
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Branch Review");
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::RepositoryUpdatedPayload;

    #[test]
    fn repository_event_payload_is_small_and_stable() {
        let value = serde_json::to_value(RepositoryUpdatedPayload {
            repo_id: "repo-7".into(),
            generation: 42,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "repo_id": "repo-7", "generation": 42 })
        );
    }

    #[test]
    fn main_capability_exposes_only_required_features() {
        let capability: Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        let permissions = capability["permissions"].as_array().unwrap();
        for expected in ["core:default", "core:event:allow-listen", "core:event:allow-unlisten", "updater:default", "process:allow-restart"] {
            assert!(permissions.iter().any(|permission| permission == expected));
        }
        assert!(capability.to_string().find("fs:").is_none());
        assert!(capability.to_string().find("shell:").is_none());
    }

    #[test]
    fn releases_are_signed_nsis_updates_from_github() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["bundle"]["targets"], serde_json::json!(["nsis"]));
        assert_eq!(config["bundle"]["createUpdaterArtifacts"], true);
        assert!(config["plugins"]["updater"]["pubkey"].as_str().unwrap().len() > 40);
        assert_eq!(config["plugins"]["updater"]["endpoints"][0], "https://github.com/Adamulek123/Branch-Review/releases/latest/download/latest.json");
    }

    #[test]
    fn desktop_window_preserves_the_minimum_review_workspace() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let window = &config["app"]["windows"][0];
        assert_eq!(window["minWidth"], 1024);
        assert_eq!(window["minHeight"], 680);
        assert_eq!(window["maximized"], true);
        assert_eq!(window["fullscreen"], false);
        assert_eq!(window["theme"], "Dark");
    }

    #[test]
    fn release_binary_uses_the_windows_gui_subsystem() {
        let entrypoint = include_str!("main.rs");
        assert!(
            entrypoint
                .contains("#![cfg_attr(not(debug_assertions), windows_subsystem = \"windows\")]")
        );
    }
}
