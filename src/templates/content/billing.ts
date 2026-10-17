// Billing templates (spec 021): payment request ("cuenta de cobro"), simple
// invoice, quote and receipt. Totals are computed from the items (CA6).
import type { Lang } from "../../i18n/core";
import { parseAmount, todayIso } from "../format";
import type { Block, Cell } from "../layout";
import type { BuildContext, ListDef, Localized, Row, Template } from "../types";
import {
  L,
  LINE,
  MUTED,
  field,
  joined,
  paragraphs,
  signature,
  text,
  tint,
} from "./common";

const NOT_E_INVOICE = L(
  "Este documento no es una factura electrónica (DIAN, SAT/CFDI, Verifactu…). Si estás obligado a facturar electrónicamente, usa el sistema autorizado en tu país.",
  "This is not an electronic invoice. If your country requires e-invoicing (DIAN, SAT/CFDI, Verifactu…), use the authorized system.",
);

const itemsList: ListDef = {
  key: "items",
  label: L("Conceptos", "Items"),
  addLabel: L("Añadir concepto", "Add item"),
  fields: [
    field("description", "text", "Descripción", "Description"),
    field("qty", "number", "Cantidad", "Quantity"),
    field("price", "money", "Valor unitario", "Unit price"),
  ],
};

export interface Totals {
  lines: { row: Row; qty: number; price: number; amount: number }[];
  subtotal: number;
  tax: number;
  total: number;
}

