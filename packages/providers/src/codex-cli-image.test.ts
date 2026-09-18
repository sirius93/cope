import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCodexCliImageProvider } from "./codex-cli-image.js";

// A fake executable exercises the real subprocess boundary without an authenticated CLI.
test("image CLI runs outside the output directory, rejects symlinks and preserves existing files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cope-cli-test-"));
  const binary = join(dir, "fake-codex");
  const outFile = join(dir, "out.png");
  const record = join(dir, "cwd.txt");
  try {
    const prefix = `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(record)}, process.cwd());\n`;
    writeFileSync(binary, prefix + "fs.writeFileSync('image.png', Buffer.from([137,80,78,71,13,10,26,10,1]));\n", { mode: 0o700 });
    const provider = createCodexCliImageProvider({ binary });
    await provider.generate({ prompt: "test", outFile });
    const scratch = readFileSync(record, "utf8");
    assert.notEqual(scratch, dir);
    assert.ok(!existsSync(scratch), "scratch directory must be removed");
    writeFileSync(outFile, "keep this existing image");
    await assert.rejects(provider.generate({ prompt: "test", outFile }), /EEXIST/);
    assert.equal(readFileSync(outFile, "utf8"), "keep this existing image");
    writeFileSync(binary, prefix + `fs.symlinkSync(${JSON.stringify(outFile)}, 'image.png');\n`, { mode: 0o700 });
    await assert.rejects(provider.generate({ prompt: "test", outFile: join(dir, "other.png") }), /regular PNG/);
    assert.ok(!existsSync(join(dir, "other.png")));
    writeFileSync(binary, prefix + "console.error('SECRET PROMPT'); process.exit(1);\n", { mode: 0o700 });
    await assert.rejects(provider.generate({ prompt: "SECRET PROMPT", outFile }), (err: Error) => {
      assert.ok(!err.message.includes("SECRET PROMPT"));
      return true;
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
