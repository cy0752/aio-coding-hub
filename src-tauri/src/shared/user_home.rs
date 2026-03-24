//! Usage: Resolve the effective user HOME directory consistently across runtime and tests.

use std::path::PathBuf;
use tauri::Manager;

const HOME_DIR_OVERRIDE_ENV: &str = "AIO_CODING_HUB_HOME_DIR";

pub(crate) fn home_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> crate::shared::error::AppResult<PathBuf> {
    if let Some(path) = std::env::var_os(HOME_DIR_OVERRIDE_ENV)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return Ok(path);
    }

    app.path()
        .home_dir()
        .map_err(|e| format!("failed to resolve home dir: {e}").into())
}
