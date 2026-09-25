import assert from "node:assert/strict";
import test from "node:test";
import type { TextProvider } from "@cope/providers";
import { feedItemsText, learnVoice } from "./voice.js";

const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>My Blog</title>
<item>
  <title>First post</title>
  <description><![CDATA[<p>Hello <b>world</b>, this is short and direct.</p>]]></description>
</item>
<item>
  <title>Second post</title>
  <content:encoded><![CDATA[<p>Another one, no fluff.</p>]]></content:encoded>
</item>
</channel></rss>`;

const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <title>Atom entry</title>
  <summary>Plain summary text.</summary>
</entry>
</feed>`;

test("feedItemsText extracts RSS item titles and description text", () => {
  const text = feedItemsText(rss);
  assert.match(text, /First post/);
  assert.match(text, /Hello world, this is short and direct\./);
  assert.match(text, /Second post/);
  assert.match(text, /Another one, no fluff\./);
});

test("feedItemsText falls back through content:encoded/content/description/summary", () => {
  const text = feedItemsText(atom);
  assert.match(text, /Atom entry/);
  assert.match(text, /Plain summary text\./);
});

test("feedItemsText caps the number of items", () => {
  const manyItems = `<rss><channel>${"<item><title>x</title><description>y</description></item>".repeat(20)}</channel></rss>`;
  const text = feedItemsText(manyItems, 3);
  assert.equal(text.split("---").length, 3);
});

test("learnVoice strips a fenced code block the model wraps the guide in", async () => {
  const fakeProvider: TextProvider = {
    id: "fake",
    complete: async () => ({ text: "```markdown\n# Voice Guide\ndirect, dry\n```" }),
  };
  const guide = await learnVoice([import.meta.url.replace("file://", "")], fakeProvider);
  assert.equal(guide, "# Voice Guide\ndirect, dry");
});
