<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-dark.svg" />
    <img src="public/brand/logo-light.svg" alt="InkognitoPDF" height="56" />
  </picture>
</p>

<p align="center">
  <a href="https://inkognitopdf.com">
    <img src="docs/images/promo.gif" width="480" alt="InkognitoPDF en 20 segundos (vídeo en inglés): un editor de PDF «gratis» que cobra al descargar, e InkognitoPDF, que edita, firma, escanea, une, comprime y protege PDF gratis, sin cuenta y sin que los archivos salgan de tu dispositivo." />
  </a>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>Español</b>
</p>

<p align="center">
  <b>Edita, escanea y firma PDFs sin que salgan de tu dispositivo.</b><br />
  Un editor de PDF y escáner de documentos gratis y privado que funciona entero en tu navegador.
</p>

<p align="center">
  <a href="https://inkognitopdf.com/app/"><img src="https://img.shields.io/badge/Abrir_la_app-inkognitopdf.com-2ea44f?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Abrir la app en inkognitopdf.com" /></a>
  <a href="https://github.com/damofer/inkognitopdf"><img src="https://img.shields.io/github/package-json/v/damofer/inkognitopdf?style=for-the-badge&label=versi%C3%B3n&color=555" alt="Versión" /></a>
</p>

<h2 align="center">❤️ Apoya el desarrollo</h2>

<p align="center">
  InkognitoPDF es gratis, sin anuncios y sin cuentas. Si te resulta útil, tu apoyo me ayuda a mantenerlo así y a seguir añadiendo funciones.
</p>

<p align="center">
  El apoyo es totalmente opcional: usar la app, compartirla y reportar problemas ya ayuda mucho al proyecto.
</p>

<p align="center">
  <a href="https://link.mercadopago.com.co/damofer"><img src="https://img.shields.io/badge/Mercado_Pago-Desde_Colombia-00B1EA?style=for-the-badge&logo=mercadopago&logoColor=white" alt="Apoya desde Colombia con Mercado Pago" /></a>
  <a href="https://ko-fi.com/damofer"><img src="https://img.shields.io/badge/Ko--fi-Fuera_de_Colombia-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white" alt="Apoya desde fuera de Colombia con Ko-fi" /></a>
</p>

<p align="center">
  Con Mercado Pago, en pesos: <a href="https://mpago.li/1Kyib9Q">$10.000</a> · <a href="https://mpago.li/1sVMAt1">$20.000</a> · <a href="https://mpago.li/2s9ot7Z">$50.000</a> · <a href="https://link.mercadopago.com.co/damofer">otro monto</a>
</p>

<p align="center">Gracias por apoyar el proyecto. ❤️</p>

<p align="center">
  <img src="https://img.shields.io/badge/Plataforma-Web_%7C_PWA-555" alt="Plataforma: web y PWA" />
  <img src="https://img.shields.io/badge/Framework-React_%7C_pdf.js-8A2BE2" alt="Framework: React y pdf.js" />
  <img src="https://img.shields.io/badge/Lenguaje-TypeScript-3178C6" alt="Lenguaje: TypeScript" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/Licencia-Apache--2.0-D22128" alt="Licencia: Apache-2.0" /></a>
</p>

---

![El editor con un formulario abierto](docs/images/es/editor.png)

## Compromiso de privacidad

- **Tus archivos nunca salen de tu dispositivo.** Abrir, editar, reconocer texto, firmar, borrar, unir, comprimir, cifrar y guardar ocurre en el navegador. No hay ningún servidor que reciba documentos, firmas ni certificados.
- **Funciona sin conexión.** Es una PWA que se puede instalar; los modelos de OCR y las fuentes se guardan la primera vez que se usan.
- **Sin cuentas ni anuncios.**
- **La medición de uso es opcional.** Solo si el visitante la acepta se envían conteos anónimos de uso (Google Analytics a través de Firebase), y nunca incluyen nombres de archivo, texto ni contenido: la lista cerrada de eventos está en [`src/analytics/events.ts`](src/analytics/events.ts). Sin aceptarla, la app no hace ninguna petición a Google.
- **El sello de tiempo es opcional.** Si al firmar marcas «Añadir sello de tiempo», la app envía a `/tsa`, en el propio sitio, una huella SHA-256 de la firma, que se reenvía a DigiCert para que certifique la hora. No lleva el documento ni datos tuyos ([`functions/relay.js`](functions/relay.js)).

### Compruébalo tú mismo

No tienes que creernos.

