// English messages: privacy x-ray (spec 015).
import type { xray as es } from "../es/xray";

export const xray: typeof es = {
  "xray.button": "X-ray",
  "xray.hint":
    "What does this PDF hide? Metadata, earlier versions, invisible text, attachments…",
  "xray.title": "What does this PDF hide?",
  "xray.close": "Close x-ray",
  "xray.scanning": "Analyzing the file on your device…",
  "xray.failed": "The file could not be analyzed.",
  "xray.nothing": "We found nothing hidden.",
  "xray.onlyInfo": "We found nothing worrying.",
  "xray.summary": (n) =>
    n === 1
      ? "This PDF hides 1 thing you cannot see."
      : `This PDF hides ${n} things you cannot see.`,
  "xray.local": "The analysis runs on your device; the PDF is not uploaded.",
  "xray.level.high": "High risk",
  "xray.level.medium": "Review",
  "xray.level.info": "For information",
  "xray.remove": "Remove",
  "xray.alwaysRemoved": "Always removed when cleaning.",
  "xray.kind.versions": "Earlier versions",
  "xray.kind.hiddenText": "Invisible text",
  "xray.kind.attachments": "Attached files",
  "xray.kind.javascript": "JavaScript and actions",
  "xray.kind.metadata": "Metadata",
  "xray.kind.whiteText": "White text",
  "xray.kind.authors": "Names in comments",
  "xray.kind.hiddenLayers": "Hidden layers",
  "xray.kind.thumbnails": "Embedded thumbnails",
  "xray.kind.pieceInfo": "Editing program data",
  "xray.kind.links": "Links to websites",
  "xray.kind.ocrText": "Recognized text (OCR)",
  "xray.kind.signatures": "Digital signatures",
  "xray.about.versions":
    "The file keeps earlier versions of the document: anyone can recover what it said before.",
  "xray.about.hiddenText":
    "Text that is in the file but cannot be seen: invisible, off the page or tiny. It can be copied and searched.",
  "xray.about.attachments": "Files stored inside the PDF.",
  "xray.about.javascript":
    "Code or actions that run on opening or clicking: they can open programs or send data.",
  "xray.about.metadata": "Author, programs, dates and other file data.",
  "xray.about.whiteText":
    "White text, which cannot be seen on the paper. It may be fine on a dark background: check it.",
  "xray.about.authors":
    "Comments keep the name of who wrote them. Cleaning keeps the comments, without the names.",
  "xray.about.hiddenLayers":
    "Content in layers the viewer does not show, but which is still in the file.",
  "xray.about.thumbnails":
    "Small images of the pages stored separately; they may show an earlier version.",
  "xray.about.pieceInfo":
    "Private data left by programs such as Illustrator or Photoshop; sometimes the whole original document.",
  "xray.about.links": "Links to outside sites. They are usually intended.",
  "xray.about.ocrText":
    "Invisible text over a scanned image, so it can be searched and copied. This is normal.",
  "xray.about.signatures":
    "The PDF is digitally signed. Cleaning it makes the signature invalid.",
  "xray.version": (n, size) => `Version ${n} (${size})`,
  "xray.loose": (n) =>
    n === 1
      ? "1 unused object from earlier edits"
      : `${n} unused objects from earlier edits`,
  "xray.downloadVersion": "Download",
  "xray.versionSuffix": (n) => `earlier version ${n}`,
  "xray.meta.Title": "Title",
  "xray.meta.Author": "Author",
  "xray.meta.Subject": "Subject",
  "xray.meta.Keywords": "Keywords",
  "xray.meta.Creator": "Creating program",
  "xray.meta.Producer": "PDF program",
  "xray.meta.CreationDate": "Created",
  "xray.meta.ModDate": "Modified",
  "xray.meta.XMP": (size) => `XMP metadata (${size})`,
  "xray.meta.XMPParts": (n) =>
    n === 1
      ? "XMP metadata in 1 image or part"
      : `XMP metadata in ${n} images or parts`,
  "xray.text.hidden": "invisible",
  "xray.text.outside": "off the page",
  "xray.text.tiny": "tiny",
  "xray.page": (n) => `Page ${n}`,
  "xray.js.document": "In the document",
  "xray.js.page": "On a page",
  "xray.js.field": "In a field",
  "xray.js.annot": "In an annotation",
  "xray.js.xfa": "XFA form (may carry scripts)",
  "xray.js.Launch": "Opens a program or file",
  "xray.js.SubmitForm": "Sends the form to an address",
  "xray.js.ImportData": "Imports data from a file",
  "xray.js.GoToR": "Opens another PDF",
  "xray.js.GoToE": "Opens an attached PDF",
  "xray.js.Rendition": "Plays media",
  "xray.times": (n) => (n === 1 ? "once" : `${n} times`),
  "xray.comments": (n) => (n === 1 ? "1 comment" : `${n} comments`),
  "xray.noName": "(no name)",
  "xray.clean": "Clean and save",
  "xray.cleaning": "Cleaning…",
  "xray.nothingChecked": "Check at least one thing to remove.",
  "xray.cleaned": (file) => `Saved “${file}”. This is the clean copy:`,
  "xray.cleanSuffix": "clean",
};
