// Letters and certificates (spec 021): resignation, employment certificate,
// authorization and no-debt certificate ("paz y salvo"). The main paragraph is
// written from the fields, so changing a name changes it everywhere.
import { parseAmount, todayIso } from "../format";
import type { Block } from "../layout";
import type { BuildContext, Localized, Template } from "../types";
import { L, MUTED, field, joined, paragraphs, signature, text } from "./common";

const ORIENTATIVE = L(
  "Es un modelo orientativo. Algunas entidades piden un formato propio o firma autenticada ante notario.",
  "This is a sample. Some organizations require their own form or a notarized signature.",
);

/** ", identificado(a) con C.C. 123" when there is an ID. */
const withId = (ctx: BuildContext, id: string) =>
  id ? ctx.tx(L(`, identificado(a) con ${id},`, ` (${id})`)) : "";

const placeDate = (ctx: BuildContext) =>
  text(joined([ctx.v("city"), ctx.date(ctx.v("date"))], ", "), { after: 18 });

const title = (ctx: BuildContext, value: Localized): Block =>
  text(ctx.tx(value).toLocaleUpperCase(ctx.lang), {
    role: "heading",
    variant: "Bold",
    size: 16,
    color: ctx.style.accent,
    align: "center",
    after: 18,
  });

/** An organization's name at the top, with a rule in the accent color. */
const letterhead = (ctx: BuildContext, name: string, id: string): Block[] =>
  name
    ? [
        text(name, {
          role: "heading",
          variant: "Bold",
          size: 15,
          color: ctx.style.accent,
        }),
        ...(id ? [text(id, { size: 9.5, color: MUTED })] : []),
        {
          type: "rule",
          color: ctx.style.accent,
          thickness: 1.2,
          before: 6,
          after: 24,
        },
      ]
    : [];

const body = (value: string): Block => text(value, { leading: 1.5, after: 10 });

export const resignation: Template = {
  id: "resignation",
  category: "letters",
  name: L("Carta de renuncia", "Resignation letter"),
  description: L(
    "Renuncia voluntaria con fecha de salida.",
    "Voluntary resignation with your last day.",
  ),
  fields: [
    field("name", "text", "Tu nombre", "Your name"),
    field("idNumber", "text", "Tu documento", "Your ID"),
    field("position", "text", "Tu cargo", "Your position"),
    field("company", "text", "Empresa", "Company"),
    field("recipient", "text", "Dirigida a", "Addressed to"),
    field(
      "recipientRole",
      "text",
      "Cargo de quien la recibe",
      "Their position",
    ),
    field("city", "text", "Ciudad", "City"),
    field("date", "date", "Fecha", "Date"),
    field("lastDay", "date", "Último día de trabajo", "Last working day"),
    field("message", "multiline", "Mensaje (opcional)", "Message (optional)"),
  ],
  sample(lang) {
    const last = new Date();
    last.setDate(last.getDate() + 15);
    return lang === "es"
      ? {
          fields: {
            name: "Ana María Torres",
            idNumber: "C.C. 1.037.654.321",
            position: "Diseñadora de producto",
            company: "Finanzas Claras S.A.S.",
            recipient: "Juliana Ospina",
            recipientRole: "Directora de Talento Humano",
            city: "Medellín",
            date: todayIso(),
            lastDay: todayIso(last),
            message:
              "Agradezco sinceramente la oportunidad de haber hecho parte de este equipo y todo lo aprendido. Quedo atenta para hacer una entrega ordenada de mis funciones.",
          },
          lists: {},
        }
      : {
          fields: {
            name: "Jordan Smith",
            idNumber: "",
            position: "Product designer",
            company: "Clear Finance Inc.",
            recipient: "Julia Owens",
            recipientRole: "HR Director",
            city: "Austin, TX",
            date: todayIso(),
            lastDay: todayIso(last),
            message:
              "Thank you for the opportunity to be part of this team and for everything I have learned. I am happy to help with a smooth handover of my work.",
          },
          lists: {},
        };
  },
  fileName: (ctx) =>
    joined(
      [ctx.tx(L("Carta de renuncia", "Resignation letter")), ctx.v("name")],
      " - ",
    ),
  build(ctx) {
    const main = ctx.tx(
      L(
        `Por medio de la presente, yo, ${ctx.v("name")}${withId(ctx, ctx.v("idNumber"))} presento mi renuncia voluntaria al cargo de ${ctx.v("position")} que desempeño en ${ctx.v("company")}, con efecto a partir del ${ctx.date(ctx.v("lastDay"))}.`,
        `Please accept this letter as formal notice of my resignation from my position as ${ctx.v("position")} at ${ctx.v("company")}, effective ${ctx.date(ctx.v("lastDay"))}.`,
      ),
    );
    return {
      title: joined(
        [ctx.tx(L("Carta de renuncia", "Resignation letter")), ctx.v("name")],
        " - ",
      ),
      blocks: [
        placeDate(ctx),
        ...[ctx.v("recipient"), ctx.v("recipientRole"), ctx.v("company")]
          .filter(Boolean)
          .map((l, i) => text(l, { variant: i === 0 ? "Bold" : "Regular" })),
        text(
          `${ctx.tx(L("Asunto", "Subject"))}: ${ctx.tx(L("Renuncia voluntaria", "Resignation"))}`,
          { variant: "Bold", before: 16, after: 14 },
        ),
        text(
          ctx.tx(L("Cordial saludo:", "Dear")) +
            (ctx.lang === "en" ? ` ${ctx.v("recipient")},` : ""),
          { after: 10 },
        ),
        body(main),
        ...paragraphs(ctx.v("message"), 10).map((b) => ({
          ...b,
          leading: 1.5,
        })),
        text(ctx.tx(L("Atentamente,", "Sincerely,")), { before: 6 }),
        signature([ctx.v("name"), ctx.v("idNumber")]),
      ],
    };
  },
};

