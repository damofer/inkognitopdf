// English messages: compressing and password protection (spec 014).
import type { protect as es } from "../es/protect";

export const protect: typeof es = {
  "protect.wrongPassword": "The password is not correct.",
  "protect.unsupported":
    "This PDF uses a kind of encryption that cannot be opened yet.",
  "protect.askTitle": "Protected PDF",
  "protect.askText": (file: string) =>
    `“${file}” is password protected. Type the password to open it.`,
  "protect.password": "Password",
  "protect.open": "Open",
  "protect.cancel": "Cancel",
  "protect.cancelled": (file: string) => `“${file}” was not opened.`,
  "protect.button": "Password",
  "protect.hint": "Add or remove the PDF password",
  "protect.title": "Protect with a password",
  "protect.repeat": "Repeat the password",
  "protect.mismatch": "The passwords do not match.",
  "protect.empty": "Type a password.",
  "protect.allowPrint": "Allow printing",
  "protect.allowCopy": "Allow copying text",
  "protect.permsNote":
    "Print and copy permissions are only advisory: many programs ignore them. What does protect the file is the password to open it (AES-256).",
  "protect.forgetNote":
    "If you forget the password, there is no way to recover the file.",
  "protect.apply": "Protect when saving",
  "protect.active":
    "The PDF will be saved protected with a password (AES-256).",
  "protect.remove": "Remove password",
  "protect.removed": "Password removed: the PDF will be saved without it.",
  "protect.set": "Password ready: it will be applied when saving.",
  "protect.signBlocked":
    "To sign digitally, remove the password first (“Password” panel).",
  "protect.opened":
    "PDF opened with its password. Saving keeps it, unless you remove it.",
  "protect.permissionsOnly":
    "This PDF had permission restrictions; it was opened without them.",
  "protect.close": "Close",
  "compress.button": "Compress",
  "compress.hint": "Make the PDF smaller",
  "compress.title": "Compress PDF",
  "compress.level": "Compression level",
  "compress.high": "High quality",
  "compress.highHelp":
    "Only scales down images with a lot of resolution (200 dpi).",
  "compress.balanced": "Balanced",
  "compress.balancedHelp":
    "Images at 150 dpi: they look good on screen and in print.",
  "compress.small": "Smallest size",
  "compress.smallHelp": "Images at 96 dpi, to send by email or chat.",
  "compress.current": (size: string) => `Size of the opened file: ${size}`,
  "compress.run": "Compress and download",
  "compress.working": "Compressing…",
  "compress.result": (before: string, after: string, saved: number) =>
    `${before} → ${after} (${saved}% smaller)`,
  "compress.noGain":
    "The file is already optimized: it could not be made smaller.",
  "compress.suffix": "compressed",
  "compress.failed": (reason: string) =>
    `The PDF could not be compressed: ${reason}`,
  "compress.close": "Close",
};