/** Amount of each item (quantity × unit price), subtotal, tax and total. */
export function totals(rows: Row[], taxPercent = 0): Totals {
  const lines = rows.map((row) => {
    const qty = row.qty?.trim() ? parseAmount(row.qty) : 1;
    const price = parseAmount(row.price ?? "");
    return { row, qty, price, amount: Math.round(qty * price * 100) / 100 };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = Math.round(subtotal * taxPercent) / 100;
  return { lines, subtotal, tax, total: subtotal + tax };
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

const qtyText = (n: number, lang: Lang) =>
  new Intl.NumberFormat(lang === "es" ? "es-CO" : "en-US", {
    maximumFractionDigits: 3,
  }).format(n);

/** The items table with its header in the accent color. */
function itemsTable(ctx: BuildContext, t: Totals): Block {
  return {
    type: "table",
    before: 6,
    columns: [
      { width: 0.52 },
      { width: 0.12, align: "right" },
      { width: 0.18, align: "right" },
      { width: 0.18, align: "right" },
    ],
    header: [
      ctx.tx(L("Descripción", "Description")),
      ctx.tx(L("Cant.", "Qty")),
      ctx.tx(L("Valor unit.", "Unit price")),
      ctx.tx(L("Importe", "Amount")),
    ],
    rows: t.lines.map((l) => [
      l.row.description ?? "",
      qtyText(l.qty, ctx.lang),
      ctx.money(l.price),
      ctx.money(l.amount),
    ]),
    headerFill: ctx.style.accent,
    headerColor: "#FFFFFF",
    stripe: tint(ctx.style.accent, 0.94),
    lineColor: LINE,
  };
}

/** Subtotal, tax and total on the right. */
function totalsBox(ctx: BuildContext, t: Totals, taxLabel: string): Block {
  const line = (label: string, value: string, strong = false): Block => ({
    type: "row",
    cells: [
      {
        blocks: [
          text(label, {
            variant: strong ? "Bold" : "Regular",
            size: strong ? 11 : 10,
          }),
        ],
      },
      {
        blocks: [
          text(value, {
            align: "right",
            variant: strong ? "Bold" : "Regular",
            size: strong ? 11 : 10,
          }),
        ],
      },
    ],
  });
  const rows: Block[] = [
    line(ctx.tx(L("Subtotal", "Subtotal")), ctx.money(t.subtotal)),
  ];
  if (t.tax) rows.push(line(taxLabel, ctx.money(t.tax)));
  rows.push({
    type: "rule",
    color: ctx.style.accent,
    thickness: 0.8,
    before: 3,
    after: 3,
  });
  rows.push(line(ctx.tx(L("Total", "Total")), ctx.money(t.total), true));
  return {
    type: "row",
    before: 8,
    cells: [
      { width: 0.55, blocks: [] },
      {
        blocks: [
          {
            type: "box",
            fill: tint(ctx.style.accent, 0.92),
            padding: 8,
            blocks: rows,
          },
        ],
      },
    ],
  };
}

// Invoice and quote -----------------------------------------------------------

interface DocumentKind {
  id: string;
  name: Localized;
  description: Localized;
  title: Localized;
  /** Label of the second date: due date or valid until. */
  untilLabel: Localized;
  notesLabel: Localized;
  sampleNotes: Localized;
  notice?: Localized;
}

const businessFields = [
  field("business", "text", "Tu negocio o nombre", "Your business or name"),
  field("businessId", "text", "NIT, RFC o identificación fiscal", "Tax ID"),
  field("address", "text", "Dirección", "Address"),
  field("phone", "tel", "Teléfono", "Phone"),
  field("email", "email", "Correo", "Email"),
];

const clientFields = [
  field("client", "text", "Cliente", "Client"),
  field("clientId", "text", "Identificación del cliente", "Client tax ID"),
  field("clientAddress", "text", "Dirección del cliente", "Client address"),
  field("clientEmail", "email", "Correo del cliente", "Client email"),
];

function sampleBusiness(lang: Lang) {
  return lang === "es"
    ? {
        business: "Estudio Creativo Luna",
        businessId: "NIT 901.234.567-8",
        address: "Calle 10 # 43-21, Medellín",
        phone: "+57 604 555 1234",
        email: "hola@estudioluna.com",
        client: "Café La Montaña S.A.S.",
        clientId: "NIT 900.876.543-2",
        clientAddress: "Carrera 70 # 1-35, Medellín",
        clientEmail: "compras@cafelamontana.com",
      }
    : {
        business: "Luna Creative Studio",
        businessId: "EIN 12-3456789",
        address: "200 Congress Ave, Austin, TX",
        phone: "+1 512 555 0134",
        email: "hello@lunastudio.com",
        client: "Mountain Coffee LLC",
        clientId: "EIN 98-7654321",
        clientAddress: "15 Main St, Dallas, TX",
        clientEmail: "billing@mountaincoffee.com",
      };
}

function sampleItems(lang: Lang): Row[] {
  return lang === "es"
    ? [
        {
          description: "Diseño de logotipo y manual de marca",
          qty: "1",
          price: "1800000",
        },
        {
          description: "Diseño de empaques (por referencia)",
          qty: "3",
          price: "450000",
        },
        {
          description: "Fotografía de producto (por hora)",
          qty: "4",
          price: "120000",
        },
      ]
    : [
        { description: "Logo design and brand guide", qty: "1", price: "1800" },
        { description: "Packaging design (per item)", qty: "3", price: "450" },
        {
          description: "Product photography (per hour)",
          qty: "4",
          price: "120",
        },
      ];
}

function invoiceLike(kind: DocumentKind): Template {
  return {
    id: kind.id,
    category: "billing",
    name: kind.name,
    description: kind.description,
    notice: kind.notice,
    fields: [
      ...businessFields,
      field("number", "text", "Número", "Number"),
      field("date", "date", "Fecha", "Date"),
      field("until", "date", kind.untilLabel.es, kind.untilLabel.en),
      ...clientFields,
      field("currency", "currency", "Moneda", "Currency"),
      field("taxName", "text", "Nombre del impuesto", "Tax name"),
      field("tax", "percent", "Impuesto (%)", "Tax (%)"),
      field("notes", "multiline", kind.notesLabel.es, kind.notesLabel.en),
    ],
    lists: [itemsList],
    sample(lang) {
      const due = new Date();
      due.setDate(due.getDate() + 30);
      return {
        fields: {
          ...sampleBusiness(lang),
          number: kind.id === "invoice" ? "F-0001" : "C-0001",
          date: todayIso(),
          until: todayIso(due),
          currency: "",
          taxName: lang === "es" ? "IVA" : "Sales tax",
          tax: lang === "es" ? "19" : "8.25",
          notes: kind.sampleNotes[lang],
        },
        lists: { items: sampleItems(lang) },
      };
    },
    fileName: (ctx) =>
      joined([ctx.tx(kind.title), ctx.v("number"), ctx.v("client")], " - "),
    build(ctx) {
      const taxPercent = parseAmount(ctx.v("tax"));
      const t = totals(ctx.list("items"), taxPercent);
      const taxLabel = `${ctx.v("taxName") || ctx.tx(L("Impuesto", "Tax"))} (${qtyText(taxPercent, ctx.lang)} %)`;
      const meta = (label: Localized, value: string): Block[] =>
        value
          ? [
              {
                type: "row",
                gap: 6,
                cells: [
                  {
                    blocks: [
                      text(ctx.tx(label), {
                        align: "right",
                        color: MUTED,
                        size: 9.5,
                      }),
                    ],
                  },
                  {
                    width: 0.5,
                    blocks: [text(value, { align: "right", size: 9.5 })],
                  },
                ],
              },
            ]
          : [];
      const head: Cell[] = [
        {
          blocks: [
            text(ctx.v("business"), {
              role: "heading",
              variant: "Bold",
              size: 16,
              color: ctx.style.accent,
            }),
            ...[
              ctx.v("businessId"),
              ctx.v("address"),
              joined([ctx.v("phone"), ctx.v("email")]),
            ]
              .filter(Boolean)
              .map((l) => text(l, { size: 9.5, color: MUTED })),
          ],
        },
        {
          width: 0.42,
          blocks: [
            text(ctx.tx(kind.title).toLocaleUpperCase(ctx.lang), {
              role: "heading",
              variant: "Bold",
              size: 24,
              color: ctx.style.accent,
              align: "right",
              after: 4,
            }),
            ...meta(L("N.º", "No."), ctx.v("number")),
            ...meta(L("Fecha", "Date"), ctx.date(ctx.v("date"))),
            ...meta(kind.untilLabel, ctx.date(ctx.v("until"))),
          ],
        },
      ];
      return {
        title: joined([ctx.tx(kind.title), ctx.v("number")], " "),
        blocks: [
          { type: "row", cells: head },
          {
            type: "box",
            before: 18,
            fill: tint(ctx.style.accent, 0.93),
            padding: 10,
            blocks: [
              text(
                ctx.tx(L("Cliente", "Bill to")).toLocaleUpperCase(ctx.lang),
                { size: 8.5, variant: "Bold", color: ctx.style.accent },
              ),
              text(ctx.v("client"), { variant: "Bold", size: 11 }),
              ...[
                ctx.v("clientId"),
                ctx.v("clientAddress"),
                ctx.v("clientEmail"),
              ]
                .filter(Boolean)
                .map((l) => text(l, { size: 9.5 })),
            ],
          },
          itemsTable(ctx, t),
          totalsBox(ctx, t, taxLabel),
          text(
            `${ctx.tx(L("Son", "Amount in words"))}: ${capitalize(ctx.amountInWords(t.total))}.`,
            { before: 10, size: 9.5, color: MUTED, variant: "Italic" },
          ),
          ...(ctx.v("notes")
            ? [
                text(ctx.tx(kind.notesLabel), {
                  variant: "Bold",
                  before: 14,
                  after: 2,
                }),
                ...paragraphs(ctx.v("notes"), 4),
              ]
            : []),
        ],
      };
    },
  };
}

export const invoice = invoiceLike({
  id: "invoice",
  name: L("Factura simple", "Simple invoice"),
  description: L(
    "Factura con conceptos, impuesto y total.",
    "Invoice with items, tax and total.",
  ),
  title: L("Factura", "Invoice"),
  untilLabel: L("Vence", "Due date"),
  notesLabel: L("Forma de pago y notas", "Payment details and notes"),
  sampleNotes: L(
    "Transferencia a la cuenta de ahorros Bancolombia N.º 123-456789-01 a nombre de Estudio Creativo Luna.\nGracias por tu confianza.",
    "Bank transfer to account 123456789 (routing 021000021), Luna Creative Studio.\nThank you for your business.",
  ),
  notice: NOT_E_INVOICE,
});

export const quote = invoiceLike({
  id: "quote",
  name: L("Cotización", "Quote"),
  description: L(
    "Presupuesto con conceptos, validez y condiciones.",
    "Estimate with items, validity and terms.",
  ),
  title: L("Cotización", "Quote"),
  untilLabel: L("Válida hasta", "Valid until"),
  notesLabel: L("Condiciones", "Terms"),
  sampleNotes: L(
    "50 % de anticipo para iniciar y 50 % a la entrega.\nTiempo de entrega: 3 semanas desde la aprobación.",
    "50% deposit to start and 50% on delivery.\nDelivery: 3 weeks from approval.",
  ),
});

// Payment request (cuenta de cobro) --------------------------------------------

export const paymentRequest: Template = {
  id: "payment-request",
  category: "billing",
  name: L("Cuenta de cobro", "Payment request"),
  description: L(
    "Para cobrar honorarios o servicios como persona natural.",
    "To bill fees or services as an individual.",
  ),
  notice: NOT_E_INVOICE,
  fields: [
    field("number", "text", "Número", "Number"),
    field("city", "text", "Ciudad", "City"),
    field("date", "date", "Fecha", "Date"),
    field(
      "client",
      "text",
      "Cliente (empresa o persona)",
      "Client (company or person)",
    ),
    field("clientId", "text", "NIT o documento del cliente", "Client tax ID"),
    field("name", "text", "Tu nombre", "Your name"),
    field(
      "idNumber",
      "text",
      "Tu documento (C.C., DNI…)",
      "Your ID or tax number",
    ),
    field("phone", "tel", "Teléfono", "Phone"),
    field("email", "email", "Correo", "Email"),
    field("currency", "currency", "Moneda", "Currency"),
    field("payment", "multiline", "Datos para el pago", "Payment details"),
    field("notes", "multiline", "Observaciones", "Notes"),
  ],
  lists: [itemsList],
  sample(lang) {
    return lang === "es"
      ? {
          fields: {
            number: "001",
            city: "Medellín",
            date: todayIso(),
            client: "Café La Montaña S.A.S.",
            clientId: "NIT 900.876.543-2",
            name: "Carlos Andrés Gómez",
            idNumber: "C.C. 1.020.304.050",
            phone: "+57 300 765 4321",
            email: "carlos.gomez@ejemplo.com",
            currency: "",
            payment:
              "Cuenta de ahorros Bancolombia N.º 123-456789-01\nA nombre de Carlos Andrés Gómez, C.C. 1.020.304.050",
            notes: "Declaro que no soy responsable de IVA.",
          },
          lists: {
            items: [
              {
                description: "Desarrollo del sitio web corporativo (octubre)",
                qty: "1",
                price: "2500000",
              },
              {
                description: "Soporte técnico (horas)",
                qty: "6",
                price: "80000",
              },
            ],
          },
        }
      : {
          fields: {
            number: "001",
            city: "Austin, TX",
            date: todayIso(),
            client: "Mountain Coffee LLC",
            clientId: "EIN 98-7654321",
            name: "Charlie Brooks",
            idNumber: "SSN ending 1234",
            phone: "+1 512 555 0177",
            email: "charlie.brooks@example.com",
            currency: "",
            payment:
              "Bank transfer to account 987654321 (routing 021000021)\nAccount holder: Charlie Brooks",
            notes: "",
          },
          lists: {
            items: [
              {
                description: "Company website development (October)",
                qty: "1",
                price: "2500",
              },
              {
                description: "Technical support (hours)",
                qty: "6",
                price: "80",
              },
            ],
          },
        };
  },
  fileName: (ctx) =>
    joined(
      [
        ctx.tx(L("Cuenta de cobro", "Payment request")),
        ctx.v("number"),
        ctx.v("name"),
      ],
      " - ",
    ),
  build(ctx) {
    const t = totals(ctx.list("items"));
    const label = (value: Localized): Block =>
      text(ctx.tx(value).toLocaleUpperCase(ctx.lang), {
        variant: "Bold",
        size: 9.5,
        color: ctx.style.accent,
        before: 14,
        after: 3,
        keepWithNext: true,
      });
    const number = ctx.v("number");
    return {
      title: joined(
        [ctx.tx(L("Cuenta de cobro", "Payment request")), number],
        " ",
      ),
      blocks: [
        text(
          joined(
            [
              ctx
                .tx(L("Cuenta de cobro", "Payment request"))
                .toLocaleUpperCase(ctx.lang),
              number ? `${ctx.tx(L("N.º", "No."))} ${number}` : "",
            ],
            " ",
          ),
          {
            role: "heading",
            variant: "Bold",
            size: 20,
            color: ctx.style.accent,
            align: "center",
          },
        ),
        text(joined([ctx.v("city"), ctx.date(ctx.v("date"))], ", "), {
          align: "center",
          color: MUTED,
          after: 14,
        }),
        {
          type: "box",
          fill: tint(ctx.style.accent, 0.93),
          padding: 10,
          blocks: [
            text(ctx.v("client"), { variant: "Bold", size: 12 }),
            ...(ctx.v("clientId") ? [text(ctx.v("clientId"))] : []),
          ],
        },
        label(L("Debe a", "Owes")),
        text(ctx.v("name"), { variant: "Bold", size: 11 }),
        ...(ctx.v("idNumber") ? [text(ctx.v("idNumber"))] : []),
        label(L("La suma de", "The amount of")),
        text(
          `${capitalize(ctx.amountInWords(t.total))} (${ctx.money(t.total)}).`,
          { size: 11 },
        ),
        label(L("Por concepto de", "For")),
        itemsTable(ctx, t),
        totalsBox(ctx, t, ""),
        ...(ctx.v("payment")
          ? [
              label(L("Datos para el pago", "Payment details")),
              ...ctx
                .v("payment")
                .split("\n")
                .map((l) => text(l)),
            ]
          : []),
        ...(ctx.v("notes")
          ? [text(ctx.v("notes"), { before: 12, color: MUTED, size: 9.5 })]
          : []),
        signature(
          [
            ctx.v("name"),
            ctx.v("idNumber"),
            joined([ctx.v("phone"), ctx.v("email")]),
          ],
          { before: 50 },
        ),
      ],
    };
  },
};

// Receipt -----------------------------------------------------------------------

export const receipt: Template = {
  id: "receipt",
  category: "billing",
  name: L("Recibo de pago", "Payment receipt"),
  description: L(
    "Constancia de que recibiste un pago.",
    "Proof that you received a payment.",
  ),
  fields: [
    field("number", "text", "Número", "Number"),
    field("city", "text", "Ciudad", "City"),
    field("date", "date", "Fecha", "Date"),
    field("payer", "text", "Recibí de", "Received from"),
    field("payerId", "text", "Documento de quien paga", "Payer ID"),
    field("amount", "money", "Valor", "Amount"),
    field("currency", "currency", "Moneda", "Currency"),
    field("concept", "multiline", "Por concepto de", "For"),
    field("method", "text", "Forma de pago", "Payment method"),
    field("name", "text", "Quien recibe", "Received by"),
    field("idNumber", "text", "Documento de quien recibe", "Receiver ID"),
  ],
  sample(lang) {
    return lang === "es"
      ? {
          fields: {
            number: "0001",
            city: "Medellín",
            date: todayIso(),
            payer: "Laura Restrepo",
            payerId: "C.C. 43.210.987",
            amount: "1500000",
            currency: "",
            concept:
              "Canon de arrendamiento del apartamento 302, mes de octubre.",
            method: "Transferencia bancaria",
            name: "Jorge Mejía",
            idNumber: "C.C. 71.234.567",
          },
          lists: {},
        }
      : {
          fields: {
            number: "0001",
            city: "Austin, TX",
            date: todayIso(),
            payer: "Laura Reed",
            payerId: "",
            amount: "1500",
            currency: "",
            concept: "Rent for apartment 302, October.",
            method: "Bank transfer",
            name: "George Miller",
            idNumber: "",
          },
          lists: {},
        };
  },
  fileName: (ctx) =>
    joined(
      [ctx.tx(L("Recibo", "Receipt")), ctx.v("number"), ctx.v("payer")],
      " - ",
    ),
  build(ctx) {
    const amount = parseAmount(ctx.v("amount"));
    const line = (label: Localized, value: string): Block[] =>
      value
        ? [
            {
              type: "row",
              gap: 8,
              before: 6,
              cells: [
                {
                  width: 0.24,
                  blocks: [
                    text(ctx.tx(label), {
                      variant: "Bold",
                      color: ctx.style.accent,
                    }),
                  ],
                },
                { blocks: [text(value)] },
              ],
            },
          ]
        : [];
    return {
      title: joined([ctx.tx(L("Recibo", "Receipt")), ctx.v("number")], " "),
      blocks: [
        {
          type: "box",
          stroke: ctx.style.accent,
          padding: 16,
          blocks: [
            {
              type: "row",
              cells: [
                {
                  blocks: [
                    text(
                      ctx
                        .tx(L("Recibo de pago", "Payment receipt"))
                        .toLocaleUpperCase(ctx.lang),
                      {
                        role: "heading",
                        variant: "Bold",
                        size: 18,
                        color: ctx.style.accent,
                      },
                    ),
                    text(
                      joined([
                        ctx.v("number")
                          ? `${ctx.tx(L("N.º", "No."))} ${ctx.v("number")}`
                          : "",
                        joined([ctx.v("city"), ctx.date(ctx.v("date"))], ", "),
                      ]),
                      { color: MUTED },
                    ),
                  ],
                },
                {
                  width: 0.38,
                  blocks: [
                    {
                      type: "box",
                      fill: tint(ctx.style.accent, 0.9),
                      padding: 8,
                      blocks: [
                        text(ctx.money(amount), {
                          variant: "Bold",
                          size: 16,
                          align: "center",
                        }),
                      ],
                    },
                  ],
                },
              ],
            },
            { type: "rule", color: LINE, before: 10, after: 4 },
            ...line(
              L("Recibí de", "Received from"),
              joined([ctx.v("payer"), ctx.v("payerId")], ", "),
            ),
            ...line(
              L("La suma de", "The sum of"),
              `${capitalize(ctx.amountInWords(amount))}.`,
            ),
            ...line(L("Por concepto de", "For"), ctx.v("concept")),
            ...line(L("Forma de pago", "Payment method"), ctx.v("method")),
            signature([ctx.v("name"), ctx.v("idNumber")], { before: 46 }),
          ],
        },
      ],
    };
  },
};

export const BILLING = [paymentRequest, invoice, quote, receipt];
