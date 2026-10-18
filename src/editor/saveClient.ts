/**
 * Promise-based client of the save worker (spec 038). Where the worker cannot
 * run, `build` rejects with SaveWorkerUnavailable and the caller saves on the
 * main thread instead.
 */
import type { SaveOptions, SaveResult } from "../engine/applyEdits";
import { EngineError } from "../engine/applyEdits";
import { getLang } from "../i18n/core";
import type { EditorState } from "../model/document";
import type { SaveResponse } from "./saveProtocol";

export class SaveWorkerUnavailable extends Error {
  constructor(message = "save worker unavailable") {
    super(message);
    this.name = "SaveWorkerUnavailable";
  }
}

/** The worker, once it said it listens; null where it cannot run. */
let worker: Promise<Worker | null> | undefined;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (r: SaveResult) => void; reject: (e: Error) => void }
>();

function rejectAll(error: Error) {
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
}

function start(): Promise<Worker | null> {
  let instance: Worker;
  try {
    instance = new Worker(new URL("./saveWorker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const giveUp = (reason: string) => {
      instance.terminate();
      worker = Promise.resolve(null);
      resolve(null);
      rejectAll(new SaveWorkerUnavailable(reason));
    };
    instance.onmessage = (event: MessageEvent<SaveResponse>) => {
      const reply = event.data;
      if ("ready" in reply) {
        resolve(instance);
        return;
      }
      const waiter = pending.get(reply.seq);
      if (!waiter) return;
      pending.delete(reply.seq);
      if (reply.ok) waiter.resolve(reply.result);
      else if (reply.unavailable) {
        waiter.reject(new SaveWorkerUnavailable(reply.error.message));
        giveUp(reply.error.message);
      } else if (reply.error.name === "EngineError")
        waiter.reject(new EngineError(reply.error.message));
      else waiter.reject(new Error(reply.error.message));
    };
    // The worker failed to load or crashed: what it had pending goes back to
    // the main thread, and so does every later save.
    instance.onerror = (event) => {
      event.preventDefault();
      giveUp(event.message);
    };
  });
}

/** Builds the PDF in the worker; `original` is transferred to it. */
export async function buildInWorker(
  original: Uint8Array,
  state: EditorState,
  options: SaveOptions,
): Promise<SaveResult> {
  if (typeof Worker === "undefined") throw new SaveWorkerUnavailable();
  worker ??= start();
  const target = await worker;
  if (!target) throw new SaveWorkerUnavailable();
  const id = ++seq;
  return new Promise<SaveResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ seq: id, original, state, options, lang: getLang() }, [
      original.buffer,
    ]);
  });
}
