import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Static interaction inventory; actual navigation is verified in browser reviews.
const root = fileURLToPath(new URL("../../frontend/src/", import.meta.url));
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? files(path.join(dir, e.name))
          : e.name.endsWith(".jsx")
            ? [path.join(dir, e.name)]
            : [],
      ),
    )
  ).flat();
}
const items = [];
for (const file of await files(root)) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(
    /<(button|a|summary|input|select|textarea)\b/g,
  )) {
    let brace = 0,
      quote = "",
      escape = false,
      end = match.index + match[0].length;
    for (; end < source.length; end++) {
      const c = source[end];
      if (quote) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        continue;
      }
      if (c === "{") brace++;
      else if (c === "}") brace--;
      else if (c === ">" && brace === 0) break;
    }
    const tag = source.slice(match.index, end + 1);
    const item = {
      file: path.relative(root, file).replaceAll("\\", "/"),
      line: source.slice(0, match.index).split("\n").length,
      tag: match[1],
      attributes: tag.replace(/\s+/g, " "),
    };
    if (
      item.tag === "button" &&
      !/\bonClick\s*=|\btype\s*=\s*["']submit|\bform\s*=/.test(tag)
    )
      item.review = "button without direct handler or explicit submit";
    if (item.tag === "a" && !/\bhref\s*=/.test(tag))
      item.review = "anchor without href";
    if (
      /href\s*=\s*["'](?:#|javascript:)["']/.test(tag) &&
      !/onClick\s*=/.test(tag)
    )
      item.review = "placeholder link";
    items.push(item);
  }
}
const summary = {
  files: new Set(items.map((i) => i.file)).size,
  total: items.length,
  counts: Object.fromEntries(
    ["button", "a", "summary", "input", "select", "textarea"].map((tag) => [
      tag,
      items.filter((i) => i.tag === tag).length,
    ]),
  ),
  review: items.filter((i) => i.review),
};
if (process.argv[2])
  await writeFile(process.argv[2], JSON.stringify({ summary, items }, null, 2));
console.log(JSON.stringify(summary, null, 2));

process.exitCode = summary.review.length ? 1 : 0;
