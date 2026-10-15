// Product name shown to users. Folders, the package and the repository keep
// the project's working name, pdfcraft; identifiers written inside PDFs (the
// /PdfcraftSigning key, "pdfcraft-" field names) stay as they are so files
// prepared by earlier versions keep working.
export const BRAND = "InkognitoPDF";

/** The public source code repository. */
export const SOURCE_URL = "https://github.com/damofer/inkognitopdf";

/** The wordmark, split for styling: "Inkognito" + "PDF". */
export const BRAND_PARTS = ["Inkognito", "PDF"] as const;
