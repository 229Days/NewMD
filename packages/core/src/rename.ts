/**
 * What a rename does to the rest of the workspace (ADR-0003 §2.8, §2.9).
 *
 * `reference-rewrite` answers what one document's text becomes. This decides
 * which documents there are, gets each one's current text, and puts the answer
 * back where the reader can see it — which differs by whether the document is
 * already open:
 *
 *   - **open** — its text is in memory and may be newer than its file, so the
 *     rewrite lands there. `savedContent` is left alone on purpose: the tab goes
 *     dirty, the reader sees the dot, and the next save is what puts it on disk.
 *     Writing the file here instead would throw away edits nobody saved.
 *   - **not open** — there is no memory to prefer, so it is read, rewritten and
 *     written back.
 *
 * **It runs after the file has moved.** The scan finds documents at the paths
 * they hold now, and the moved document has to be read from its new directory:
 * that is the directory its own relative links resolve against.
 */
import { rewriteReferences } from "./editor/reference-rewrite";
import { getPlatform } from "./platform";
import { pathJoin, pathParent } from "./platform/path";
import type { FileEntry } from "./platform/types";
import { useEditor } from "./stores/editor";
import { useWorkspace } from "./stores/workspace";
import { isMarkdownFile, type OpenDocument } from "./types";

/** Why the name the reader typed is not one this entry can take. */
export type RenameRefusal =
  /** Nothing, or nothing but whitespace. */
  | "empty"
  /** `.` or `..` — a place, not a name. */
  | "reserved"
  /** Carries a `/` or `\`, which would make this a move (§2.2). */
  | "separator"
  /** The name it already has. */
  | "same"
  /** Another entry in the same folder is already called that. */
  | "taken";

export type RenameCheck = { ok: true; to: string } | { ok: false; reason: RenameRefusal };

/**
 * Whether `name` is a name `entry` can take, and the absolute path it becomes.
 *
 * Called before the rename, and not only so the reader gets a sentence instead
 * of a filesystem error: `rename(2)` on POSIX *replaces* the destination, so on
 * those platforms the disk will not refuse an overwrite on our behalf.
 *
 * `siblings` are the entries to look for a collision among, and which of them
 * count is decided here rather than by the caller: only ones in the entry's own
 * folder. A rename compares names, so a list that reached into other folders
 * would refuse names that are free — which is the kind of mistake that looks
 * like the feature being broken rather than like a caller's bug.
 *
 * What it does have to be is *everything* in that folder, not the rows the tree
 * happens to show: a name is taken by a file whether or not the sidebar renders
 * it.
 */
export function checkRename(
  name: string,
  entry: FileEntry,
  siblings: readonly FileEntry[],
): RenameCheck {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed === "." || trimmed === "..") return { ok: false, reason: "reserved" };
  if (/[\\/]/.test(trimmed)) return { ok: false, reason: "separator" };
  if (trimmed === entry.name) return { ok: false, reason: "same" };

  const parent = pathParent(entry.path);
  // Compared without case, and against the path rather than the name: on a
  // case-insensitive filesystem the row being renamed is ordinarily the very
  // entry a case-blind match finds, and it is not a collision with itself.
  const wanted = trimmed.toLowerCase();
  const taken = siblings.some(
    (other) =>
      other.path !== entry.path &&
      pathParent(other.path) === parent &&
      other.name.toLowerCase() === wanted,
  );
  if (taken) return { ok: false, reason: "taken" };

  return { ok: true, to: parent === null ? trimmed : pathJoin(parent, trimmed) };
}

export interface RenameRewriteReport {
  /** Documents whose text changed. */
  documents: number;
  /** Destinations respelled across all of them. */
  rewritten: number;
  /** Destinations the move invalidated that could not be respelled safely. */
  unrewritten: number;
}

/**
 * Directories the scan stays out of.
 *
 * `.git` needs no entry: everything hidden is skipped, and the version-control
 * directory is the most important thing in a workspace not to edit behind the
 * reader's back. `node_modules` is the one non-hidden directory that is nobody's
 * prose.
 */
const OFF_LIMITS = new Set(["node_modules"]);

/**
 * Every document in the workspace, recursively.
 *
 * Only Markdown: those are the files this editor renders, and the only ones a
 * destination in them means anything. Reading the rest would be work whose
 * answer could not be used.
 */
async function documentsUnder(root: string): Promise<string[]> {
  const platform = getPlatform();
  const found: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries: FileEntry[];
    try {
      entries = await platform.listDir(dir);
    } catch {
      // Unreadable or gone. It holds no document we can rewrite, and failing
      // the whole rename over one locked folder helps nobody.
      return;
    }
    for (const entry of entries) {
      if (entry.kind === "dir") {
        if (entry.name.startsWith(".") || OFF_LIMITS.has(entry.name)) continue;
        await walk(entry.path);
      } else if (isMarkdownFile(entry.name)) {
        found.push(entry.path);
      }
    }
  };

  await walk(root);
  return found;
}

/**
 * Rename a file or a folder, and bring everything that depended on the old name
 * along with it.
 *
 * The order below is the design, not an implementation detail:
 *
 *   1. the tabs move first — autosave writes the path a tab holds, and the
 *      filesystem call underneath creates missing parent folders, so a tab left
 *      on the old path puts the file back there on the next tick;
 *   2. then the disk moves, and if it refuses, the tabs go back: they are the
 *      only thing that moved by then, and a tab on a path that does not exist
 *      writes a file into being;
 *   3. then the tree, whose re-read has to see a disk the move already happened
 *      on;
 *   4. and last the references, which read the moved document from the
 *      directory it now lives in — the one its own links resolve against.
 *
 * Returns what the rewrite did, for the caller to report.
 */
export async function renameEntry(from: string, to: string): Promise<RenameRewriteReport> {
  const platform = getPlatform();

  useEditor.getState().followRename(from, to);
  try {
    await platform.renamePath(from, to);
  } catch (error) {
    useEditor.getState().followRename(to, from);
    throw error;
  }

  await useWorkspace.getState().followRename(from, to);
  return rewriteAfterRename(from, to);
}

/**
 * Respell every reference the move invalidated, across the workspace and every
 * open tab.
 *
 * `from` and `to` are the paths the file had and has; call this once the move
 * itself has happened.
 */
export async function rewriteAfterRename(from: string, to: string): Promise<RenameRewriteReport> {
  const platform = getPlatform();
  const root = useWorkspace.getState().rootPath;
  const inWorkspace = root === null ? [] : await documentsUnder(root);

  // Keyed by path: a document that is open and also in the workspace is one
  // document, and the open one is the copy that counts.
  const open = new Map<string, OpenDocument>();
  for (const tab of useEditor.getState().tabs) {
    if (tab.path !== null) open.set(tab.path, tab);
  }

  const report: RenameRewriteReport = { documents: 0, rewritten: 0, unrewritten: 0 };

  for (const path of new Set([...open.keys(), ...inWorkspace])) {
    const tab = open.get(path);
    let source: string;
    if (tab) {
      source = tab.content;
    } else {
      try {
        source = (await platform.readTextFile(path)).content;
      } catch {
        // Vanished between the listing and the read. Nothing to rewrite.
        continue;
      }
    }

    const result = rewriteReferences(source, { documentPath: path, from, to });
    report.rewritten += result.rewritten;
    report.unrewritten += result.unrewritten;
    if (result.rewritten === 0) continue;

    report.documents += 1;
    if (tab) useEditor.getState().patchContent(path, result.text);
    else await platform.writeTextFile(path, result.text);
  }

  return report;
}
