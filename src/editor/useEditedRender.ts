import { useEffect, useMemo, useState } from "react";
import {
  isImageTextEdit,
  type Item,
  type TextEditItem,
} from "../model/document";
import type { TextDraft } from "./EditLayer";

export type RenderEdits = (
  edits: Item[],
  zoom: number,
) => Promise<string | null>;

/**
 * Render of the page with the changes only the save engine can show (spec
 * 001, CA3b; spec 005, CA4), or null while there is none: text edits, form
 * values and created fields, and removed or changed annotations of the file.
 * While a replacement is being typed, its original text is removed from the
 * render, so the draft is shown over the real background instead of a white
 * box.
 */
export function useEditedRender(
  items: Item[],
  draft: TextDraft | null,
  zoom: number,
  render: RenderEdits | undefined,
): { url: string; current: boolean } | null {
  const edits = useMemo(() => {
    const list: Item[] = [];
    for (const i of items) {
      if (i.kind === "textEdit") {
        // Edits of scanned text are drawn by the edit layer (spec 010).
        if (i.id !== draft?.itemId && !isImageTextEdit(i)) list.push(i);
      } else if (
        i.kind === "formValue" ||
        i.kind === "formField" ||
        i.kind === "annotRemoval"
      )
        list.push(i);
      // A changed annotation of the file is drawn over the page by the edit
      // layer; the render only removes the original.
      else if (i.kind === "annotation" && i.source)
        list.push({
          kind: "annotRemoval",
          id: `preview-${i.id}`,
          pageId: i.pageId,
          source: i.source,
        });
    }
    if (draft?.replace && !isImageTextEdit(draft.replace))
      list.push({ ...(draft.replace as TextEditItem), id: "draft", text: "" });
    return list;
  }, [items, draft]);
  const key = useMemo(() => JSON.stringify([zoom, edits]), [edits, zoom]);
  const [shown, setShown] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!render || edits.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      render(edits, zoom)
        .then((url) => {
          if (cancelled || !url) {
            if (url) URL.revokeObjectURL(url);
            return;
          }
          setShown((old) => {
            if (old) URL.revokeObjectURL(old.url);
            return { key, url };
          });
        })
        .catch(() => undefined);
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` captures the content of `edits`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, render]);

  useEffect(
    () => () => {
      setShown((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return null;
      });
    },
    [],
  );

  if (edits.length === 0 || !shown) return null;
  // The last render stays on screen until the next one is ready.
  return { url: shown.url, current: shown.key === key };
}
