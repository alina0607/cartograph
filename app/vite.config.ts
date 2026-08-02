import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const EXTRACTOR_DIR = fileURLToPath(new URL("../extractor", import.meta.url));

// Dev-only bridge: the browser cannot run Python, so /api/scan shells out to the
// extractor on a folder the user picks and streams back its seed.json. Local tool,
// local paths — the path is passed as an argv (never a shell string) so it cannot
// inject a command.
function scanPlugin(): Plugin {
  return {
    name: "cartograph-scan",
    configureServer(server) {
      server.middlewares.use("/api/scan", (req, res) => {
        const target = new URL(req.url ?? "", "http://x").searchParams.get("path")?.trim();
        const done = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(typeof body === "string" ? body : JSON.stringify(body));
        };
        if (!target) return done(400, { error: "no folder path given" });

        const child = spawn("uv", ["run", "cartograph-extract", target, "--indent", "0"], {
          cwd: EXTRACTOR_DIR,
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", (e) => done(500, { error: String(e) }));
        child.on("close", (code) =>
          code === 0 ? done(200, out) : done(400, { error: err.trim() || "extract failed" }),
        );
      });

      // Native folder chooser (macOS). Gives a real visual picker AND the absolute path
      // the extractor needs — which a browser folder input deliberately withholds.
      server.middlewares.use("/api/pick", (_req, res) => {
        const child = spawn("osascript", [
          "-e",
          'POSIX path of (choose folder with prompt "cartograph: pick a Python project")',
        ]);
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", (e) => {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: String(e) }));
        });
        child.on("close", (code) => {
          if (code === 0) {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ path: out.trim() }));
          } else if (/User canceled/i.test(err)) {
            res.statusCode = 204; // the user dismissed the dialog
            res.end();
          } else {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: err.trim() || "pick failed" }));
          }
        });
      });
    },
  };
}

// base './' so the built site opens from any path, including a file:// URL.
export default defineConfig({
  base: "./",
  build: { target: "esnext" },
  plugins: [scanPlugin()],
});