1. **Lee el encabezado.** Todas las páginas se sirven con una `Content-Security-Policy` cuyo `connect-src` solo permite el propio sitio y las direcciones de Google Analytics (a las que se conecta únicamente si aceptas la medición de uso). El navegador rechaza cualquier otra conexión, intente lo que intente el código. Ejecuta `curl -sI https://inkognitopdf.com/app/` o mira los encabezados de respuesta de `/app/` en las herramientas de desarrollador. La política está en [`src/csp.ts`](src/csp.ts).
2. **Mira la pestaña Red.** Abre [la app](https://inkognitopdf.com/app/), abre las herramientas de desarrollador en la pestaña Red y vacíala. Luego abre un PDF, edítalo, fírmalo y guárdalo. Todas las peticiones van a `inkognitopdf.com` (fuentes, el motor de OCR y otros archivos de la app) y ninguna lleva tu documento. Si aceptaste Google Analytics, también verás peticiones a Google con los nombres de los eventos, nunca nombres de archivo ni contenido. Si firmas con sello de tiempo, verás una petición a `/tsa` de unos 80 bytes: la huella de la firma.
3. **Desconéctate.** Cuando la app ya cargó, activa el modo avión: sigue funcionando, porque nada necesita un servidor. Solo el sello de tiempo, que es opcional, necesita conexión.

## Funciones

|                            |                                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Editar texto**           | Cambia el texto que ya está en el PDF conservando su fuente, tamaño, color y grosor. Añade texto, imágenes y blanqueos.                                                                                                                                           |
| **Anotar**                 | Resaltado, subrayado, tachado, notas, texto libre, dibujo, líneas, flechas, rectángulos y elipses, guardados como anotaciones estándar.                                                                                                                           |
| **Formularios**            | Rellena campos AcroForm, crea campos nuevos de seis tipos y aplana el formulario.                                                                                                                                                                                 |
| **Firmar**                 | Firma dibujada, escrita o desde una foto; firma digital **PAdES** con un certificado creado en el dispositivo o importado de un `.p12`; varios firmantes en orden, con página de registro opcional; sello de tiempo opcional (PAdES B-T); verificación de firmas. |
| **Escanear**               | Fotografía papeles con el móvil: detección de la página, corrección de perspectiva y un filtro limpio de fotocopia en blanco y negro.                                                                                                                             |
| **OCR**                    | Reconoce el texto de los escaneos en español e inglés (Tesseract.js) para buscarlo, seleccionarlo y copiarlo.                                                                                                                                                     |
| **Editar texto escaneado** | Reemplaza una línea reconocida dentro de la imagen escaneada, igualando el papel y la tinta.                                                                                                                                                                      |
| **Borrado seguro**         | Marca zonas o busca palabras o patrones y elimina de verdad el texto, las imágenes, las anotaciones y los metadatos que hay debajo.                                                                                                                               |
| **Unir y dividir**         | Abre varios PDFs como uno, inserta PDFs, ordena las páginas arrastrándolas, divide por rangos o cada N páginas o extrae páginas (ZIP si salen varios archivos).                                                                                                   |
| **Comprimir**              | Reduce el tamaño: las imágenes se ajustan a lo que su página necesita y se codifican de nuevo, con tres niveles y el tamaño antes y después.                                                                                                                      |
| **Contraseñas**            | Abre PDFs protegidos (RC4 y AES, hasta AES-256) y guarda con contraseña AES-256; restricciones opcionales de imprimir y copiar, que la app explica que son solo orientativas.                                                                                     |
| **Páginas**                | Gira, elimina e inserta páginas en blanco.                                                                                                                                                                                                                        |
| **Plantillas**             | CV, cartas de presentación, facturas, cotizaciones, cuentas de cobro, recibos y cartas listos para rellenar, con vista previa, colores, tipografías y tamaño de papel; descarga el PDF o sigue editándolo en la app.                                              |
| **Escribir documentos**    | Escribe desde cero como en Word o Google Docs: títulos, listas, negrita, colores, resaltado, alineación, imágenes y saltos de página, viendo dónde empieza cada página; el resultado es un PDF con texto real, para descargar, firmar o añadir al PDF abierto.    |
| **Idiomas**                | Español e inglés, en el ordenador y en el teléfono.                                                                                                                                                                                                               |

## Capturas

| Firmar                                     | Borrado seguro                                           | Dividir                                         |
| ------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------- |
| ![Panel de firma](docs/images/es/sign.png) | ![Zonas marcadas para borrar](docs/images/es/redact.png) | ![Panel para dividir](docs/images/es/split.png) |

| Teléfono                                            | Anotar en el teléfono                                                          | Escáner                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| ![Editor en el teléfono](docs/images/es/mobile.png) | ![Herramientas para anotar en el teléfono](docs/images/es/mobile-annotate.png) | ![Paso del filtro en el escáner](docs/images/es/scan.png) |

Todas las imágenes usan documentos de muestra sintéticos. Se regeneran con `npm run build` y `node scripts/readme-images.mjs`.

## Primeros pasos

Requisito: **Node.js 24** o superior.

```bash
npm install          # dependencias, instaladas en el proyecto
npm run dev          # servidor de desarrollo
npm test             # pruebas unitarias (Vitest)
npm run test:e2e     # pruebas de extremo a extremo (Playwright; antes compila)
npm run build        # compilación de producción con service worker sin conexión, en dist/
```

Otros scripts: `npm run lint`, `npm run typecheck`, `npm run format:check` y `npm run fixtures`, que regenera los PDFs de prueba sintéticos.

Las pruebas de extremo a extremo usan el Chrome instalado en el equipo. Si están `openssl` y `qpdf`, las pruebas también comprueban con ellos las firmas y los archivos.

### Publicar

La compilación en `dist/` es un sitio estático: la landing en `/` y la app en `/app/`. [`firebase.json`](firebase.json) tiene la configuración de Firebase Hosting (reescrituras y cabeceras de caché). Para publicar tu propia copia, crea un proyecto de Firebase, pon su id en `.firebaserc` y ejecuta `npx firebase-tools deploy --only hosting,functions`. El intermediario del sello de tiempo (`/tsa`) es una Cloud Function de [`functions/`](functions/), que necesita el plan Blaze de Firebase. No hace falta ningún secreto para compilar ni para publicar. La configuración web de `src/analytics/firebase.ts` identifica la app web pública y no es un secreto.

### Alojarlo con Docker

El [`Dockerfile`](Dockerfile) compila el sitio y lo sirve con nginx, con las mismas rutas y cabeceras de caché que `firebase.json` ([`docker/nginx.conf`](docker/nginx.conf)):

```bash
docker build -t inkognitopdf .
docker run -d -p 8080:80 inkognitopdf
```

El contenedor solo sirve archivos y reenvía a DigiCert las peticiones del sello de tiempo, que llevan una huella y nunca el documento: los documentos se procesan en el navegador. Sírvelo por HTTPS (por ejemplo, detrás de tu proxy inverso), porque los navegadores solo permiten la cámara y el service worker sin conexión en un contexto seguro. Las copias en otro dominio nunca miden el uso.

## Estructura del proyecto

```
index.html        landing (textos de src/i18n, escritos por la compilación)
app/index.html    la app
src/
  landing/        script y estilos de la landing
  editor/         interfaz del editor: herramientas, paneles, guardar, dividir
  engine/         escritura de PDFs con pdf-lib: texto, fuentes, formularios, borrado, unir y dividir
  model/          estado del documento, operaciones e historial para deshacer
  viewer/         render con pdf.js: páginas, capa de texto, miniaturas, zoom
  scan/           escáner: detección de la página, perspectiva, filtro B/N (Web Worker)
  ocr/            OCR con Tesseract.js y capa de texto seleccionable
  sign/           firmas: dibujo, PAdES, verificación, varios firmantes
  storage/        abrir archivos (el original nunca se modifica), ZIP
  analytics/      consentimiento y lista cerrada de eventos de uso
  support/        enlaces de donación
  templates/      plantillas: motor de maquetación, render a PDF y catálogo
  writer/         escribir documentos: editor (ProseMirror), maquetación y PDF
  i18n/           textos en español (referencia) e inglés
tests/            pruebas unitarias y fixtures sintéticos
e2e/              pruebas de extremo a extremo (Playwright)
scripts/          copia de recursos, fixtures, iconos, capturas
public/brand/     logo e iconos
docker/           configuración de nginx de la imagen de Docker
functions/        intermediario del sello de tiempo (Cloud Function)
```

## Tecnologías

| Componente                                                                             | Licencia         | Uso                                  |
| -------------------------------------------------------------------------------------- | ---------------- | ------------------------------------ |
| [React](https://react.dev)                                                             | MIT              | Interfaz                             |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`)                             | Apache-2.0       | Render y capa de texto               |
| [pdf-lib](https://github.com/Hopding/pdf-lib) y `@pdf-lib/fontkit`                     | MIT              | Escritura de PDFs                    |
| [Tesseract.js](https://github.com/naptha/tesseract.js) y sus datos de español e inglés | Apache-2.0       | OCR en el navegador                  |
| [PKI.js](https://github.com/PeculiarVentures/PKI.js), asn1js                           | BSD-3-Clause     | CMS, X.509 y PKCS#12 para las firmas |
| Arimo, Tinos, Cousine, Carlito, Caladea, Dancing Script, Great Vibes, Caveat           | OFL-1.1          | Fuentes de sustitución y manuscritas |
| Firebase Analytics (opcional, con consentimiento)                                      | Apache-2.0       | Conteos anónimos de uso              |
| Vite, Vitest, Playwright, TypeScript, ESLint, Prettier                                 | MIT / Apache-2.0 | Compilación y pruebas                |

Lista completa y notas: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Cómo contribuir

Los issues y los pull requests son bienvenidos. Unas pocas reglas mantienen el proyecto como es:

- **Todo se queda en el dispositivo.** Ninguna función puede enviar documentos ni su contenido a un servidor.
- **Código en sala limpia.** Escribe tu propio código; no copies código, recursos ni textos de productos de PDF propietarios.
- **Solo licencias abiertas.** Las dependencias nuevas deben ser compatibles con Apache-2.0 (nada de GPL ni AGPL).
- **Los dos idiomas.** Todo texto visible va en `src/i18n/es` y `src/i18n/en`.
- **También en el teléfono.** Los controles funcionan con el dedo y miden al menos 44 px de alto.
- **Las pruebas en verde.** Ejecuta `npm test`, `npm run test:e2e`, `npm run lint` y `npm run format:check` antes de abrir un pull request. Los documentos de prueba deben ser sintéticos, nunca archivos personales reales.

## Licencia

Copyright 2026 David Mogollon. Publicado bajo la [Apache License 2.0](LICENSE). Ver también [`NOTICE`](NOTICE).
