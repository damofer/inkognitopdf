// Finds user-visible Spanish text left hardcoded in the app sources (spec 006).
// Every visible string should come from the translation files in src/i18n.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { es } from "../src/i18n/es";

export interface Finding {
  file: string;
  line: number;
  text: string;
}

const srcDir = join(import.meta.dirname, "..", "src");

/**
 * Files that hold the translations themselves. Templates keep their own texts,
 * in both languages, next to their layout (spec 021).
 */
const translationFiles = /^(i18n[\\/](es|en)|templates[\\/]content)[\\/]/;

/** Attributes whose value is shown to the user or read by screen readers. */
const visibleAttributes = new Set([
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "placeholder",
  "alt",
  "label",
]);

const spanishChars = /[áéíóúñüÁÉÍÓÚÑ¿¡«»]/;
const stopwords = new Set(
  (
    "de del la el los las que para con una un por se su sus es al lo como " +
    "este esta sin en o y no ya hay le les ni muy cada todo todos"
  ).split(" "),
);
/** Common Spanish UI words without accents or stopwords around them. */
const spanishWords = new Set(
  (
    "abrir guardar cerrar cancelar aceptar firmar borrar eliminar deshacer " +
    "rehacer escanear texto pagina paginas firma firmas firmante firmantes " +
    "listo nuevo nueva documento campo campos anadir agregar quitar girar " +
    "rotar subir bajar mover color grosor fuente negrita cursiva tamano " +
    "imagen imagenes nota flecha linea rectangulo elipse dibujo dibujar " +
    "subrayar tachar resaltar relleno aplanar formulario seleccionar editar " +
    "descargar exportar importar verificar certificado certificados clave " +
    "contrasena usuario nombre correo fecha motivo lugar contacto valida " +
    "invalida desconocida cargando abriendo guardando procesando fotos foto " +
    "recortar recorte bordes esquinas grises blanco negro mejorar " +
    "listos pendiente hecho siguiente anterior volver cargar casilla opcion " +
    "lista desplegable boton etiqueta obligatorio solo lectura tipo valor " +
    "ancho alto izquierda derecha centro arriba abajo zoom ajustar ninguno " +
    "ninguna otro otra idioma escribir subrayado tachado"
  ).split(" "),
);

const words = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .match(/[a-z]+/g) ?? [];

/** Whether a string reads as Spanish prose or a Spanish UI label. */
export function looksSpanish(text: string): boolean {
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(text)) return false;
  if (spanishChars.test(text)) return true;
  const list = words(text);
  if (list.some((w) => spanishWords.has(w))) return true;
  return list.length >= 2 && list.some((w) => stopwords.has(w));
}

/** Message keys, CSS custom properties and language tags: never shown as is. */
const isMachineToken = (text: string) =>
  Object.hasOwn(es, text) || /^(--[\w-]+|[a-z]{2}-[A-Z]{2})$/.test(text);

/** Text with at least one word: any of it in a JSX child is visible. */
const hasWords = (text: string) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(text);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.(test|d)\.ts$/.test(entry.name))
      return [];
    return [path];
  });
}

/** Lines marked `i18n-ignore` (on the line itself or the line above). */
function ignoredLines(text: string): Set<number> {
  const lines = new Set<number>();
  text.split("\n").forEach((line, i) => {
    if (!line.includes("i18n-ignore")) return;
    lines.add(i + 1);
    lines.add(i + 2);
  });
  return lines;
}

function isInsideImport(node: ts.Node) {
  for (let n: ts.Node | undefined = node; n; n = n.parent)
    if (
      ts.isImportDeclaration(n) ||
      ts.isExportDeclaration(n) ||
      ts.isImportTypeNode(n) ||
      ts.isLiteralTypeNode(n)
    )
      return true;
  return false;
}

/** The JSX attribute a literal is the value of, if any. */
function jsxAttributeOf(node: ts.Node): ts.JsxAttribute | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isJsxAttribute(n)) return n;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) return undefined;
    if (ts.isCallExpression(n)) return undefined;
  }
  return undefined;
}

/** Whether a literal is a JSX child, e.g. `{busy ? "Saving" : "Save"}`. */
function isJsxChildExpression(node: ts.Node) {
  let child = node;
  for (let n: ts.Node | undefined = node.parent; n; child = n, n = n.parent) {
    if (ts.isJsxExpression(n))
      return !!n.parent && !ts.isJsxAttribute(n.parent);
    if (ts.isConditionalExpression(n)) {
      if (child === n.condition) return false;
    } else if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      const valueOps = [
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ];
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        if (child !== n.right) return false;
      } else if (!valueOps.includes(op)) return false;
    } else if (
      !ts.isParenthesizedExpression(n) &&
      !ts.isTemplateExpression(n) &&
      !ts.isTemplateSpan(n)
    )
      return false;
  }
  return false;
}

export function scanSource(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const ignored = ignoredLines(text);
  const findings: Finding[] = [];
  const report = (node: ts.Node, value: string) => {
    const line =
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (!ignored.has(line))
      findings.push({ file, line, text: value.trim().slice(0, 80) });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (hasWords(node.text)) report(node, node.text);
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const value = node.text;
      if (!isInsideImport(node) && !isMachineToken(value.trim())) {
        const attribute = jsxAttributeOf(node);
        const attributeName = attribute?.name.getText(source);
        if (attributeName && visibleAttributes.has(attributeName)) {
          if (hasWords(value)) report(node, value);
        } else if (isJsxChildExpression(node)) {
          if (hasWords(value)) report(node, value);
        } else if (!attribute && looksSpanish(value)) report(node, value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** Hardcoded Spanish across `src/`, outside the translation files. */
export function scanApp(): Finding[] {
  return sourceFiles(srcDir).flatMap((path) => {
    const file = relative(srcDir, path);
    if (translationFiles.test(file)) return [];
    return scanSource(file.replaceAll("\\", "/"), readFileSync(path, "utf8"));
  });
}
