// Spanish messages: the signing guide at /guia/firmar/ (spec 036). Texts of a
// static page, written into its HTML like the landing page's (spec 008).
export const guide = {
  "guide.title":
    "Guía: firmar un PDF con varias personas y con firma digital (PAdES) · InkognitoPDF",
  "guide.description":
    "Cómo preparar un PDF para que lo firmen varias personas en orden y cómo firmarlo con firma digital PAdES en InkognitoPDF, sin subirlo a ningún servidor.",
  "guide.eyebrow": "Guía de firmas",
  "guide.heading": "Firmar con varias personas y con firma digital (PAdES)",
  "guide.lead":
    "Todo ocurre en tu navegador: ni el documento, ni tu firma, ni tu certificado pasan por un servidor. Para que el PDF llegue a cada firmante, lo envías tú, por correo, WhatsApp o como prefieras.",
  "guide.toc": "En esta guía",
  "guide.toc1": "Firmar con firma digital (PAdES)",
  "guide.toc2": "Varias personas firman el mismo PDF",
  "guide.toc3": "Comprobar las firmas",
  "guide.toc4": "Preguntas frecuentes",

  // 1. One signer, PAdES.
  "guide.padesTitle": "1. Firmar con firma digital (PAdES)",
  "guide.padesWhat":
    "PAdES es el estándar europeo de firma digital para PDF. La firma va dentro del archivo y sella su contenido: si alguien cambia algo después, InkognitoPDF, Adobe Acrobat y otros lectores lo detectan. Una firma «Solo visual», en cambio, es una imagen en la página y no protege nada.",
  "guide.padesStep1": "Abre el PDF en InkognitoPDF y pulsa «Firmar».",
  "guide.padesStep2":
    "En «1 · Colocar», pulsa «Crear» para hacer tu firma: dibujada, escrita o desde una foto. Después pulsa «Colocar firma» y haz clic en la página donde va. Si hace falta, añade también tus iniciales y la fecha.",
  "guide.padesShotPlace":
    "Paso «1 · Colocar»: la firma creada y colocada sobre la línea de firma.",
  "guide.padesStep3":
    "Pulsa «Siguiente: firmar y guardar» y deja marcada «Firma digital (PAdES, recomendada)».",
  "guide.padesStep4": "En «Certificado», elige con qué firmas:",
  "guide.padesCertP12":
    "«Importar .p12»: si tienes un certificado de firma emitido por una autoridad (por ejemplo, el de la FNMT, el DNI electrónico o la firma electrónica de tu país), elige el archivo .p12 o .pfx y escribe su contraseña. Es la opción que identifica quién firma.",
  "guide.padesCertOwn":
    "«Crear certificado propio»: escribe tu nombre y, si quieres, tu correo, y pulsa «Crear certificado». Prueba que el documento no cambió, pero no quién eres: los lectores lo muestran como «identidad desconocida».",
  "guide.padesCertKept":
    "El certificado se guarda solo en este navegador y su clave no se puede exportar. La próxima vez aparece ya elegido; «Olvidar» lo borra.",
  "guide.padesStep5":
    "Si quieres, marca «Añadir página de registro de firmas»: al final del PDF queda una página con quién firmó, cuándo y la huella del documento.",
  "guide.padesStep6":
    "Pulsa «Guardar firmado». Se descarga una copia con «(firmado)» en el nombre; el archivo original no cambia.",
  "guide.padesShotSave":
    "Paso «2 · Firmar y guardar»: firma digital con un certificado propio.",
  "guide.padesWarning":
    "Un PDF ya firmado no se edita ni se vuelve a guardar desde el editor: el archivo se reescribiría y sus firmas dejarían de valer (la app avisa antes). Si tienen que firmar más personas, prepáralo con «Varios firmantes»: cada firma se añade sin romper las anteriores.",

  // 2. Several signers.
  "guide.multiTitle": "2. Varias personas firman el mismo PDF",
  "guide.multiWhat":
    "Quien envía el documento decide quién firma, en qué orden y dónde. Ese plan va guardado dentro del PDF. Cada persona abre el archivo en InkognitoPDF, firma solo sus campos y se lo pasa a la siguiente. Nadie necesita cuenta.",
  "guide.flow": "Recorrido del documento",
  "guide.flowPrepare": "Lo preparas",
  "guide.flowSigner1": "Firma Ana",
  "guide.flowSigner2": "Firma Beto",
  "guide.flowDone": "Firmado por todos",
  "guide.prepareTitle": "Preparar el documento (quien envía)",
  "guide.prepareStep1":
    "Abre el PDF, pulsa «Firmar» y despliega «Varios firmantes».",
  "guide.prepareStep2":
    "En el tipo de firma, deja «Digital (PAdES)». Con «Solo visual» la app respeta el orden, pero el documento queda sin protección: cualquiera podría cambiarlo sin que se note.",
  "guide.prepareStep3":
    "Pulsa «Añadir firmante» por cada persona y escribe su nombre (el correo es opcional). El número de la izquierda es el orden: quienes tienen el mismo número pueden firmar en cualquier orden entre ellos.",
  "guide.prepareStep4":
    "Debajo de cada firmante, pulsa «+ Firma» y haz clic en la página donde debe firmar. Lo mismo con «+ Iniciales», «+ Fecha», «+ Nombre» o «+ Texto». La fecha y el nombre se rellenan solos al firmar. Con firma digital, cada persona necesita al menos un campo de firma.",
  "guide.prepareStep5":
    "Deja marcada «Añadir página de registro de firmas» si quieres una página final con cada firma, su fecha y su certificado.",
  "guide.prepareStep6":
    "Pulsa «Guardar para firmar». Se descarga el PDF con «(para firmar)» en el nombre. Envíaselo a quien firma primero.",
  "guide.prepareShot":
    "Dos firmantes en orden, cada uno con su campo de firma y de fecha en la página.",
  "guide.signTitle": "Firmar (cada firmante)",
  "guide.signStep1":
    "Abre el PDF que te enviaron en InkognitoPDF (inkognitopdf.com/app, «Abrir PDF»). Arriba aparece «Documento para firmar. Le toca a:» con tu nombre. Pulsa «Firmar como…».",
  "guide.signShotNotice":
    "El aviso al abrir un documento preparado para firmar.",
  "guide.signStep2":
    "Elige tu nombre. Solo puede firmar a quien le toca: los demás aparecen como «espera» o «firmó». Tus campos se marcan en la página.",
  "guide.signStep3":
    "Pulsa «Crear» para hacer tu firma (y tus iniciales, si te las piden) y rellena los textos que te correspondan.",
  "guide.signStep4":
    "Elige o crea tu certificado, como en el apartado 1, y pulsa «Guardar firmado». Se descarga una copia con «(firmado)» en el nombre, y la app te dice a quién enviársela.",
  "guide.signShot": "Le toca a Ana: Beto espera su turno.",
  "guide.doneTitle": "Cuando firmaron todos",
  "guide.doneText":
    "Al abrir el último archivo, la app muestra «Documento firmado por todos» y cuántas firmas digitales tiene. Cada firma cubre el documento tal como estaba cuando se firmó, así que se comprueban una por una.",
  "guide.doneShot":
    "El documento final, firmado por los dos, con todas sus firmas íntegras.",
  "guide.auditShot":
    "La página de registro de firmas, al final del PDF: una fila por firmante.",

  // 3. Checking the signatures.
  "guide.verifyTitle": "3. Comprobar las firmas",
  "guide.verifyText":
    "Al abrir un PDF firmado, pulsa «Ver firmas». De cada firma verás:",
  "guide.verifyIntegrity":
    "Si es íntegra: «Firma íntegra» quiere decir que el contenido firmado no cambió.",
  "guide.verifyChanges":
    "Qué pasó después: «Cubre todo el documento», «Después se añadieron otras firmas…» (lo normal con varios firmantes) o «El documento se modificó después de esta firma» (alguien cambió el contenido).",
  "guide.verifyTrust":
    "El certificado: autofirmado, de confianza o no verificado, con su titular, emisor, validez y huella.",
  "guide.verifyShot": "«Ver firmas»: el detalle de cada firma del documento.",
  "guide.verifyRoots":
    "InkognitoPDF no trae una lista de autoridades. Para que un certificado salga como «de confianza», importa en «Raíces de confianza» el certificado raíz de su autoridad (.cer, .crt o .pem). Sin conexión, la app no comprueba si un certificado fue revocado.",
  "guide.verifyOther":
    "Las firmas también se pueden comprobar en Adobe Acrobat Reader y en otros lectores con firma digital.",

  // 4. Questions.
  "guide.faqTitle": "4. Preguntas frecuentes",
  "guide.faqLegalQ": "¿La firma digital tiene validez legal?",
  "guide.faqLegalA":
    "InkognitoPDF crea firmas PAdES estándar. Su validez legal depende del certificado que uses y de la normativa de tu país: un certificado emitido por una autoridad reconocida identifica a quien firma; uno propio solo prueba que el documento no cambió.",
  "guide.faqAccountQ": "¿Los firmantes necesitan cuenta o instalar algo?",
  "guide.faqAccountA":
    "No. Basta con abrir inkognitopdf.com/app en el navegador, en el ordenador o en el móvil. Si quieren, pueden instalarla como app.",
  "guide.faqPhoneQ": "¿Se puede firmar desde el móvil?",
  "guide.faqPhoneA":
    "Sí, con los mismos pasos. En el móvil el panel se cierra mientras colocas la firma o los campos en la página, y vuelve al pulsar «Firmar».",
  "guide.faqP12Q": "Mi archivo .p12 da un error de cifrado antiguo",
  "guide.faqP12A":
    "Algunos .p12 usan 3DES o RC2, que los navegadores no admiten. Expórtalo de nuevo con AES: en Windows, desde el administrador de certificados, eligiendo el cifrado AES256-SHA256; o con «openssl pkcs12 -export» de OpenSSL 3.",
  "guide.faqChangedQ":
    "¿Qué pasa si alguien cambia el PDF entre una firma y otra?",
  "guide.faqChangedA":
    "Las firmas anteriores lo delatan: en «Ver firmas» aparecen con «El documento se modificó después de esta firma».",
  "guide.faqTurnQ": "¿Alguien puede firmar fuera de su turno?",
  "guide.faqTurnA":
    "En InkognitoPDF no: solo puede elegir su nombre quien tiene el turno. Otros programas no conocen el plan de firmas, así que envía el archivo solo a quien le toca.",
  "guide.faqUploadQ": "¿El documento o mi certificado se suben a algún sitio?",
  "guide.faqUploadA":
    "No. Todo se hace en tu dispositivo. El certificado se guarda en este navegador, con la clave sin poder exportarse, y «Olvidar» lo borra.",

  "guide.ctaTitle": "¿Listo para firmar?",
  "guide.ctaText": "Abre tu PDF y sigue los pasos. No hace falta cuenta.",
  "guide.ctaButton": "Firmar un PDF",
  "guide.back": "Volver al inicio",

  // Links to this guide from the landing page and the app.
  "guide.link": "Cómo funciona: ver la guía",
  "guide.siteLink": "Guía de firmas paso a paso",
  "guide.linkHint": "Abre la guía de firmas en otra pestaña",
};
