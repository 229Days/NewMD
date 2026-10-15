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

/**
 * A path reduced to the two things a comparison needs: which root it is on, and
 * its segments.
 *
 * The root is folded to a comparable key — the drive letter lowercased, UNC
 * separators forward-slashed, a bare `\` and a bare `/` both read as the one
 * root they are. Segments are left exactly as they were written, because those
 * are the names on disk and case matters to them (see `pathRelative`).
 */
function segmentsOf(path: string): { root: string; parts: string[] } {
  const { prefix, rest } = splitPrefix(normalize(path, "/"));
  const root = prefix.startsWith("\\\\")
    ? prefix.replace(/\\/g, "/").toLowerCase()
    : /^[a-zA-Z]:[\\/]$/.test(prefix)
      ? `${prefix[0]!.toLowerCase()}:/`
      : prefix.replace(/\\/g, "/");
  return { root, parts: rest.split(SEPARATORS).filter((segment) => segment !== "") };
}

/**
 * The path to write for `to` when read from the directory `fromDir`.
 *
 * The output is a Markdown destination, so it obeys the spelling the image flow
 * already fixed (ADR-0003 §2.6): forward slashes whatever the inputs used, and
 * a leading `./` when the target is at or below the directory. A document
 * written on Windows has to resolve on Linux, and `.\a.png` does not.
 *
 * **Segments are compared case-sensitively, deliberately.** Comparing them
 * loosely would let `C:\Notes` and `C:\notes` look like one directory, and the
 * answer would then be spelled with whichever of the two names came second —
 * a link that resolves on Windows and breaks on Linux. Walking up instead uses
 * the target's own spelling, which is right on both.
 *
 * With no relative path to give — the two paths are on different drives, where
 * no `..` reaches — this returns `to` unchanged rather than inventing one. The
 * caller can tell, and must: an absolute destination is not something to write
 * into Markdown (ADR-0003 §2.5), so that answer is a "skip this one".
 */
export function pathRelative(fromDir: string, to: string): string {
  const from = segmentsOf(fromDir);
  const target = segmentsOf(to);
  if (from.root !== target.root) return to;

  let common = 0;
  while (
    common < from.parts.length &&
    common < target.parts.length &&
    from.parts[common] === target.parts[common]
  ) {
    common += 1;
  }

  const ups = from.parts.length - common;
  const tail = target.parts.slice(common).join("/");
  return `${ups === 0 ? "./" : "../".repeat(ups)}${tail}`;
}

/**
 * Where `path` ends up once `from` has become `to`, or null when the move never
 * reached it.
 *
 * One operation covers both names for it: a file rename is the case where the
 * answer is `to` itself, and a folder rename is the case where a subtree keeps
 * its shape under a new one. Nothing here distinguishes them, because nothing
 * needs to (ADR-0003 §2.2).
 *
 * Containment falls out of `pathRelative`: a path at or under `from` reads back
 * as `./…`, and the two ways of saying no — a path outside, a path on another
 * root — read back as `../…` and as an absolute path. **Null does not mean
 * "unchanged"**, so a caller that keeps the path it passed in must say so
 * itself; that is the difference between "not mine" and "mine, and it did not
 * have to move".
 */
export function pathAfterMove(path: string, from: string, to: string): string | null {
  const relative = pathRelative(from, path);
  if (isAbsolute(relative) || relative.startsWith("../")) return null;
  return pathJoin(to, relative);
}
