// Job templates (spec 021): three CVs and a cover letter.
import type { Lang } from "../../i18n/core";
import { todayIso } from "../format";
import type { Block } from "../layout";
import type { BuildContext, ListDef, Template, Values } from "../types";
import {
  L,
  MUTED,
  bullets,
  field,
  joined,
  paragraphs,
  period,
  section,
  signature,
  text,
  tint,
} from "./common";

const cvFields = [
  field("name", "text", "Nombre completo", "Full name"),
  field("headline", "text", "Cargo o profesión", "Job title"),
  field("email", "email", "Correo", "Email"),
  field("phone", "tel", "Teléfono", "Phone"),
  field("city", "text", "Ciudad", "City"),
  field("web", "text", "Web o LinkedIn", "Website or LinkedIn"),
  field("profile", "multiline", "Perfil", "Profile"),
  field(
    "skills",
    "multiline",
    "Habilidades (una por línea)",
    "Skills (one per line)",
  ),
  field(
    "languages",
    "multiline",
    "Idiomas (uno por línea)",
    "Languages (one per line)",
  ),
];

const cvLists: ListDef[] = [
  {
    key: "jobs",
    label: L("Experiencia", "Experience"),
    addLabel: L("Añadir experiencia", "Add experience"),
    fields: [
      field("role", "text", "Cargo", "Role"),
      field("company", "text", "Empresa", "Company"),
      field("place", "text", "Lugar", "Location"),
      field("from", "text", "Desde", "From"),
      field("to", "text", "Hasta (vacío: actualidad)", "To (empty: present)"),
      field(
        "details",
        "multiline",
        "Logros (uno por línea)",
        "Achievements (one per line)",
      ),
    ],
  },
  {
    key: "studies",
    label: L("Estudios", "Education"),
    addLabel: L("Añadir estudios", "Add education"),
    fields: [
      field("degree", "text", "Título", "Degree"),
      field("school", "text", "Institución", "School"),
      field("from", "text", "Desde", "From"),
      field("to", "text", "Hasta", "To"),
      field("details", "multiline", "Detalle", "Details"),
    ],
  },
];

function cvSample(lang: Lang): Values {
  if (lang === "es")
    return {
      fields: {
        name: "Ana María Torres",
        headline: "Diseñadora de producto",
        email: "ana.torres@ejemplo.com",
        phone: "+57 300 123 4567",
        city: "Medellín, Colombia",
        web: "linkedin.com/in/anatorres",
        profile:
          "Diseñadora de producto con 6 años de experiencia en apps móviles y web. Me gusta convertir problemas complejos en experiencias simples, trabajando de cerca con desarrollo y negocio.",
        skills:
          "Investigación con usuarios\nPrototipado en Figma\nSistemas de diseño\nAccesibilidad (WCAG)\nHTML y CSS",
        languages: "Español (nativo)\nInglés (avanzado, C1)",
      },
      lists: {
        jobs: [
          {
            role: "Diseñadora de producto sénior",
            company: "Finanzas Claras S.A.S.",
            place: "Medellín",
            from: "2022",
            to: "",
            details:
              "Rediseñé el registro de la app y subí la conversión un 18 %\nCreé el sistema de diseño usado por 4 equipos\nLideré pruebas con 60 usuarios al trimestre",
          },
          {
            role: "Diseñadora UX/UI",
            company: "Agencia Puntual",
            place: "Bogotá",
            from: "2019",
            to: "2022",
            details:
              "Diseñé sitios y apps para 12 clientes de retail y salud\nIntroduje pruebas de usabilidad en cada proyecto",
          },
        ],
        studies: [
          {
            degree: "Diseño Industrial",
            school: "Universidad Nacional de Colombia",
            from: "2013",
            to: "2018",
            details: "",
          },
        ],
      },
    };
  return {
    fields: {
      name: "Jordan Smith",
      headline: "Product designer",
      email: "jordan.smith@example.com",
      phone: "+1 555 010 2030",
      city: "Austin, TX",
      web: "linkedin.com/in/jordansmith",
      profile:
        "Product designer with 6 years of experience in mobile and web apps. I enjoy turning complex problems into simple experiences, working closely with engineering and business.",
      skills:
        "User research\nFigma prototyping\nDesign systems\nAccessibility (WCAG)\nHTML and CSS",
      languages: "English (native)\nSpanish (advanced, C1)",
    },
    lists: {
      jobs: [
        {
          role: "Senior product designer",
          company: "Clear Finance Inc.",
          place: "Austin",
          from: "2022",
          to: "",
          details:
            "Redesigned app sign-up, raising conversion by 18%\nBuilt the design system used by 4 teams\nRan usability tests with 60 users per quarter",
        },
        {
          role: "UX/UI designer",
          company: "Punctual Agency",
          place: "Dallas",
          from: "2019",
          to: "2022",
          details:
            "Designed sites and apps for 12 retail and health clients\nIntroduced usability testing on every project",
        },
      ],
      studies: [
        {
          degree: "B.A. in Industrial Design",
          school: "University of Texas",
          from: "2013",
          to: "2018",
          details: "",
        },
      ],
    },
  };
}

