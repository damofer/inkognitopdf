# Fixtures de prueba

PDFs **sintéticos** generados por `npm run fixtures` (`scripts/generate-fixtures.mjs`). Ninguno proviene de un producto ni de un documento de terceros.

| Archivo                 | Para qué sirve                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `simple-text.pdf`       | Título y párrafo                                                                                                                               |
| `table.pdf`             | Tabla con líneas y celdas de texto                                                                                                             |
| `two-pages.pdf`         | Navegación y operaciones de página                                                                                                             |
| `rotated-page.pdf`      | Página con `/Rotate 90` seguida de una sin rotar                                                                                               |
| `subset-font.pdf`       | Fuente TrueType incrustada como subconjunto                                                                                                    |
| `tj-kerning.pdf`        | Operador `TJ` con ajustes de kerning                                                                                                           |
| `text-operators.pdf`    | Texto dividido, `'`, `Tc`, color y matriz girada                                                                                               |
| `type3-font.pdf`        | Fuente Type3 dibujada con rectángulos                                                                                                          |
| `form-xobjects.pdf`     | Texto en Form XObjects compartidos, anidados y girados; campo AcroForm                                                                         |
| `forms-annotations.pdf` | Spec 005: un campo de cada tipo (con su fuente, tamaño y color) y anotaciones existentes con apariencia, nota con ventana emergente y un sello |
| `many-pages.pdf`        | 200 páginas: límite del criterio CA1                                                                                                           |

`subset-font.pdf` incrusta un subconjunto de **Liberation Sans**, que viene en `pdfjs-dist/standard_fonts` y se distribuye bajo la licencia SIL Open Font License 1.1.
