// Spanish messages: the reference set. Every area file in en/ mirrors the one
// here with the same keys and argument lists.
import { app } from "./app";
import { editor } from "./editor";
import { editLayer } from "./editLayer";
import { engine } from "./engine";
import { landing } from "./landing";
import { mobile } from "./mobile";
import { ocr } from "./ocr";
import { organize } from "./organize";
import { privacy } from "./privacy";
import { protect } from "./protect";
import { redact } from "./redact";
import { scan } from "./scan";
import { sign } from "./sign";
import { signEngine } from "./signEngine";
import { support } from "./support";
import { templates } from "./templates";
import { tools } from "./tools";
import { viewer } from "./viewer";

export const es = {
  ...app,
  ...editor,
  ...editLayer,
  ...engine,
  ...landing,
  ...mobile,
  ...ocr,
  ...organize,
  ...privacy,
  ...protect,
  ...redact,
  ...scan,
  ...sign,
  ...signEngine,
  ...support,
  ...templates,
  ...tools,
  ...viewer,
};

export type Messages = typeof es;
