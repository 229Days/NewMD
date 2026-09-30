/**
 * The trip a pasted image takes from the clipboard to disk (ADR-0001 §2.8,
 * §4 M5: 图片粘贴落盘 `./assets/`).
 *
 * A pasted image is the one piece of content the document cannot hold: the
 * Markdown carries a *reference* to bytes that live somewhere else. So the
 * editor has to write a file before it can write the line, and the line it
 * writes has to be relative to the document — `./assets/…`, never an absolute
 * path and never a `blob:` URL. An absolute path breaks when the folder moves;
 * a blob URL breaks the moment the tab closes, and both fail silently, because
 * a reference round-trips byte-perfect whether or not anything it points at
 * exists.
 *
 * This module owns everything about that trip except the insertion, which is
 * the engine's to do. Like `math.ts` and `mermaid.ts` it makes no Milkdown
 * calls — it reads bytes off an event and writes them through the platform
 * adapter, which is the same door `stores/workspace.ts` uses.
 */
import { getPlatform, PlatformError } from "../platform";

/**
 * Where a pasted image belongs.
 *
 * Spelled as a getter at the call site rather than as two fields, because the
 * surface is mounted once and the document behind it changes: a reader who
 * pastes into tab B after opening tab A must not have B's screenshot written
 * into A's folder.
 */
export interface ImageTarget {
  /** Absolute path of the markdown file the image is being pasted into. */
  docPath: string;
  /** Directory it lands in, beside that file. From `settings.imageDirName`. */
  dirName: string;
}

/** The first image on the clipboard, or null when there is not one. */
export function imageFileOf(event: ClipboardEvent): File | null {
  const data = event.clipboardData;
  if (!data) return null;
  const files = data.files;
  if (files) {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (file?.type.startsWith("image/")) return file;
    }
  }
  // Screenshots on some platforms arrive as items rather than files.
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item?.kind !== "file" || !item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/**
 * `YYYYMMDD-HHmmss-<hash8>.<ext>` (ADR-0001 §2.8).
 *
 * The timestamp alone is not a name: pasting twice in the same second is the
 * ordinary case for a screenshot run. The hash is what makes the two differ,
 * and it is content-derived so the same image pasted twice lands once.
 */
export function imageFileName(bytes: Uint8Array, ext: string, at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = [
    at.getFullYear(),
    pad(at.getMonth() + 1),
    pad(at.getDate()),
    `-${pad(at.getHours())}`,
    pad(at.getMinutes()),
    pad(at.getSeconds()),
  ].join("");
  return `${stamp}-${hash8(bytes)}.${ext}`;
}

/**
 * FNV-1a over the bytes, zero-padded to the eight hex digits the ADR asks
 * for. It is a fingerprint for a filename, not a signature — the collision it
 * has to beat is two different screenshots written into one folder in the same
 * second, and the timestamp already rules out every other case.
 */
function hash8(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** `image/svg+xml` -> `svg`; anything unrecognised falls back to `png`. */
function extensionOf(type: string): string {
  const subtype = type
    .slice(type.indexOf("/") + 1)
    .split("+")[0]!
    .replace(/^x-/, "");
  return /^[a-z0-9]+$/i.test(subtype) ? subtype.toLowerCase() : "png";
}

/**
 * Write `file` into `target`'s image directory and return the path to put in
 * the Markdown.
 *
 * The two spellings differ on purpose. The file is addressed with the host's
 * separator so the platform recognises it; the Markdown carries `./` and `/`
 * because a link in a text file is not a filesystem path — a document saved on
 * Windows and then read on Linux has to keep working.
 */
export async function savePastedImage(target: ImageTarget, file: File): Promise<string> {
  const platform = getPlatform();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = imageFileName(bytes, extensionOf(file.type), new Date());

  const documentDir = platform.pathParent(target.docPath);
  if (documentDir === null) {
    throw new PlatformError(`No directory to place an image beside: ${target.docPath}`);
  }
  const dir = platform.pathJoin(documentDir, target.dirName);
  await platform.createDir(dir);

  await platform.writeBinaryFile(platform.pathJoin(dir, name), bytes);
  return `./${target.dirName}/${name}`;
}
