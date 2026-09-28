import * as React from "react";
import * as lzStringModule from "lz-string";
import { formDocument, formToJson, readFormDocument } from "@shared/import";
import type { SavedForm } from "@shared/form-json";

type LzModule = typeof lzStringModule;

function isLzCodec(m: unknown): m is LzModule {
  if (!m || typeof m !== "object") return false;
  if (!("compressToEncodedURIComponent" in m) || !("decompressFromEncodedURIComponent" in m)) return false;
  return typeof m.compressToEncodedURIComponent === "function" && typeof m.decompressFromEncodedURIComponent === "function";
}

/** `import * as` from a CommonJS package yields either the namespace or `{ default: module.exports }`. */
function resolveLz(mod: unknown): LzModule {
  const unwrapped = !!mod && typeof mod === "object" && "default" in mod ? mod.default : mod;
  if (isLzCodec(unwrapped)) return unwrapped;
  if (isLzCodec(mod)) return mod;
  throw new Error("lz-string: unexpected module shape");
}

const LZ = resolveLz(lzStringModule);

const HASH_PARAM = "form";
const STORAGE_KEY = "jev-form-builder:form";

/** Compressed, URL-safe encoding of the `{ schema, uiSchema }` document. */
export const encodeState = (s: SavedForm) => LZ.compressToEncodedURIComponent(JSON.stringify(formDocument(s)));

/** Inverse of `encodeState`. Returns null on anything that is not a builder document. */
export function decodeState(encoded: string): SavedForm | null {
  try {
    const json = LZ.decompressFromEncodedURIComponent(encoded);
    return json ? readFormDocument(JSON.parse(json), (m) => console.warn(`Restored form: ${m}`)) : null;
  } catch {
    return null;
  }
}

export const stateToHash = (s: SavedForm) => `#${HASH_PARAM}=${encodeState(s)}`;

export function stateFromHash(hash: string): SavedForm | null {
  const m = new RegExp(`(?:^#|&)${HASH_PARAM}=([^&]+)`).exec(hash);
  return m ? decodeState(m[1]) : null;
}

/** The link that reproduces the current form. */
export function shareUrl(s: SavedForm): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${stateToHash(s)}`;
}

/** The URL wins; localStorage is the fallback when a plain link is opened. */
export function loadInitialState(): SavedForm | null {
  if (typeof window === "undefined") return null;
  const fromHash = stateFromHash(window.location.hash);
  if (fromHash) return fromHash;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? decodeState(raw) : null;
  } catch {
    return null; // private mode, quota or storage disabled
  }
}

function writeLocal(s: SavedForm): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, encodeState(s));
  } catch {
    // Not worth surfacing: the URL hash still carries the form.
  }
}

/** Saves text as a file, through a temporary object URL. */
export function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Keeps the form in the URL hash and in localStorage, and gives the header its
 * two actions: copy the share link, export the builder JSON.
 */
export function usePersistedForm(state: SavedForm): { copied: boolean; copyLink: () => void; exportJson: () => void } {
  const latest = React.useRef(state);
  latest.current = state;
  const [copied, setCopied] = React.useState(false);
  const { purpose, fields, threshold, overrides } = state;

  React.useEffect(() => {
    const t = setTimeout(() => {
      writeLocal(latest.current);
      const hash = stateToHash(latest.current);
      try {
        if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
      } catch {
        // replaceState can be blocked; localStorage has already been written.
      }
    }, 400);
    return () => clearTimeout(t);
  }, [purpose, fields, threshold, overrides]);

  const copyLink = React.useCallback(() => {
    const url = shareUrl(latest.current);
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {
        // Clipboard blocked (insecure context): the address bar already holds the hash.
      },
    );
  }, []);

  const exportJson = React.useCallback(() => downloadJson("form.json", formToJson(latest.current)), []);

  return { copied, copyLink, exportJson };
}
