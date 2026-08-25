/** Small source-text helpers shared by the file-local Terraform alert contract check. */

export type TextBlock = { body: string; end: number };

/** Removes comments before structural checks so commented-out decoys cannot satisfy the rule. */
export function stripComments(source: string): string {
  let output = "";
  let quote: string | undefined;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quote !== undefined) {
      output += character;
      if (character === "\\" && index + 1 < source.length) output += source[++index];
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      output += character;
      continue;
    }
    if (character !== "/" || source[index + 1] === undefined) {
      output += character;
      continue;
    }
    const next = source[index + 1];
    if (next === "/") {
      output += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") index++;
      if (index < source.length) output += "\n";
      continue;
    }
    if (next === "*") {
      output += "  ";
      index += 2;
      while (index + 1 < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        output += source[index] === "\n" ? "\n" : " ";
        index++;
      }
      index++;
      continue;
    }
    output += character;
  }
  return output;
}

export function objectAfter(source: string, marker: string): TextBlock | undefined {
  const markerStart = source.indexOf(marker);
  if (markerStart < 0) return;
  const open = source.indexOf("{", markerStart + marker.length);
  if (open < 0) return;
  const close = matchingDelimiter(source, open, "{", "}");
  return close === undefined ? undefined : { body: source.slice(open + 1, close), end: close };
}

function matchingDelimiter(
  source: string,
  open: number,
  left: string,
  right: string,
): number | undefined {
  let depth = 0;
  let quote: string | undefined;
  for (let index = open; index < source.length; index++) {
    const character = source[index];
    if (quote !== undefined) {
      if (character === "\\") index++;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === left) depth++;
    if (character === right && --depth === 0) return index;
  }
  return;
}

export function simpleProperties(source: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const line of source.split("\n")) {
    const match = /^\s*(?:([A-Za-z_$][A-Za-z0-9_$]*)|["']([^"']+)["'])\s*:\s*(.*?)\s*,?\s*$/.exec(
      line,
    );
    if (match) {
      properties.set(match[1] ?? match[2], match[3].trim());
      continue;
    }
    const shorthand = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,?\s*$/.exec(line);
    if (shorthand) properties.set(shorthand[1], shorthand[1]);
  }
  return properties;
}

export function hasExactKeys(
  properties: ReadonlyMap<string, string>,
  expected: readonly string[],
): boolean {
  return properties.size === expected.length && expected.every((key) => properties.has(key));
}
