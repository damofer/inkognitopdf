// English messages. Each area file is typed against its Spanish twin, so a
// missing key or a different argument list fails the type check.
import type { Messages } from "../es";
import { app } from "./app";
import { editor } from "./editor";
import { editLayer } from "./editLayer";
import { engine } from "./engine";
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
import { viewer } from "./viewer";
import { xray } from "./xray";

export const en: Messages = {
  ...app,
  ...editor,
  ...editLayer,
  ...engine,
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
  ...viewer,
  ...xray,
};