const T = {
  profile: L("Perfil", "Profile"),
  experience: L("Experiencia", "Experience"),
  education: L("Estudios", "Education"),
  skills: L("Habilidades", "Skills"),
  languages: L("Idiomas", "Languages"),
  contact: L("Contacto", "Contact"),
};

const lines = (value: string) =>
  value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Job and study entries: title and dates on one line, then the rest. */
function entries(ctx: BuildContext, plain = false): Block[] {
  const titleColor = plain ? undefined : "#1F2328";
  const entry = (
    title: string,
    sub: string,
    when: string,
    details: string,
  ): Block => ({
    type: "group",
    after: 8,
    blocks: [
      {
        type: "row",
        cells: [
          {
            width: 0.72,
            blocks: [
              text(title, {
                variant: "Bold",
                size: 10.5,
                color: titleColor,
                role: "heading",
              }),
            ],
          },
          { blocks: [text(when, { align: "right", color: MUTED, size: 9.5 })] },
        ],
      },
      ...(sub
        ? [
            text(sub, {
              color: plain ? undefined : MUTED,
              variant: "Italic",
              after: 2,
            }),
          ]
        : []),
      ...bullets(details),
    ],
  });
  const jobs = ctx.list("jobs");
  const studies = ctx.list("studies");
  return [
    ...(jobs.length ? sectionFor(ctx, T.experience, plain) : []),
    ...jobs.map((j) =>
      entry(
        j.role ?? "",
        joined([j.company ?? "", j.place ?? ""], ", "),
        period(ctx, j.from ?? "", j.to ?? ""),
        j.details ?? "",
      ),
    ),
    ...(studies.length ? sectionFor(ctx, T.education, plain) : []),
    ...studies.map((s) =>
      entry(
        s.degree ?? "",
        s.school ?? "",
        period(ctx, s.from ?? "", s.to ?? ""),
        s.details ?? "",
      ),
    ),
  ];
}

const sectionFor = (
  ctx: BuildContext,
  title: { es: string; en: string },
  plain: boolean,
) => section(ctx, ctx.tx(title), plain ? "#1F2328" : undefined);

const fileName = (kind: { es: string; en: string }) => (ctx: BuildContext) =>
  joined([ctx.tx(kind), ctx.v("name")], " - ");

const CV = L("CV", "Resume");

export const cvClassic: Template = {
  id: "cv-classic",
  category: "jobs",
  name: L("CV clásico", "Classic resume"),
  description: L(
    "Una columna, sobrio y fácil de leer.",
    "One column, sober and easy to read.",
  ),
  photo: true,
  fields: cvFields,
  lists: cvLists,
  sample: cvSample,
  fileName: fileName(CV),
  build(ctx) {
    const header: Block[] = [
      text(ctx.v("name"), {
        role: "heading",
        variant: "Bold",
        size: 24,
        color: ctx.style.accent,
        leading: 1.15,
      }),
      text(ctx.v("headline"), { size: 12.5, color: MUTED, after: 4 }),
      text(
        joined([ctx.v("email"), ctx.v("phone"), ctx.v("city"), ctx.v("web")]),
        { size: 9.5, color: MUTED },
      ),
    ];
    const top: Block = ctx.photo
      ? {
          type: "row",
          cells: [
            { blocks: header },
            {
              width: 0.17,
              blocks: [
                {
                  type: "image",
                  image: "photo",
                  width: 84,
                  height: 84,
                  align: "right",
                },
              ],
            },
          ],
        }
      : { type: "group", blocks: header };
    return {
      title: joined([ctx.tx(CV), ctx.v("name")], " - "),
      blocks: [
        top,
        {
          type: "rule",
          color: ctx.style.accent,
          thickness: 1.5,
          before: 10,
          after: 2,
        },
        ...(ctx.v("profile")
          ? [
              ...section(ctx, ctx.tx(T.profile)),
              ...paragraphs(ctx.v("profile")),
            ]
          : []),
        ...entries(ctx),
        ...(ctx.v("skills")
          ? [
              ...section(ctx, ctx.tx(T.skills)),
              text(lines(ctx.v("skills")).join("  ·  ")),
            ]
          : []),
        ...(ctx.v("languages")
          ? [
              ...section(ctx, ctx.tx(T.languages)),
              text(lines(ctx.v("languages")).join("  ·  ")),
            ]
          : []),
      ],
    };
  },
};

