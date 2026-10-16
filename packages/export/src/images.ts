/**
 * A picture the page carries rather than points at (ADR-0005 §2.6).
 *
 * An exported page's ordinary fate is being sent to somebody, and a Markdown
 * image is a path — `./assets/map.png` means nothing once the file is on its
 * own. So the bytes are read off disk and written into the page as a data URI,
 * which is the one spelling of an image that travels.
 *
 * **What it will not do.** Fetch a picture from a server: that would put the
 * reader's address in a third party's log for the sake of a file, and make the
 * page's contents depend on that server still having it. Guess at a path it
 * cannot resolve: ADR-0003 §2.7, and the same reason the editor does not
 * rewrite a link it cannot follow. Label bytes it cannot name: a data URI has to
 * carry a media type, and `application/octet-stream` is a label that renders as
 * nothing, so a file whose name does not say what it is keeps its path.
 *
 * Each of those is a `reason` on the outcome rather than a silent skip — the
 * report is how a caller learns that the page it is about to send is not quite
 * the whole document.
 *
 * Nothing here reads the filesystem itself: bytes come through the platform
 * adapter, which is the only door to the host this package has (ADR-0005 §2.4).
 */
import { getPlatform } from "@newmd/core";

/**
 * Why a picture is not in the page.
 *
 * Four, because they lead to four different things a reader can do about it:
 * find the file again, save the document, put the file back, or rename it.
 */
export type ImageReason =
  /** Somewhere else entirely — a URL, not a path. Deliberately not fetched. */
  | "remote"
  /** A relative path with no folder to be relative to: the document is unsaved. */
  | "unresolved"
  /** Resolved to a path, and reading it failed: gone, a directory, no permission. */
  | "unreadable"
  /** Bytes that were read, and a name that does not say what they are. */
  | "unknown-type";

/** A picture that stayed a path, and why. */
export interface ImageNotice {
  url: string;
  reason: ImageReason;
}

/** What became of the picture: in the page, already in it, or still a path. */
export type ImageOutcome =
  { kind: "inlined"; src: string } | { kind: "present" } | { kind: "kept"; reason: ImageReason };

/**
 * The media types an `<img>` can be given as a data URI.
 *
 * By extension, because that is what the document wrote and what the file on
 * disk is called — the platform adapter reads bytes and reports no type
 * (ADR-0001 §2.5 本地路径插入 takes the type from the pasted `File` instead,
 * which is not available here). Types a browser will not draw from a data URI
 * are absent on purpose: inlining them would grow the page without producing a
 * picture at either end.
 */
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

/** A source that is already the picture, which is what this module produces. */
const ALREADY_INLINE = /^data:/i;

/**
 * A source carrying a scheme, or protocol-relative — somewhere this writer will
 * not go. `file:` lands here too: it is not a path relative to the document, and
 * teaching one URL scheme a second spelling of paths would be a special case for
 * something a Markdown author does not write.
 */
const ELSEWHERE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * The page's version of `url`, given the directory the document lives in.
 *
 * `docDir` is `null` for a document that has never been saved, which is the one
 * case a relative path cannot be answered at all.
 */
export async function inlineImage(url: string, docDir: string | null): Promise<ImageOutcome> {
  // Already in the page. Reporting it would be this writer calling its own
  // output a problem.
  if (ALREADY_INLINE.test(url)) return { kind: "present" };
  if (ELSEWHERE.test(url)) return { kind: "kept", reason: "remote" };
  if (docDir === null) return { kind: "kept", reason: "unresolved" };

  const platform = getPlatform();
  const type = IMAGE_TYPES[(platform.pathExtension(url) ?? "").toLowerCase()];
  // Before the read, not after: a file whose type is unknown from its name is
  // one there was never a reason to open.
  if (type === undefined) return { kind: "kept", reason: "unknown-type" };

  let bytes: Uint8Array;
  try {
    // `pathJoin` resolves the document's own `.` and `..`, and an absolute
    // source wins outright — a document that names a file by its full path is
    // naming a file this machine can read.
    bytes = await platform.readBinaryFile(platform.pathJoin(docDir, url));
  } catch {
    return { kind: "kept", reason: "unreadable" };
  }
  return { kind: "inlined", src: `data:${type};base64,${toBase64(bytes)}` };
}

/**
 * `bytes` as base64.
 *
 * `btoa` takes a binary string, and the one-liner
 * `String.fromCharCode(...bytes)` puts every byte in the argument list — a 3MB
 * photograph is three million arguments, which overflows the stack. Hence the
 * chunks, sized to stay well inside the limit a call has.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}
