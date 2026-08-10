# @theozer/deno-lint-rules

Default-on Deno lint rules for package boundaries across a multi-repository Deno fleet. Requires
Deno 2.2 or newer.

## Adopt

```json
"lint": {
  "plugins": ["jsr:@theozer/deno-lint-rules@0.1.0"]
}
```

Loading the plugin enables every rule:

- `theozer/no-bare-cross-package-specifier` rejects every bare scoped specifier such as
  `@example/shared` from publishable package modules. Use an explicit `jsr:` or `npm:` specifier
  instead.
- `theozer/no-service-relative-package-import` prevents services and apps from reaching into a
  repository's `packages/` tree by relative path.

## Disable one rule

Keep the plugin loaded and add the rule's full diagnostic name to `lint.rules.exclude`:

```json
{
  "lint": {
    "plugins": ["jsr:@theozer/deno-lint-rules@0.1.0"],
    "rules": {
      "exclude": ["theozer/no-service-relative-package-import"]
    }
  }
}
```

Use `theozer/no-bare-cross-package-specifier` in the same position to disable the other rule. A
single diagnostic can instead be suppressed with `// deno-lint-ignore <rule-name>` on the preceding
line.
