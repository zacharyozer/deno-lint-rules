/** A statically resolvable string import specifier and its reportable AST node. */
export type LiteralImportSpecifier = {
  node: Deno.lint.Node;
  value: string;
};

function astRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null) return;

  // The runtime guard establishes the only property needed for defensive AST traversal.
  return value as Readonly<Record<string, unknown>>;
}

function stringLiteral(value: unknown): LiteralImportSpecifier | undefined {
  const literal = astRecord(value);
  if (literal?.type !== "Literal" || typeof literal.value !== "string") return;

  // Visitors supply Deno AST objects; checking the Literal tag and string value narrows
  // the structurally inspected object enough to report the original node.
  return { node: value as Deno.lint.Node, value: literal.value };
}

/** Extracts string literals from static, dynamic, and type-position import nodes. */
export function extractLiteralImportSpecifier(node: unknown): LiteralImportSpecifier | undefined {
  const importNode = astRecord(node);
  if (importNode === undefined) return;

  const source = stringLiteral(importNode.source);
  if (source !== undefined) return source;

  const argument = astRecord(importNode.argument);
  if (argument?.type !== "TSLiteralType") return;

  // TemplateLiteral and every other non-Literal form are deliberately skipped, even
  // without interpolation, so every non-Literal AST form shares one silent policy.
  return stringLiteral(argument.literal);
}
