// English messages: page numbers, headers and footers (spec 022).
import type { numbering as es } from "../es/numbering";

export const numbering: typeof es = {
  "numbering.button": "Numbers",
  "numbering.hint": "Page numbers, headers and footers",
  "numbering.title": "Number pages",
  "numbering.close": "Close page numbers",
  "numbering.position": "Position",
  "numbering.slot.tl": "Top left",
  "numbering.slot.tc": "Top center",
  "numbering.slot.tr": "Top right",
  "numbering.slot.bl": "Bottom left",
  "numbering.slot.bc": "Bottom center",
  "numbering.slot.br": "Bottom right",
  "numbering.formats": "Quick formats",
  "numbering.pageOfLabel": "Page 1 of N",
  "numbering.pageOfText": "Page {n} of {total}",
  "numbering.clearSlot": "Clear",
  "numbering.text": (slot) => `Text: ${slot}`,
  "numbering.fields":
    "Fields: {n} number, {total} last number, {date}, {file}, {bates}.",
  "numbering.batesPrefix": "Bates prefix",
  "numbering.batesDigits": "Digits",
  "numbering.pages": "Pages",
  "numbering.from": "From",
  "numbering.to": "To",
  "numbering.startAt": "First number",
  "numbering.style": "Style",
  "numbering.font": "Font",
  "numbering.size": "Size",
  "numbering.color": "Color",
  "numbering.margin": "Margin (mm)",
  "numbering.summary": (from, to, first, last) =>
    from === to
      ? `Page ${from}: number ${first}.`
      : `Pages ${from} to ${to}: numbers ${first} to ${last}.`,
  "numbering.noPages": "There are no pages in that range.",
  "numbering.noText": "Write a text in some position.",
  "numbering.apply": "Apply",
  "numbering.remove": "Remove page numbers",
  "numbering.applied": "Page numbers applied. You can undo it.",
  "numbering.removed": "Page numbers removed.",
};
