// The Ludion Worker: serves the prerendered site and owns every dynamic route (docs/decisions.md).
// Serves static assets, and a fixed "ended" answer for the 0.1.x lesson and MCP endpoints.
import { createApp } from "./app.ts";

export default createApp();
