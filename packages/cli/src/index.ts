#!/usr/bin/env node
import { IMAGE_STYLES } from "@cope/core";
import { parseArgs } from "node:util";
import { runBriefCommand } from "./commands/brief.js";
import { runInit } from "./commands/init.js";
import { runRunCommand } from "./commands/run.js";
import { runVoiceCommand } from "./commands/voice.js";

const HELP = [
  "cope — Create Once, Post Everywhere",
  "",
  "Usage:",
  "  cope styles                  list available image styles",
  "  cope init [dir]              write config + .env.example",
  "  cope brief <input>           just the canonical brief",
  "  cope run <input> -f a,b,c    adapt to the given format ids",
  "  cope run <input> --all       adapt to every known format",
  "  cope voice <src>... [--force]  learn voice.md from URLs, RSS feed URLs, or files",
  "  --image-mode cards|generated  local info cards (default) or AI artwork",
  "  --image-style <name>          editorial (default), minimal, blueprint, sketch",
].join("\n");

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "styles": {
      for (const [name, style] of Object.entries(IMAGE_STYLES)) console.log(`${name.padEnd(12)} ${style.description}`);
      return;
    }
    case "init": {
      runInit(rest[0] ?? process.cwd());
      return;
    }
    case "brief": {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      if (!positionals[0]) throw new Error("Usage: cope brief <input>");
      await runBriefCommand(positionals[0]);
      return;
    }
    case "run": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          formats: { type: "string", short: "f" },
          all: { type: "boolean" },
          "image-mode": { type: "string" },
          "image-style": { type: "string" },
        },
      });
      if (!positionals[0]) throw new Error("Usage: cope run <input> -f <ids> | --all");
      await runRunCommand(positionals[0], {
        formats: values.formats?.split(",").map((s) => s.trim()),
        all: values.all,
        imageMode: values["image-mode"],
        imageStyle: values["image-style"],
      });
      return;
    }
    case "voice": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { force: { type: "boolean" } },
      });
      await runVoiceCommand(positionals, { force: values.force });
      return;
    }
    default: {
      console.log(HELP);
      if (command && command !== "help" && command !== "--help") process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