export const employmentCertificate: Template = {
  id: "employment-certificate",
  category: "letters",
  name: L("Certificado laboral", "Employment verification letter"),
  description: L(
    "La empresa certifica el cargo y la antigüedad de una persona.",
    "The employer confirms a person's job and start date.",
  ),
  fields: [
    field("company", "text", "Empresa", "Company"),
    field(
      "companyId",
      "text",
      "NIT o identificación de la empresa",
      "Company tax ID",
    ),
    field("employee", "text", "Nombre del trabajador", "Employee name"),
    field("employeeId", "text", "Documento del trabajador", "Employee ID"),
    field("position", "text", "Cargo", "Position"),
    field("start", "date", "Fecha de ingreso", "Start date"),
    field("contract", "text", "Tipo de contrato", "Employment type"),
    field(
      "salary",
      "money",
      "Salario mensual (vacío: no se muestra)",
      "Monthly salary (empty: not shown)",
    ),
    field("currency", "currency", "Moneda", "Currency"),
    field("city", "text", "Ciudad", "City"),
    field("date", "date", "Fecha", "Date"),
    field("signer", "text", "Quien firma", "Signed by"),
    field("signerRole", "text", "Cargo de quien firma", "Their position"),
    field(
      "contact",
      "text",
      "Teléfono o correo para verificar",
      "Phone or email to verify",
    ),
  ],
  sample(lang) {
    return lang === "es"
      ? {
          fields: {
            company: "Finanzas Claras S.A.S.",
            companyId: "NIT 900.123.456-7",
            employee: "Carlos Andrés Gómez",
            employeeId: "C.C. 1.020.304.050",
            position: "Analista de datos",
            start: "2021-03-01",
            contract: "a término indefinido",
            salary: "4500000",
            currency: "",
            city: "Medellín",
            date: todayIso(),
            signer: "Juliana Ospina",
            signerRole: "Directora de Talento Humano",
            contact: "talento@finanzasclaras.com · +57 604 555 9876",
          },
          lists: {},
        }
      : {
          fields: {
            company: "Clear Finance Inc.",
            companyId: "EIN 12-3456789",
            employee: "Charlie Brooks",
            employeeId: "",
            position: "Data analyst",
            start: "2021-03-01",
            contract: "full-time, permanent",
            salary: "",
            currency: "",
            city: "Austin, TX",
            date: todayIso(),
            signer: "Julia Owens",
            signerRole: "HR Director",
            contact: "hr@clearfinance.com · +1 512 555 0198",
          },
          lists: {},
        };
  },
  fileName: (ctx) =>
    joined(
      [
        ctx.tx(L("Certificado laboral", "Employment letter")),
        ctx.v("employee"),
      ],
      " - ",
    ),
  build(ctx) {
    const salary = parseAmount(ctx.v("salary"));
    const pay = salary
      ? ctx.tx(
          L(
            ` y un salario mensual de ${ctx.money(salary)} (${ctx.amountInWords(salary)})`,
            `, with a monthly salary of ${ctx.money(salary)}`,
          ),
        )
      : "";
    const contract = ctx.v("contract");
    const main = ctx.tx(
      L(
        `${ctx.v("company")}${ctx.v("companyId") ? `, identificada con ${ctx.v("companyId")},` : ""} certifica que ${ctx.v("employee")}${withId(ctx, ctx.v("employeeId"))} labora en esta empresa desde el ${ctx.date(ctx.v("start"))}, desempeñando el cargo de ${ctx.v("position")}${contract ? `, con contrato ${contract}` : ""}${pay}.`,
        `This letter certifies that ${ctx.v("employee")}${withId(ctx, ctx.v("employeeId"))} has been employed by ${ctx.v("company")} since ${ctx.date(ctx.v("start"))} as ${ctx.v("position")}${contract ? `, ${contract}` : ""}${pay}.`,
      ),
    );
    const issued = ctx.tx(
      L(
        `La presente certificación se expide a solicitud del interesado en ${ctx.v("city")}, el ${ctx.date(ctx.v("date"))}.`,
        `This letter is issued at the employee's request in ${ctx.v("city")} on ${ctx.date(ctx.v("date"))}.`,
      ),
    );
    return {
      title: joined(
        [
          ctx.tx(L("Certificado laboral", "Employment letter")),
          ctx.v("employee"),
        ],
        " - ",
      ),
      blocks: [
        ...letterhead(ctx, ctx.v("company"), ctx.v("companyId")),
        title(ctx, L("Certificado laboral", "Employment verification")),
        text(ctx.tx(L("A quien pueda interesar:", "To whom it may concern:")), {
          variant: "Bold",
          after: 12,
        }),
        body(main),
        body(issued),
        ...(ctx.v("contact")
          ? [
              text(
                `${ctx.tx(L("Para verificar esta información", "To verify this information"))}: ${ctx.v("contact")}.`,
                { color: MUTED, size: 9.5 },
              ),
            ]
          : []),
        signature([ctx.v("signer"), ctx.v("signerRole"), ctx.v("company")], {
          before: 56,
        }),
      ],
    };
  },
};

