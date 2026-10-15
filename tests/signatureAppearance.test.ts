// Spec 004, F002: signatures flattened into the page (HU4, CA1–CA3, CA6).
import { createCanvas } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/engine/applyEdits";
import { placement } from "../src/engine/signature";
import type { EditorState, SignatureItem } from "../src/model/document";
import {
  cropDrawing,
  smoothStroke,
  type SignatureAsset,
} from "../src/model/signature";
import { fixture, qpdfCheck, qpdfPath, stateFor, testDeps } from "./helpers";
import { inkShare, renderPage } from "./renderHelpers";

const drawn = cropDrawing(
  [
    smoothStroke(
      Array.from({ length: 20 }, (_, i) => ({
        x: 10 + i * 10,
        y: 40 + 25 * Math.sin(i / 2),
        w: 3,
      })),
    ),
    [{ x: 120, y: 90, w: 4 }],
  ],
  "#0a2a8a",
)!;

function png(): { png: Uint8Array; width: number; height: number } {
  const canvas = createCanvas(120, 40);
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(5, 30);
  ctx.bezierCurveTo(40, -10, 80, 70, 115, 10);
  ctx.stroke();
  return {
    png: new Uint8Array(canvas.toBuffer("image/png")),
    width: 120,
    height: 40,
  };
}

const ASSETS: Record<string, SignatureAsset> = {
  drawn,
  typed: {
    kind: "typed",
    text: "Ana Pérez",
    font: "DancingScript",
    color: "#000000",
  },
  image: { kind: "image", ...png() },
};

async function signed(asset: SignatureAsset, rotate: 0 | 90 = 0) {
  const base = await fixture("simple-text.pdf");
  const state: EditorState = await stateFor(base);
  const rect = { x: 300, y: 100, width: 150, height: 50 };
  const item: SignatureItem = {
    kind: "signature",
    id: "s1",
    pageId: state.pages[0]!.id,
    role: "signature",
    rect,
    asset,
    rotate,
  };
  const { bytes } = await applyEdits(
    base,
    { ...state, items: [item] },
    testDeps,
  );
  return { bytes, rect };
}

describe("flattened signature", () => {
  for (const [kind, asset] of Object.entries(ASSETS))
    it(`${kind}: drawn inside its box, valid PDF`, async () => {
      const { bytes, rect } = await signed(asset);
      const page = await renderPage(bytes);
      expect(inkShare(page, rect)).toBeGreaterThan(0.01);
      // Nothing drawn just outside the box.
      expect(
        inkShare(page, {
          x: rect.x + rect.width + 2,
          y: rect.y,
          width: 40,
          height: rect.height,
        }),
      ).toBe(0);
      if (qpdfPath)
        expect(await qpdfCheck(bytes)).toMatch(
          /No syntax or stream encoding errors/,
        );
    });

  it("typed signature embeds a subset of the handwriting font", async () => {
    const { bytes } = await signed(ASSETS.typed!);
    const doc = await PDFDocument.load(bytes);
    const names = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) =>
        obj instanceof PDFDict ? obj.get(PDFName.of("BaseFont")) : undefined,
      )
      .filter(Boolean)
      .map(String);
    expect(names.some((n) => /^\/[A-Z]{6}\+DancingScript/.test(n))).toBe(true);
  });

  it("the placement matrix maps the box corners onto the rect", () => {
    const rect = { x: 10, y: 20, width: 100, height: 40 };
    const apply = (m: number[], x: number, y: number) => [
      m[0]! * x + m[2]! * y + m[4]!,
      m[1]! * x + m[3]! * y + m[5]!,
    ];
    const m0 = placement({ width: 50, height: 20 }, rect, 0);
    expect(apply(m0, 50, 20)).toEqual([110, 60]);
    const m90 = placement({ width: 20, height: 50 }, rect, 90);
    // Turned 90° counter-clockwise: bottom-left of the box at bottom-right.
    expect(apply(m90, 0, 0)).toEqual([110, 20]);
    expect(apply(m90, 20, 50)).toEqual([10, 60]);
  });
});
