/**
 * Incremental update of a PDF (ISO 32000-1 §7.5.6): new and changed objects
 * are appended after the original bytes, with a cross-reference section that
 * points back to the previous one. Nothing already in the file changes, so
 * earlier signatures stay valid (spec 004, CA7 and CA9).
 */
import { PDFDocument, PDFRef, type PDFContext, type PDFObject } from "pdf-lib";
import { t } from "../i18n";

const latin1 = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** Offset of the last cross-reference section (after the last `startxref`). */
export function lastStartXref(bytes: Uint8Array): number {
  const tail = new TextDecoder("latin1").decode(
    bytes.subarray(Math.max(0, bytes.length - 2048)),
  );
  const m =
    /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail) ??
    [...tail.matchAll(/startxref\s+(\d+)/g)].at(-1);
  if (!m) throw new Error(t("signEngine.noStartxref"));
  return Number(m[1]);
}

/** /Size of the last cross-reference section (trailer or xref stream). */
export function trailerSize(bytes: Uint8Array): number {
  const prev = lastStartXref(bytes);
  const text = new TextDecoder("latin1").decode(
    bytes.subarray(prev, Math.min(bytes.length, prev + 65536)),
  );
  const m = /\/Size\s+(\d+)/.exec(text);
  return m ? Number(m[1]) : 0;
}

export interface WrittenUpdate {
  bytes: Uint8Array;
  /** Byte offset of each object written in the update. */
  offsets: Map<number, number>;
}

export class IncrementalUpdate {
  private readonly changed = new Set<number>();
  private readonly raw = new Map<number, Uint8Array>();

  private constructor(
    readonly base: Uint8Array,
    readonly doc: PDFDocument,
    private readonly baseLargest: number,
  ) {}

  static async load(base: Uint8Array): Promise<IncrementalUpdate> {
    const doc = await PDFDocument.load(base, {
      updateMetadata: false,
      ignoreEncryption: true,
    });
    if (doc.context.trailerInfo.Encrypt)
      throw new Error(t("signEngine.encrypted"));
    // pdf-lib drops object streams and xref streams when loading, so its
    // largest number can be below the file's: new objects start after /Size.
    const largest = Math.max(
      doc.context.largestObjectNumber,
      trailerSize(base) - 1,
    );
    doc.context.largestObjectNumber = largest;
    return new IncrementalUpdate(base, doc, largest);
  }

  get context(): PDFContext {
    return this.doc.context;
  }

  /** Marks an existing object as modified, so it is written again. */
  touch(ref: PDFRef): void {
    if (ref.objectNumber <= this.baseLargest)
      this.changed.add(ref.objectNumber);
  }

  /** Reserves a new object whose bytes are given later with `setRaw`. */
  reserve(): PDFRef {
    return this.context.nextRef();
  }

  /** Bytes of a reserved object (its dictionary or value, without `obj`/`endobj`). */
  setRaw(ref: PDFRef, bytes: Uint8Array): void {
    this.raw.set(ref.objectNumber, bytes);
  }

  /** Appends the update: objects, cross-reference section and trailer. */
  write(): WrittenUpdate {
    const { context, base } = this;
    const prev = lastStartXref(base);
    const prevIsStream = !/^\s*xref/.test(
      new TextDecoder("latin1").decode(base.subarray(prev, prev + 8)),
    );

    const objects = new Map<number, { gen: number; obj?: PDFObject }>();
    for (const [ref, obj] of context.enumerateIndirectObjects())
      if (
        ref.objectNumber > this.baseLargest ||
        this.changed.has(ref.objectNumber)
      )
        objects.set(ref.objectNumber, { gen: ref.generationNumber, obj });
    for (const num of this.raw.keys()) objects.set(num, { gen: 0 });

    const chunks: Uint8Array[] = [];
    let offset = base.length;
    const push = (b: Uint8Array) => {
      chunks.push(b);
      offset += b.length;
    };
    if (base[base.length - 1] !== 0x0a) push(latin1("\n"));

    const offsets = new Map<number, number>();
    for (const num of [...objects.keys()].sort((a, b) => a - b)) {
      const { gen, obj } = objects.get(num)!;
      offsets.set(num, offset);
      push(latin1(`${num} ${gen} obj\n`));
      const raw = this.raw.get(num);
      if (raw) push(raw);
      else {
        const body = new Uint8Array(obj!.sizeInBytes());
        obj!.copyBytesInto(body, 0);
        push(body);
      }
      push(latin1("\nendobj\n"));
    }

    const trailer = context.trailerInfo;
    const refs = (r: PDFObject | undefined) => (r ? r.toString() : null);
    const common = [
      `/Root ${refs(trailer.Root)}`,
      trailer.Info ? `/Info ${refs(trailer.Info)}` : "",
      trailer.ID ? `/ID ${trailer.ID.toString()}` : "",
      `/Prev ${prev}`,
    ]
      .filter(Boolean)
      .join(" ");

    const xrefOffset = offset;
    if (prevIsStream) {
      // Cross-reference stream: type (1 byte), offset (4), generation (2).
      const self = context.nextRef().objectNumber;
      offsets.set(self, xrefOffset);
      objects.set(self, { gen: 0 });
      const nums = [...objects.keys()].sort((a, b) => a - b);
      const data = new Uint8Array(nums.length * 7);
      nums.forEach((num, i) => {
        const off = offsets.get(num)!;
        const gen = objects.get(num)!.gen;
        data.set(
          [1, off >>> 24, (off >>> 16) & 255, (off >>> 8) & 255, off & 255],
          i * 7,
        );
        data[i * 7 + 5] = gen >> 8;
        data[i * 7 + 6] = gen & 255;
      });
      const size = Math.max(context.largestObjectNumber, self) + 1;
      push(
        latin1(
          `${self} 0 obj\n<< /Type /XRef /Size ${size} /Index [${runs(nums)
            .map(([a, n]) => `${a} ${n}`)
            .join(
              " ",
            )}] /W [1 4 2] ${common} /Length ${data.length} >>\nstream\n`,
        ),
      );
      push(data);
      push(latin1("\nendstream\nendobj\n"));
    } else {
      const nums = [...objects.keys()].sort((a, b) => a - b);
      const lines = ["xref"];
      for (const [start, count] of runs(nums)) {
        lines.push(`${start} ${count}`);
        for (let num = start; num < start + count; num++)
          lines.push(
            `${String(offsets.get(num)).padStart(10, "0")} ${String(objects.get(num)!.gen).padStart(5, "0")} n\r`,
          );
      }
      const size = context.largestObjectNumber + 1;
      lines.push(`trailer\n<< /Size ${size} ${common} >>`);
      push(latin1(lines.join("\n") + "\n"));
    }
    push(latin1(`startxref\n${xrefOffset}\n%%EOF\n`));

    const bytes = new Uint8Array(offset);
    bytes.set(base, 0);
    let at = base.length;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return { bytes, offsets };
  }
}

/** Contiguous runs of sorted numbers, as [first, count]. */
function runs(nums: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const num of nums) {
    const last = out.at(-1);
    if (last && last[0] + last[1] === num) last[1]++;
    else out.push([num, 1]);
  }
  return out;
}

export { latin1 };