export const cvModern: Template = {
  id: "cv-modern",
  category: "jobs",
  name: L("CV moderno", "Modern resume"),
  description: L(
    "Dos columnas con barra lateral de color.",
    "Two columns with a colored sidebar.",
  ),
  photo: true,
  fields: cvFields,
  lists: cvLists,
  sample: cvSample,
  fileName: fileName(CV),
  build(ctx) {
    const white = "#FFFFFF";
    const soft = tint(ctx.style.accent, 0.75);
    const sideTitle = (title: { es: string; en: string }): Block[] => [
      text(ctx.tx(title).toLocaleUpperCase(ctx.lang), {
        role: "heading",
        variant: "Bold",
        size: 10,
        color: white,
        before: 16,
        after: 3,
        keepWithNext: true,
      }),
      { type: "rule", color: soft, thickness: 0.6, after: 6 },
    ];
    const sideLines = (value: string): Block[] =>
      lines(value).map((l) => text(l, { color: white, size: 9.5, after: 2 }));
    const sidebar: Block[] = [
      ...(ctx.photo
        ? [
            {
              type: "image",
              image: "photo",
              width: 112,
              height: 112,
              align: "center",
              after: 4,
            } as Block,
          ]
        : []),
      ...sideTitle(T.contact),
      ...sideLines(
        [ctx.v("email"), ctx.v("phone"), ctx.v("city"), ctx.v("web")].join(
          "\n",
        ),
      ),
      ...(ctx.v("skills")
        ? [...sideTitle(T.skills), ...sideLines(ctx.v("skills"))]
        : []),
      ...(ctx.v("languages")
        ? [...sideTitle(T.languages), ...sideLines(ctx.v("languages"))]
        : []),
    ];
    return {
      title: joined([ctx.tx(CV), ctx.v("name")], " - "),
      sidebar: { width: 186, fill: ctx.style.accent, blocks: sidebar },
      blocks: [
        text(ctx.v("name"), {
          role: "heading",
          variant: "Bold",
          size: 26,
          color: ctx.style.accent,
          leading: 1.1,
        }),
        text(ctx.v("headline").toLocaleUpperCase(ctx.lang), {
          size: 11,
          color: MUTED,
          after: 6,
        }),
        ...(ctx.v("profile")
          ? [
              ...section(ctx, ctx.tx(T.profile)),
              ...paragraphs(ctx.v("profile")),
            ]
          : []),
        ...entries(ctx),
      ],
    };
  },
};

export const cvAts: Template = {
  id: "cv-ats",
  category: "jobs",
  name: L("CV sencillo (ATS)", "Simple resume (ATS)"),
  description: L(
    "Sin columnas ni adornos: lo leen bien los filtros automáticos de las empresas.",
    "No columns or decoration: easy for applicant tracking systems to read.",
  ),
  fields: cvFields,
  lists: cvLists,
  sample: cvSample,
  fileName: fileName(CV),
  build(ctx) {
    const plainSection = (title: { es: string; en: string }) =>
      sectionFor(ctx, title, true);
    return {
      title: joined([ctx.tx(CV), ctx.v("name")], " - "),
      blocks: [
        text(ctx.v("name"), {
          role: "heading",
          variant: "Bold",
          size: 20,
          leading: 1.15,
        }),
        text(ctx.v("headline"), { size: 12 }),
        text(
          joined(
            [ctx.v("email"), ctx.v("phone"), ctx.v("city"), ctx.v("web")],
            " | ",
          ),
          { size: 10, after: 4 },
        ),
        ...(ctx.v("profile")
          ? [...plainSection(T.profile), ...paragraphs(ctx.v("profile"))]
          : []),
        ...entries(ctx, true),
        ...(ctx.v("skills")
          ? [...plainSection(T.skills), ...bullets(ctx.v("skills"))]
          : []),
        ...(ctx.v("languages")
          ? [...plainSection(T.languages), ...bullets(ctx.v("languages"))]
          : []),
      ],
    };
  },
};

