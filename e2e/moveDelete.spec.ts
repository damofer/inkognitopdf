// Spec 026: every item placed on a page is moved by dragging it with the tool
// that created it still active, and is removed with the «Eliminar» button
// shown on the selection, with a mouse and with a finger.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { firstPage, makePng, openFixture, showTool } from "./helpers";

type Box = { x: number; y: number; width: number; height: number };

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** A point of the first page, as fractions of its width and height. */
async function at(page: Page, fx: number, fy: number) {
  const b = (await firstPage(page).boundingBox())!;
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

/** A finger drag, as the touch screen sends it. */
async function touchDrag(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
) {
  const cdp = await page.context().newCDPSession(page);
  const send = (
    type: "touchStart" | "touchMove" | "touchEnd",
    px = x,
    py = y,
  ) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: px, y: py, id: 1 }],
    });
  await send("touchStart");
  for (let i = 1; i <= 12; i++) {
    await send("touchMove", x + (dx * i) / 12, y + (dy * i) / 12);
    await page.waitForTimeout(16);
  }
  await send("touchEnd");
  await cdp.detach();
}

async function drag(
  page: Page,
  touch: boolean,
  x: number,
  y: number,
  dx: number,
  dy: number,
) {
  if (touch) return touchDrag(page, x, y, dx, dy);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}