export const authorization: Template = {
  id: "authorization",
  category: "letters",
  name: L("Carta de autorización", "Authorization letter"),
  description: L(
    "Autoriza a otra persona a hacer un trámite por ti.",
    "Authorize someone to run an errand on your behalf.",
  ),
  notice: ORIENTATIVE,
  fields: [
    field("name", "text", "Tu nombre", "Your name"),
    field("idNumber", "text", "Tu documento", "Your ID"),
    field("delegate", "text", "Persona autorizada", "Authorized person"),
    field(
      "delegateId",
      "text",
      "Documento de la persona autorizada",
      "Their ID",
    ),
    field(
      "purpose",
      "multiline",
      "Qué puede hacer en tu nombre",
      "What they may do on your behalf",
    ),
    field("entity", "text", "Ante quién (entidad)", "Before (organization)"),
    field("city", "text", "Ciudad", "City"),
    field("date", "date", "Fecha", "Date"),
    field("phone", "tel", "Tu teléfono", "Your phone"),
  ],
  sample(lang) {
    return lang === "es"
      ? {
          fields: {
            name: "Laura Restrepo",
            idNumber: "C.C. 43.210.987",
            delegate: "Andrés Restrepo",
            delegateId: "C.C. 1.152.345.678",
            purpose:
              "reclame mi tarjeta de crédito y firme el acta de entrega correspondiente",
            entity: "Banco de Bogotá, oficina El Poblado",
            city: "Medellín",
            date: todayIso(),
            phone: "+57 310 555 1122",
          },
          lists: {},
        }
      : {
          fields: {
            name: "Laura Reed",
            idNumber: "Driver's license D1234567",
            delegate: "Andrew Reed",
            delegateId: "Driver's license D7654321",
            purpose: "pick up my new credit card and sign the delivery receipt",
            entity: "First National Bank, Downtown branch",
            city: "Austin, TX",
            date: todayIso(),
            phone: "+1 512 555 0111",
          },
          lists: {},
        };
  },
  fileName: (ctx) =>
    joined(
      [ctx.tx(L("Autorización", "Authorization")), ctx.v("delegate")],
      " - ",
    ),
  build(ctx) {
    const entity = ctx.v("entity");
    const main = ctx.tx(
      L(
        `Yo, ${ctx.v("name")}${withId(ctx, ctx.v("idNumber"))} autorizo a ${ctx.v("delegate")}${withId(ctx, ctx.v("delegateId"))} para que en mi nombre ${ctx.v("purpose")}${entity ? ` ante ${entity}` : ""}.`,
        `I, ${ctx.v("name")}${withId(ctx, ctx.v("idNumber"))}, authorize ${ctx.v("delegate")}${withId(ctx, ctx.v("delegateId"))} to ${ctx.v("purpose")} on my behalf${entity ? ` at ${entity}` : ""}.`,
      ),
    );
    return {
      title: joined(
        [ctx.tx(L("Autorización", "Authorization")), ctx.v("delegate")],
        " - ",
      ),
      blocks: [
        placeDate(ctx),
        ...(entity
          ? [
              text(ctx.tx(L("Señores", "To")), { variant: "Bold" }),
              text(entity, { after: 14 }),
            ]
          : []),
        title(ctx, L("Autorización", "Authorization letter")),
        body(main),
        body(
          ctx.tx(
            L(
              "Agradezco la atención prestada.",
              "Thank you for your attention.",
            ),
          ),
        ),
        {
          type: "row",
          gap: 36,
          cells: [
            {
              blocks: [
                signature([ctx.v("name"), ctx.v("idNumber"), ctx.v("phone")], {
                  width: 1,
                  before: 56,
                }),
              ],
            },
            {
              blocks: [
                signature(
                  [
                    ctx.v("delegate"),
                    ctx.v("delegateId"),
                    ctx.tx(L("Persona autorizada", "Authorized person")),
                  ],
                  { width: 1, before: 56 },
                ),
              ],
            },
          ],
        },
      ],
    };
  },
};

