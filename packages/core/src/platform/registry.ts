import type { PlatformAdapter } from "./types";

let current: PlatformAdapter | null = null;

/**
 * Inject the platform adapter once at app startup.
 * Desktop registers the Tauri adapter; a bare browser build registers the
 * File System Access adapter. Tests register a fake.
 */
export function setPlatform(adapter: PlatformAdapter): void {
  current = adapter;
}

export function getPlatform(): PlatformAdapter {
  if (!current) {
    throw new Error(
      "Platform adapter not registered. Call setPlatform() during app startup before using core APIs.",
    );
  }
  return current;
}

export function isPlatformRegistered(): boolean {
  return current !== null;
}

/** Test-only: drop the registered adapter. */
export function resetPlatform(): void {
  current = null;
}
