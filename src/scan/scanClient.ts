import { t } from "../i18n";
import type { ScanMode } from "./enhance";
import type { Quad } from "./homography";
import type { PaperSize } from "./pipeline";
import type {
  AddResult,
  RenderResult,
  ScanRequest,
  ScanResponse,
} from "./protocol";

/** Promise-based client of the scanner worker. */
export class ScanClient {
  private readonly worker = new Worker(
    new URL("./scanWorker.ts", import.meta.url),
    { type: "module" },
  );
  private seq = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<ScanResponse>) => {
      const reply = event.data;
      const waiter = this.pending.get(reply.seq);
      if (!waiter) return;
      this.pending.delete(reply.seq);
      if (reply.ok) waiter.resolve(reply.result);
      else waiter.reject(new Error(reply.code ? t(reply.code) : reply.error));
    };
  }

  private call<T>(req: ScanRequest, transfer: Transferable[] = []): Promise<T> {
    const seq = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(seq, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.worker.postMessage({ seq, req }, transfer);
    });
  }

  add(id: string, bitmap: ImageBitmap, detect: boolean): Promise<AddResult> {
    return this.call({ op: "add", id, bitmap, detect }, [bitmap]);
  }

  render(
    id: string,
    quad: Quad,
    mode: ScanMode,
    quarters: number,
    paper: PaperSize,
  ): Promise<RenderResult> {
    return this.call({ op: "render", id, quad, mode, quarters, paper });
  }

  drop(id: string): Promise<null> {
    return this.call({ op: "drop", id });
  }

  terminate(): void {
    this.worker.terminate();
    for (const { reject } of this.pending.values())
      reject(new Error(t("scan.closed")));
    this.pending.clear();
  }
}
