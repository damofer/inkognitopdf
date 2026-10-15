import { PDFDocument } from "pdf-lib";
import { readAnnotations, type ExistingAnnot } from "../engine/annotRead";
import { readFields, type FieldInfo } from "../engine/formRead";
import type { PdfFile } from "../storage/pdfFile";

/**
 * Form fields and annotations of the opened file (spec 005), read once with
 * pdf-lib. Loaded on demand, only for files that have them.
 */
export interface DocInfo {
  fields: FieldInfo[];
  /** Annotations by page index of the original file. */
  annots: ExistingAnnot[][];
}

export const EMPTY_DOC_INFO: DocInfo = { fields: [], annots: [] };

export async function readDocInfo(file: PdfFile): Promise<DocInfo> {
  const doc = await PDFDocument.load(file.copyBytes(), {
    updateMetadata: false,
  });
  return {
    fields: readFields(doc),
    annots: doc.getPages().map((_, i) => readAnnotations(doc, i, "")),
  };
}
