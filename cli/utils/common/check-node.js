/**
 * Side-effect import: must be the first import in cli/zerion.js. ES module
 * imports evaluate in order, so this exits before any dependency is loaded.
 */

import { exitIfUnsupportedNode } from "./node-version.js";

exitIfUnsupportedNode();
