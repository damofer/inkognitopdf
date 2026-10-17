/**
 * Usage events (spec 011): a closed list of event names, and for each one the
 * parameters it may carry, each with a closed set of coarse values. Nothing
 * else ever leaves the device: no file names, text, content or signatures.
 */

export const PAGES = ["1", "2-5", "6-20", "21-100", "100+"] as const;
export const SIZES = ["<1MB", "1-10MB", "10-50MB", "50MB+"] as const;
export const FILES = ["2", "3-5", "6+"] as const;
/** Template ids (spec 021); a test keeps them in step with the catalog. */
export const TEMPLATE_IDS = [
  "cv-classic",
  "cv-modern",
  "cv-ats",
  "cover-letter",
  "invoice",
  "quote",
  "payment-request",
  "receipt",
  "resignation",
  "employment-certificate",
  "authorization",
  "no-debt", // i18n-ignore: template id
] as const;

const VALUES = {
  pages: PAGES,
  size: SIZES,
  files: FILES,
  /** Which template, never what was written in it (spec 021). */
  template: TEMPLATE_IDS,
  split: ["ranges", "every", "selection"],
  /** Compression preset (spec 014). */
  preset: ["high", "balanced", "small"],
  /** Page number format and position (spec 022), never the text. */
  format: ["number", "pageOf", "slash", "dashes", "bates", "custom"],
  position: ["tl", "tc", "tr", "bl", "bc", "br", "several"],
  /** Whether print or copy were restricted (spec 014), never the password. */
  restricted: ["yes", "no"],
  /** Donation link followed: only its amount tier. */
  tier: ["10000", "20000", "50000", "other", "kofi"],
  lang: ["es", "en"],
  mode: ["bw", "gray", "original"],
  source: ["file", "scan", "blank"],
  /** Visited page: only the route, never the full URL. */
  page_path: ["/", "/app/"],
  page_title: ["landing", "app"],
} as const;

type Param = keyof typeof VALUES;

/** Each event and the parameters it may carry. */
const EVENTS = {
  page_view: ["page_path", "page_title"],
  open_document: ["pages", "size"],
  new_blank: [],
  scan_document: ["pages", "mode"],
  ocr_run: ["pages"],
  edit_text: [],
  edit_scan_text: [],
  add_text: [],
  annotate: [],
  whiteout: [],
  redact: [],
  merge_pdf: ["files", "pages"],
  split_pdf: ["split", "pages"],
  compress_pdf: ["preset", "pages"],
  protect_pdf: ["restricted"],
  page_numbers: ["format", "position"],
  unlock_pdf: [],
  add_image: [],
  create_field: [],
  fill_form: [],
  sign_document: [],
  save_document: ["pages", "source"],
  change_language: ["lang"],
  install_app: [],
  donate_click: ["tier"],
  open_app: [],
  template_open: ["template"],
  template_download: ["template"],
  template_to_editor: ["template"],
} as const satisfies Record<string, readonly Param[]>;

export type EventName = keyof typeof EVENTS;
export type EventParams = Partial<Record<Param, string>>;

/**
 * The event as it may be sent, or null for an unknown event. Parameters not
 * allowed for the event, and values outside their closed set, are dropped.
 */
export function sanitize(
  name: string,
  params: Record<string, unknown> = {},
): { name: EventName; params: EventParams } | null {
  if (!Object.hasOwn(EVENTS, name)) return null;
  const allowed: readonly Param[] = EVENTS[name as EventName];
  const clean: EventParams = {};
  for (const key of allowed) {
    const value = params[key];
    if (
      typeof value === "string" &&
      (VALUES[key] as readonly string[]).includes(value)
    )
      clean[key] = value;
  }
  return { name: name as EventName, params: clean };
}

export function pagesBucket(count: number): (typeof PAGES)[number] {
  if (count <= 1) return "1";
  if (count <= 5) return "2-5";
  if (count <= 20) return "6-20";
  if (count <= 100) return "21-100";
  return "100+";
}

export function sizeBucket(bytes: number): (typeof SIZES)[number] {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return "<1MB";
  if (mb < 10) return "1-10MB";
  if (mb < 50) return "10-50MB";
  return "50MB+";
}

export function filesBucket(count: number): (typeof FILES)[number] {
  if (count <= 2) return "2";
  if (count <= 5) return "3-5";
  return "6+";
}