async function tap(page: Page, touch: boolean, x: number, y: number) {
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Phone sheets that hold each tool (spec 025). */
const SHEET: Record<string, string> = {
  Seleccionar: "Editar",
  Texto: "Editar",
  Imagen: "Editar",
  Blanqueo: "Editar",
  "Borrado seguro": "Editar",
  Campos: "Más",
};

async function chooseTool(page: Page, touch: boolean, name: string) {
  if (touch) {
    const sheet = SHEET[name] ?? "Anotar";
    await page
      .getByRole("navigation", { name: "Categorías de herramientas" })
      .getByRole("button", { name: sheet })
      .click();
    await page
      .getByRole("dialog", { name: sheet })
      .getByRole("button", { name, exact: true })
      .click();
    return;
  }
  await showTool(page, name);
  await page
    .getByRole("group", { name: /^Herramientas de/ })
    .getByRole("button", { name, exact: true })
    .click();
}

interface Case {
  name: string;
  /** Creates the item with its tool and leaves that tool active. */
  create: (page: Page, touch: boolean) => Promise<Locator>;
  desktopOnly?: boolean;
  /** Strokes are drawn one after another: a tap selects the last one. */
  tapToSelect?: boolean;
}

const typed =
  (tool: string, kind: string, box: string | null) =>
  async (page: Page, touch: boolean) => {
    await chooseTool(page, touch, tool);
    const p = await at(page, 0.3, 0.45);
    await tap(page, touch, p.x, p.y);
    const input = box
      ? page.getByRole("textbox", { name: box })
      : page.locator(".text-draft");
    await input.fill("Hola mundo");
    if (touch && !box)
      await page.getByRole("button", { name: "Aceptar" }).click();
    else await input.press("Control+Enter");
    return firstPage(page).locator(`.item-${kind}`);
  };

const drawn =
  (tool: string, kind = "annotation") =>
  async (page: Page, touch: boolean) => {
    await chooseTool(page, touch, tool);
    const p = await at(page, 0.3, 0.5);
    await drag(page, touch, p.x, p.y, 90, 60);
    return firstPage(page).locator(`.item[data-kind="${kind}"]`);
  };

const CASES: Case[] = [
  { name: "texto", create: typed("Texto", "text", null) },
  {
    name: "texto libre",
    create: typed("Texto libre", "freeText", "Texto libre"),
  },
  { name: "nota", create: typed("Nota", "note", "Texto de la nota") },
  { name: "rectángulo", create: drawn("Rectángulo") },
  { name: "elipse", create: drawn("Elipse") },
  { name: "línea", create: drawn("Línea") },
  { name: "flecha", create: drawn("Flecha") },
  { name: "dibujo", create: drawn("Dibujar"), tapToSelect: true },
  { name: "blanqueo", create: drawn("Blanqueo", "whiteout") },
  { name: "borrado seguro", create: drawn("Borrado seguro", "redaction") },
  {
    name: "resaltado",
    desktopOnly: true,
    create: async (page) => {
      await chooseTool(page, false, "Resaltar");
      const line = firstPage(page).locator(".textLayer span").nth(1);
      const b = (await line.boundingBox())!;
      await page.mouse.move(b.x + 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, {
        steps: 5,
      });
      await page.mouse.up();
      return firstPage(page).locator('.item[data-kind="annotation"]');
    },
  },
  {
    name: "campo de formulario",
    create: async (page, touch) => {
      await chooseTool(page, touch, "Campos");
      const p = await at(page, 0.3, 0.45);
      await tap(page, touch, p.x, p.y);
      return firstPage(page).locator(".item-formField");
    },
  },
  {
    name: "imagen",
    create: async (page, touch) => {
      const chooser = page.waitForEvent("filechooser");
      await chooseTool(page, touch, "Imagen");
      await (
        await chooser
      ).setFiles({
        name: "foto.png",
        mimeType: "image/png",
        buffer: makePng(40, 30),
      });
      const p = await at(page, 0.3, 0.45);
      await tap(page, touch, p.x, p.y);
      return firstPage(page).locator(".item-image");
    },
  },
  {
    name: "firma",
    create: async (page, touch) => {
      if (touch)
        await page
          .getByRole("navigation", { name: "Categorías de herramientas" })
          .getByRole("button", { name: "Firmar" })
          .click();
      else
        await page.getByRole("button", { name: "Firmar", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "Firmar" });
      await panel.getByRole("button", { name: "Crear" }).first().click();
      await page.getByRole("tab", { name: "Escribir" }).click();
      await page
        .getByRole("dialog")
        .getByRole("textbox")
        .first()
        .fill("Ana Pérez");
      await page.getByRole("button", { name: "Usar" }).click();
      await panel.getByRole("button", { name: "Colocar firma" }).click();
      const p = await at(page, 0.4, 0.45);
      await tap(page, touch, p.x, p.y);
      return firstPage(page).locator(".item-signature");
    },
  },
];

for (const device of [
  { name: "escritorio", touch: false },
  { name: "móvil", touch: true },
]) {
  test.describe(device.name, () => {
    if (device.touch)
      test.use({
        viewport: { width: 412, height: 915 },
        isMobile: true,
        hasTouch: true,
      });
    for (const c of CASES) {
      if (c.desktopOnly && device.touch) continue;

      test(`${c.name}: se mueve con su herramienta activa`, async ({
        page,
      }) => {
        await openFixture(page, "simple-text.pdf");
        const item = (await c.create(page, device.touch)).last();
        await expect(item).toBeVisible();
        if (c.tapToSelect) {
          await expect(item).not.toHaveClass(/selected/);
          const p = center((await item.boundingBox())!);
          await tap(page, device.touch, p.x, p.y);
          await expect(item).toHaveClass(/selected/);
        }
        const before = (await item.boundingBox())!;
        const p = center(before);
        await drag(page, device.touch, p.x, p.y, 40, 60);
        const after = (await item.boundingBox())!;
        expect(after.x - before.x).toBeCloseTo(40, -1);
        expect(after.y - before.y).toBeCloseTo(60, -1);
      });

      test(`${c.name}: se elimina con el botón Eliminar`, async ({ page }) => {
        await openFixture(page, "simple-text.pdf");
        const items = await c.create(page, device.touch);
        await expect(items).toHaveCount(1);
        if (c.tapToSelect) {
          const p = center((await items.boundingBox())!);
          await tap(page, device.touch, p.x, p.y);
        }
        await page
          .getByRole("button", { name: "Eliminar", exact: true })
          .click();
        await expect(items).toHaveCount(0);
      });
    }
  });
}
