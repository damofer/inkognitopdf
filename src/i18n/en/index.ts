// English messages. Each area file is typed against its Spanish twin, so a
// missing key or a different argument list fails the type check.
import type { Messages } from "../es";
import { app } from "./app";
import { compare } from "./compare";
import { editor } from "./editor";
import { editLayer } from "./editLayer";
import { engine } from "./engine";
import { guide } from "./guide";
import { landing } from "./landing";
import { mobile } from "./mobile";
import { numbering } from "./numbering";
import { ocr } from "./ocr";
import { organize } from "./organize";
import { pii } from "./pii";
import { privacy } from "./privacy";
import { protect } from "./protect";
import { redact } from "./redact";
import { scan } from "./scan";
import { share } from "./share";
import { sign } from "./sign";
import { signEngine } from "./signEngine";
import { support } from "./support";
import { templates } from "./templates";
import { tools } from "./tools";
import { ui } from "./ui";
import { viewer } from "./viewer";
import { writer } from "./writer";
import { xray } from "./xray";

export const en: Messages = {
  ...app,
  ...compare,
  ...editor,
  ...editLayer,
  ...engine,
  ...guide,
  ...landing,
  ...mobile,
  ...numbering,
  ...ocr,
  ...organize,
  ...pii,
  ...privacy,
  ...protect,
  ...redact,
  ...scan,
  ...share,
  ...sign,
  ...signEngine,
  ...support,
  ...templates,
  ...tools,
  ...ui,
  ...viewer,
  ...writer,
  ...xray,
};