export const noDebt: Template = {
  id: "no-debt",
  category: "letters",
  name: L("Paz y salvo", "No-debt certificate"),
  description: L(
    "Constancia de que una persona no tiene deudas pendientes.",
    "States that a person has no outstanding balance.",
  ),
  fields: [
    field(
      "issuer",
      "text",
      "Quien expide (empresa o persona)",
      "Issued by (company or person)",
    ),
    field("issuerId", "text", "Documento o NIT de quien expide", "Issuer ID"),
    field(
      "debtor",
      "text",
      "Persona que está a paz y salvo",
      "Person with no balance",
    ),
    field("debtorId", "text", "Documento de esa persona", "Their ID"),
    field("concept", "multiline", "Por concepto de", "For"),
    field("city", "text", "Ciudad", "City"),
    field("date", "date", "Fecha", "Date"),
    field("signer", "text", "Quien firma", "Signed by"),
    field("signerRole", "text", "Cargo de quien firma", "Their position"),
  ],
  sample(lang) {
    return lang === "es"
      ? {
          fields: {
            issuer: "Inmobiliaria Los Andes S.A.S.",
            issuerId: "NIT 811.222.333-4",
            debtor: "Laura Restrepo",
            debtorId: "C.C. 43.210.987",
            concept:
              "cánones de arrendamiento, servicios públicos y administración del apartamento 302 del edificio Mirador",
            city: "Medellín",
            date: todayIso(),
            signer: "Jorge Mejía",
            signerRole: "Gerente",
          },
          lists: {},
        }
      : {
          fields: {
            issuer: "Andes Property Management LLC",
            issuerId: "EIN 45-6789012",
            debtor: "Laura Reed",
            debtorId: "",
            concept:
              "rent, utilities and fees for apartment 302 at Mirador Building",
            city: "Austin, TX",
            date: todayIso(),
            signer: "George Miller",
            signerRole: "Manager",
          },
          lists: {},
        };
  },
  fileName: (ctx) =>
    joined(
      [ctx.tx(L("Paz y salvo", "No-debt certificate")), ctx.v("debtor")],
      " - ",
    ),
  build(ctx) {
    const main = ctx.tx(
      L(
        `${ctx.v("issuer")}${withId(ctx, ctx.v("issuerId"))} hace constar que ${ctx.v("debtor")}${withId(ctx, ctx.v("debtorId"))} se encuentra a paz y salvo por concepto de ${ctx.v("concept")}, a la fecha de expedición de este documento.`,
        `${ctx.v("issuer")}${withId(ctx, ctx.v("issuerId"))} certifies that ${ctx.v("debtor")}${withId(ctx, ctx.v("debtorId"))} has no outstanding balance for ${ctx.v("concept")} as of the date of this document.`,
      ),
    );
    return {
      title: joined(
        [ctx.tx(L("Paz y salvo", "No-debt certificate")), ctx.v("debtor")],
        " - ",
      ),
      blocks: [
        ...letterhead(ctx, ctx.v("issuer"), ctx.v("issuerId")),
        title(ctx, L("Paz y salvo", "No-debt certificate")),
        body(main),
        body(
          ctx.tx(
            L(
              `Se expide en ${ctx.v("city")}, el ${ctx.date(ctx.v("date"))}.`,
              `Issued in ${ctx.v("city")} on ${ctx.date(ctx.v("date"))}.`,
            ),
          ),
        ),
        signature([ctx.v("signer"), ctx.v("signerRole"), ctx.v("issuer")], {
          before: 56,
        }),
      ],
    };
  },
};

export const LETTERS = [
  resignation,
  employmentCertificate,
  authorization,
  noDebt,
];
