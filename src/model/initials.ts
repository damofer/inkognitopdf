// Spec 019: initials on every page at once, like the signing services do.
import {
  effectiveRotation,
  type EditorState,
  type SignatureItem,
} from "./document";
import { PageGeometry } from "./geometry";
import type { SignatureAsset } from "./signature";

/** Height of the initials and their distance to the page edges, in points. */
const HEIGHT = 28;
const MARGIN = 36;

/**
 * Initials at the bottom right of every page that has none yet, upright as
 * the page is seen. `aspect` is the asset's width / height.
 */
export function initialsOnEveryPage(
  state: EditorState,
  asset: SignatureAsset,
  aspect: number,
  newId: () => string,
): SignatureItem[] {
  const signed = new Set(
    state.items.flatMap((i) =>
      i.kind === "signature" && i.role === "initials" ? [i.pageId] : [],
    ),
  );
  return state.pages
    .filter((entry) => !signed.has(entry.id))
    .map((entry) => {
      const rotation = effectiveRotation(entry);
      const page = new PageGeometry(entry.box, rotation, 1);
      let height = HEIGHT;
      let width = height * aspect;
      const maxWidth = page.viewWidth * 0.3;
      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspect;
      }
      return {
        kind: "signature" as const,
        id: newId(),
        pageId: entry.id,
        role: "initials" as const,
        asset,
        rect: page.rectToPdf({
          x: page.viewWidth - MARGIN - width,
          y: page.viewHeight - MARGIN - height,
          width,
          height,
        }),
        rotate: rotation,
      };
    });
}
