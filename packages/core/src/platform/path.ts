/**
 * Native path helpers.
 *
 * `PlatformAdapter` exposes these synchronously, so the Tauri adapter cannot
 * shell out to Rust for them. Windows paths are the primary target, but the
 * helpers accept POSIX separators too so tests and cross-platform code behave.
 *
 * When joining, the separator is taken from `base` and `relative`'s own
 * separators are normalised to match — otherwise a Windows base joined with a
 * forward-slash relative path yields a mixed string.
 */

const SEPARATORS = /[\\/]/;

export function isAbsolute(path: string): boolean {
  return /^([a-zA-Z]:)?[\\/]/.test(path) || path.startsWith("\\\\");
}

function preferredSeparator(path: string): string {
  const hasBack = path.includes("\\");
  const hasSlash = path.includes("/");
  if (hasBack && hasSlash) {
    if (path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path)) return "\\";
    return path.indexOf("\\") < path.indexOf("/") ? "\\" : "/";
  }
  return hasBack ? "\\" : "/";
}

function splitPrefix(path: string): { prefix: string; rest: string } {
  if (path.startsWith("\\\\")) {
    // UNC: \\server\share\...
    const match = /^\\\\[^\\/]+[\\/][^\\/]+/.exec(path);
    return match
      ? { prefix: match[0], rest: path.slice(match[0].length) }
      : { prefix: path, rest: "" };
  }
  const drive = /^[a-zA-Z]:[\\/]/.exec(path);
  if (drive) return { prefix: drive[0], rest: path.slice(drive[0].length) };
  if (path.startsWith("/") || path.startsWith("\\")) {
    return { prefix: path[0]!, rest: path.slice(1) };
  }
  return { prefix: "", rest: path };
}

/** Resolve `.` and `..`, collapsing separators to `sep`. */
function normalize(path: string, sep: string): string {
  const { prefix, rest } = splitPrefix(path);
  const segments: string[] = [];
  for (const segment of rest.split(SEPARATORS)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      const last = segments[segments.length - 1];
      if (segments.length > 0 && last !== "..") {
        segments.pop();
      } else if (prefix === "") {
        // Relative path: keep the `..` so it can resolve against a real base later.
        segments.push("..");
      }
      // At a root or drive prefix, `..` is a no-op — never escape the root.
      continue;
    }
    segments.push(segment);
  }

  const tail = segments.join(sep);
  if (prefix === "") return tail;
  const needsSeparator = tail !== "" && !prefix.endsWith("/") && !prefix.endsWith("\\");
  return prefix + (needsSeparator ? sep : "") + tail;
}

/** Join `base` with `relative`, resolving `.` and `..`. An absolute `relative` wins. */
export function pathJoin(base: string, relative: string): string {
  if (isAbsolute(relative)) return normalize(relative, preferredSeparator(relative));
  const sep = preferredSeparator(base);
  const trimmedBase = base.replace(/[\\/]+$/, "");
  return normalize(`${trimmedBase}${sep}${relative}`, sep);
}

/** Parent directory, or null at a root. */
export function pathParent(path: string): string | null {
  const sep = preferredSeparator(path);
  const { prefix, rest } = splitPrefix(normalize(path, sep));
  const segments = rest.split(SEPARATORS).filter((s) => s !== "");
  if (segments.length === 0) return null;
  segments.pop();
  const tail = segments.join(sep);
  if (prefix === "") return tail || null;
  const needsSeparator = tail !== "" && !prefix.endsWith("/") && !prefix.endsWith("\\");
  return prefix + (needsSeparator ? sep : "") + tail;
}

/** Final segment of the path, or null when the path is only a root. */
export function pathFileName(path: string): string | null {
  const sep = preferredSeparator(path);
  const { rest } = splitPrefix(normalize(path, sep));
  const segments = rest.split(SEPARATORS).filter((s) => s !== "");
  return segments[segments.length - 1] ?? null;
}

/** Extension without the dot, or null when there is none. */
export function pathExtension(path: string): string | null {
  const name = pathFileName(path);
  if (!name) return null;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : null;
}

/** `notes.md` -> `notes`; used when deriving a name for Save As. */
export function pathBaseName(path: string): string | null {
  const name = pathFileName(path);
  if (!name) return null;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
