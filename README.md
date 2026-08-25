# @theozer/deno-lint-rules

Default-on Deno lint rules for package boundaries across a multi-repository Deno fleet. Requires
Deno 2.2 or newer.

## Fleet-contract fit

Only F3 is a genuine per-file Deno lint rule. Its decisive input is the one
`scripts/terraform-destroy-guard.ts` file: the rule checks the strict safe-resource schema,
validated resources, identity-derived links and routing headers, exact payload fields, and the
request-size bound. It is inapplicable to other files and reports when the target file has no usable
contract, so an empty target cannot pass vacuously.

C3 and F1 inspect workflow YAML and need a whole-repository view of jobs, steps, triggers, and
cardinality. F4 compares workflow `--allow-env` declarations with environment reads reached through
the managed module graph. They do not fit a per-file AST rule. Keep those checks in a whole-tree
`deno task` that runs alongside `deno lint`; this package does not pretend that a single-file
visitor can see the other inputs.

## Adopt

### Plain repositories serving raw TypeScript

Use the default entry when repository modules are served as raw `.ts` files over HTTPS:

```json
"lint": {
  "plugins": ["jsr:@theozer/deno-lint-rules@0.4.0"]
}
```

It enables exactly these rules:

- `theozer/no-bare-cross-package-specifier` rejects bare scoped specifiers such as `@example/shared`
  in static imports and exports, literal dynamic imports, and type-position imports from publishable
  package modules. Use an explicit `jsr:` or `npm:` specifier instead.
- `theozer/no-service-relative-package-import` prevents services and apps from reaching into a
  repository's `packages/` tree by relative path through those same import forms.
- `theozer/no-unsafe-terraform-alert-payload` checks the file-local F3 Terraform alert payload
  contract when the repository contains `scripts/terraform-destroy-guard.ts`.

### Repositories publishing packages to a registry

Use the `/packages` entry when sibling packages are installed as declared registry dependencies:

```json
"lint": {
  "plugins": ["jsr:@theozer/deno-lint-rules@0.4.0/packages"]
}
```

It enables exactly these rules:

- `theozer/no-relative-cross-package-import` rejects relative specifiers in static imports and
  exports, literal dynamic imports, and type-position imports that cross from one package into
  another. Use the target package's declared registry specifier instead.
- `theozer/no-service-relative-package-import` prevents services and apps from reaching into a
  repository's `packages/` tree by relative path through those same import forms.
- `theozer/no-unsafe-terraform-alert-payload` checks the file-local F3 Terraform alert payload
  contract when the repository contains `scripts/terraform-destroy-guard.ts`.

Both entries allow relative imports that stay within the same package. They intentionally disagree
on cross-package imports: the default entry allows relative paths and rejects bare scoped
specifiers, while the `/packages` entry rejects relative paths and allows declared package
specifiers.

## Disable one rule

Keep the plugin loaded and add the rule's full diagnostic name to `lint.rules.exclude`:

```json
{
  "lint": {
    "plugins": ["jsr:@theozer/deno-lint-rules@0.4.0"],
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
