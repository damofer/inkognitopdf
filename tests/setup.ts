// Unit tests run in Spanish, whatever the machine's locale, so messages
// asserted in tests are stable (spec 006).
import { setLang } from "../src/i18n";

setLang("es", false);
