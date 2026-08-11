# @theozer/deno-lint-rules

Default-on Deno lint rules for package boundaries across a multi-repository Deno fleet. Requires
Deno 2.2 or newer.

## Adopt

### Plain repositories serving raw TypeScript

Use the default entry when repository modules are served as raw `.ts` files over HTTPS:

```json
"lint": {
  "plugins": ["jsr:@theozer/deno-lint-rules@0.2.0"]
}
```

It enables exactly these rules:

- `theozer/no-bare-cross-package-specifier` rejects every bare scoped specifier such as
  `@example/shared` from publishable package modules. Use an explicit `jsr:` or `npm:` specifier
  instead.
- `theozer/no-service-relative-package-import` prevents services and apps from reaching into a
  repository's `packages/` tree by relative path.

### Repositories publishing packages to a registry

Use the `/packages` entry when sibling packages are installed as declared registry dependencies:

```json
"lint": {
  "plugins": ["jsr:@theozer/deno-lint-rules@0.2.0/packages"]
}
```

It enables exactly these rules:

- `theozer/no-relative-cross-package-import` rejects relative imports that cross from one package
  into another. Use the target package's declared registry specifier instead.
- `theozer/no-service-relative-package-import` prevents services and apps from reaching into a
  repository's `packages/` tree by relative path.

Both entries allow relative imports that stay within the same package. They intentionally disagree
on cross-package imports: the default entry allows relative paths and rejects bare scoped
specifiers, while the `/packages` entry rejects relative paths and allows declared package
specifiers.

## Disable one rule

Keep the plugin loaded and add the rule's full diagnostic name to `lint.rules.exclude`:

```json
{
  "lint": {
    "plugins": ["jsr:@theozer/deno-lint-rules@0.2.0"],
    "rules": {
      "exclude": ["theozer/no-service-relative-package-import"]
    }
  }
}
```

For the default entry, use `theozer/no-bare-cross-package-specifier` in the same position to disable
its architecture-specific rule. For the `/packages` entry, use
`theozer/no-relative-cross-package-import`. A single diagnostic can instead be suppressed with
`// deno-lint-ignore <rule-name>` on the preceding line.
