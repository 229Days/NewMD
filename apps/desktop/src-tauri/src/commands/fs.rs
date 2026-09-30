//! Filesystem and native dialog commands.
//!
//! File IO lives here rather than in `tauri-plugin-fs` so the frontend does not
//! need per-path capability scopes; the app already knows which paths the user
//! chose through the native dialogs.

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntryDto {
    pub path: String,
    pub name: String,
    /// "file" | "dir"
    pub kind: String,
    pub size: Option<u64>,
    pub modified_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileDto {
    pub path: String,
    pub content: String,
    pub modified_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryFileDto {
    pub bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResultDto {
    pub path: String,
    pub modified_at: u64,
}

fn millis(time: std::io::Result<SystemTime>) -> Option<u64> {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

fn to_string_path(path: FilePath) -> Result<String, String> {
    match path.into_path() {
        Ok(p) => Ok(p.to_string_lossy().into_owned()),
        Err(e) => Err(format!("Not a local file path: {e}")),
    }
}

fn path_str(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Reads UTF-8 text, falling back to lossy decoding for files that are not
/// valid UTF-8. Content is returned verbatim — including any BOM and the file's
/// own line endings — so saving can reproduce the original bytes.
fn read_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(text),
        Err(err) => Ok(String::from_utf8_lossy(err.as_bytes()).into_owned()),
    }
}

#[tauri::command]
pub fn pick_folder(app: AppHandle) -> Option<String> {
    app.dialog().file().blocking_pick_folder().and_then(|p| to_string_path(p).ok())
}

#[tauri::command]
pub fn pick_file(app: AppHandle, extensions: Vec<String>) -> Option<String> {
    let mut picker = app.dialog().file();
    if !extensions.is_empty() {
        let names: Vec<&str> = extensions.iter().map(String::as_str).collect();
        picker = picker.add_filter("Markdown", &names);
    }
    picker.blocking_pick_file().and_then(|p| to_string_path(p).ok())
}

#[tauri::command]
pub fn pick_save_path(app: AppHandle, default_name: String, extensions: Vec<String>) -> Option<String> {
    let mut picker = app.dialog().file().set_file_name(&default_name);
    if !extensions.is_empty() {
        let names: Vec<&str> = extensions.iter().map(String::as_str).collect();
        picker = picker.add_filter("Markdown", &names);
    }
    picker.blocking_save_file().and_then(|p| to_string_path(p).ok())
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<FileEntryDto>, String> {
    let dir = Path::new(&path);
    let mut entries: Vec<FileEntryDto> = fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .map(|entry| {
            let meta = entry.metadata().ok();
            let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            FileEntryDto {
                path: path_str(&entry.path()),
                name: entry.file_name().to_string_lossy().into_owned(),
                kind: if is_dir { "dir".into() } else { "file".into() },
                size: meta.as_ref().filter(|m| !m.is_dir()).map(|m| m.len()),
                modified_at: meta.and_then(|m| millis(m.modified())),
            }
        })
        .collect();

    // Directories first, then case-insensitive name — matches what Explorer shows.
    entries.sort_by(|a, b| {
        b.kind
            .cmp(&a.kind)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<TextFileDto, String> {
    let file = Path::new(&path);
    let meta = fs::metadata(file).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(TextFileDto {
        path: path_str(file),
        content: read_text(file)?,
        modified_at: millis(meta.modified()).unwrap_or(0),
    })
}

/// Raw bytes of a file that is not text. Wrapped in a struct rather than
/// returned bare because a bare `Vec<u8>` has more than one way to cross the
/// IPC boundary, and `invoke` should not have to guess which one it got
/// (ADR-0001 §2.5 本地路径插入).
#[tauri::command]
pub fn read_binary_file(path: String) -> Result<BinaryFileDto, String> {
    let file = Path::new(&path);
    let bytes = fs::read(file).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(BinaryFileDto { bytes })
}

/// Creates the directory a file is about to be written into.
fn ensure_parent(file: &Path) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
    }
    Ok(())
}

/// Where a file just written ended up, and when.
fn write_result(file: &Path) -> Result<WriteResultDto, String> {
    let modified_at = fs::metadata(file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(WriteResultDto {
        path: path_str(file),
        modified_at,
    })
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<WriteResultDto, String> {
    let file = Path::new(&path);
    ensure_parent(file)?;
    fs::write(file, content.as_bytes()).map_err(|e| format!("{}: {e}", file.display()))?;
    write_result(file)
}

/// Raw bytes, for anything that is not text — a pasted image has to reach disk
/// unaltered (ADR-0001 §2.8), and routing it through a `String` would not
/// survive the trip.
#[tauri::command]
pub fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<WriteResultDto, String> {
    let file = Path::new(&path);
    ensure_parent(file)?;
    fs::write(file, bytes).map_err(|e| format!("{}: {e}", file.display()))?;
    write_result(file)
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    let dir = Path::new(&path);
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))
}

#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&to).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
    }
    fs::rename(&from, &to).map_err(|e| format!("{} -> {}: {e}", from, to))
}

#[tauri::command]
pub fn remove_path(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    let meta = fs::metadata(target).map_err(|e| format!("{}: {e}", target.display()))?;
    if meta.is_dir() {
        fs::remove_dir_all(target).map_err(|e| format!("{}: {e}", target.display()))
    } else {
        fs::remove_file(target).map_err(|e| format!("{}: {e}", target.display()))
    }
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}
