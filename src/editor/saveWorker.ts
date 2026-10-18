/// <reference lib="webworker" />
/**
 * Save worker (spec 038): the engine builds the PDF here, so the interface
 * keeps responding while a long document is saved.
 */
import { applyEdits } from "../engine/applyEdits";
import { setLang } from "../i18n/core";
import { browserImageCodec } from "./imageCodec";
import { loadFont } from "./loadFont";
import type { SaveRequest, SaveResponse } from "./saveProtocol";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<SaveRequest>) => {
  const { seq, original, state, options, lang } = event.data;
  const reply = (response: SaveResponse, transfer: Transferable[] = []) =>
    self.postMessage(response, transfer);
  // Redacting JPEG images needs a canvas, which workers only have offscreen.
  if (typeof OffscreenCanvas === "undefined") {
    reply({
      seq,
      ok: false,
      unavailable: true,
      error: { name: "Error", message: "OffscreenCanvas" },
    });
    return;
  }
  try {
    setLang(lang, false);
    const result = await applyEdits(
      original,
      state,
      { loadFont, images: browserImageCodec },
      options,
    );
    reply({ seq, ok: true, result }, [result.bytes.buffer]);
  } catch (cause) {
    const error =
      cause instanceof Error
        ? { name: cause.name, message: cause.message }
        : { name: "Error", message: String(cause) };
    reply({ seq, ok: false, error });
  }
};

self.postMessage({ ready: true } satisfies SaveResponse);
