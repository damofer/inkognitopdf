# Third-party notices

InkognitoPDF is distributed under the Apache License 2.0. The app includes or serves the following third-party software. Each license comes with its files in `node_modules/` and, for what is copied to `public/`, in a `*-LICENSE.txt` file next to them.

| Component                                                                                                                              | Version         | License      | Used for                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------ | ----------------------------------------------------------------------- |
| pdfjs-dist (Mozilla pdf.js)                                                                                                            | 6.4.299         | Apache-2.0   | Rendering, text layer, page analysis                                    |
| pdf-lib                                                                                                                                | 1.17.1          | MIT          | Writing PDFs                                                            |
| @pdf-lib/fontkit, @pdf-lib/standard-fonts                                                                                              | 1.1.1, 1.0.0    | MIT          | Reading fonts when saving                                               |
| React, React DOM                                                                                                                       | 19.3.1          | MIT          | Interface                                                               |
| ProseMirror (prosemirror-model, -state, -view, -transform, -commands, -history, -keymap, -inputrules, -schema-list)                    | 1.x             | MIT          | Rich text editor for writing documents                                  |
| orderedmap 2.1.1, rope-sequence 1.3.4, w3c-keyname 2.2.8                                                                               | —               | MIT          | Dependencies of ProseMirror                                             |
| tesseract.js                                                                                                                           | 7.0.0           | Apache-2.0   | OCR worker in the browser                                               |
| tesseract.js-core (Tesseract OCR compiled to WebAssembly)                                                                              | 7.0.0           | Apache-2.0   | OCR engine                                                              |
| wasm-feature-detect                                                                                                                    | 1.9.0           | Apache-2.0   | Picking the same OCR engine build as tesseract.js, to download it ahead |
| @tesseract.js-data/spa, @tesseract.js-data/eng (`4.0.0_best_int`)                                                                      | 1.0.0           | MIT          | OCR language data (npm package)                                         |
| Tesseract `tessdata_best` data (Spanish, English)                                                                                      | 4.0.0           | Apache-2.0   | LSTM models inside those packages                                       |
| Arimo, Tinos, Cousine, Carlito, Caladea (`@expo-google-fonts/*`)                                                                       | 0.4.x           | OFL-1.1      | Substitute fonts for edited and recognized text                         |
| Dancing Script, Great Vibes, Caveat (`@expo-google-fonts/*`)                                                                           | 0.4.x           | OFL-1.1      | Typed (handwriting) signatures                                          |
| pkijs (PKI.js)                                                                                                                         | 3.4.1           | BSD-3-Clause | Signatures: CMS, X.509 certificates, PKCS#12                            |
| asn1js                                                                                                                                 | 3.0.10          | BSD-3-Clause | Signatures: ASN.1 encoding (pkijs dependency)                           |
| pvtsutils 1.3.6, pvutils 1.2.0, @noble/hashes 1.8.0 (MIT); bytestreamjs 2.0.1 (BSD-3-Clause); tslib 2.8.1 (0BSD)                       | —               | various      | Dependencies of pkijs and asn1js                                        |
| @firebase/app, @firebase/analytics                                                                                                     | 0.16.3, 0.10.25 | Apache-2.0   | Optional usage measurement, in a chunk loaded only after consent        |
| Lucide icons (paths adapted in `src/icons.tsx`)                                                                                        | —               | ISC          | Interface line icons                                                    |
| @firebase/util 1.15.3, @firebase/logger 0.5.2, @firebase/component 0.7.5, @firebase/installations 0.6.24 (Apache-2.0); idb 7.1.1 (ISC) | —               | various      | Dependencies of @firebase/analytics                                     |

Usage measurement is active only if the visitor accepts it. Then the Firebase SDK downloads Google's `gtag.js` (it is not included in or redistributed with the app) and sends the events of the closed list in `src/analytics/events.ts`. Without consent, there is no request to Google.

The Tesseract files are copied to `public/tesseract/` on `npm install`, `dev` and `build` (`scripts/copy-pdfjs-assets.mjs`), together with `tesseract.js-LICENSE.txt` and `tesseract.js-core-LICENSE.txt`. They are served from the app's own origin; OCR makes no requests to third parties.

The timestamp relay in `functions/` (spec 040) runs on Cloud Functions, not in the browser. It uses firebase-functions 7.4.0 (MIT) and firebase-admin 14.5.0 (Apache-2.0). It forwards timestamp requests, which carry only a hash, to DigiCert's RFC 3161 service.

The test fixture `tests/fixtures/subset-font.pdf` embeds a subset of Liberation Sans (from `pdfjs-dist/standard_fonts`, SIL Open Font License 1.1).

Development tools (Vite, Vitest, Playwright, TypeScript, ESLint, Prettier, firebase-tools and their dependencies) are not part of the built app. Their licenses are MIT, Apache-2.0, BSD, ISC and similar permissive licenses, plus MPL-2.0 for the `lightningcss` build tool.