export const coverLetter: Template = {
  id: "cover-letter",
  category: "jobs",
  name: L("Carta de presentación", "Cover letter"),
  description: L(
    "Para acompañar tu CV en una postulación.",
    "To go with your resume when you apply.",
  ),
  fields: [
    field("name", "text", "Tu nombre", "Your name"),
    field("email", "email", "Correo", "Email"),
    field("phone", "tel", "Teléfono", "Phone"),
    field("city", "text", "Ciudad", "City"),
    field("date", "date", "Fecha", "Date"),
    field("recipient", "text", "Destinatario", "Recipient"),
    field("company", "text", "Empresa", "Company"),
    field("position", "text", "Cargo al que aplicas", "Position"),
    field("greeting", "text", "Saludo", "Greeting"),
    field(
      "body",
      "multiline",
      "Carta (deja una línea en blanco entre párrafos)",
      "Letter (leave a blank line between paragraphs)",
    ),
    field("closing", "text", "Despedida", "Closing"),
  ],
  sample(lang) {
    const today = todayIso();
    if (lang === "es")
      return {
        fields: {
          name: "Ana María Torres",
          email: "ana.torres@ejemplo.com",
          phone: "+57 300 123 4567",
          city: "Medellín",
          date: today,
          recipient: "Equipo de selección",
          company: "Innova Digital S.A.S.",
          position: "Diseñadora de producto",
          greeting: "Estimado equipo de selección:",
          body: "Me dirijo a ustedes para postularme al cargo de diseñadora de producto. Tengo seis años de experiencia diseñando apps móviles y web, y me motiva mucho el trabajo que hacen en servicios financieros.\n\nEn mi empleo actual rediseñé el registro de la app y subí la conversión un 18 %. También creé un sistema de diseño que hoy usan cuatro equipos.\n\nMe encantaría conversar sobre cómo puedo aportar a su equipo. Adjunto mi hoja de vida.",
          closing: "Cordialmente,",
        },
        lists: {},
      };
    return {
      fields: {
        name: "Jordan Smith",
        email: "jordan.smith@example.com",
        phone: "+1 555 010 2030",
        city: "Austin, TX",
        date: today,
        recipient: "Hiring team",
        company: "Innova Digital Inc.",
        position: "Product designer",
        greeting: "Dear hiring team,",
        body: "I am writing to apply for the product designer position. I have six years of experience designing mobile and web apps, and I am excited by your work in financial services.\n\nIn my current job I redesigned the app sign-up and raised conversion by 18%. I also built a design system that four teams use today.\n\nI would love to talk about how I can help your team. My resume is attached.",
        closing: "Sincerely,",
      },
      lists: {},
    };
  },
  fileName: (ctx) =>
    joined(
      [ctx.tx(L("Carta de presentación", "Cover letter")), ctx.v("name")],
      " - ",
    ),
  build(ctx) {
    return {
      title: joined(
        [ctx.tx(L("Carta de presentación", "Cover letter")), ctx.v("name")],
        " - ",
      ),
      blocks: [
        text(ctx.v("name"), {
          role: "heading",
          variant: "Bold",
          size: 18,
          color: ctx.style.accent,
        }),
        text(joined([ctx.v("email"), ctx.v("phone"), ctx.v("city")]), {
          size: 9.5,
          color: MUTED,
        }),
        {
          type: "rule",
          color: ctx.style.accent,
          thickness: 1.2,
          before: 8,
          after: 18,
        },
        text(joined([ctx.v("city"), ctx.date(ctx.v("date"))], ", "), {
          after: 14,
        }),
        text(ctx.v("recipient"), { variant: "Bold" }),
        text(ctx.v("company")),
        ...(ctx.v("position")
          ? [
              text(
                `${ctx.tx(L("Ref.: Postulación a", "Re: Application for"))} ${ctx.v("position")}`,
                { variant: "Bold", before: 12 },
              ),
            ]
          : []),
        text(ctx.v("greeting"), { before: 14, after: 8 }),
        ...paragraphs(ctx.v("body")),
        text(ctx.v("closing"), { before: 6 }),
        signature([ctx.v("name"), ctx.v("email")], { before: 40 }),
      ],
    };
  },
};

export const JOBS = [cvClassic, cvModern, cvAts, coverLetter];
