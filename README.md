# @theozer/deno-lint-rules

Default-on Deno lint rules for package boundaries across a multi-repository Deno fleet. Requires
Deno 2.2 or newer.

## Fleet-contract fit

F3 is a file-local rule. Its decisive input is the one `scripts/terraform-destroy-guard.ts` file:
the rule checks the strict safe-resource schema, validated resources, identity-derived links and
routing headers, exact payload fields, and the request-size bound. It is inapplicable to other files
and reports when the target file has no usable contract, so an empty target cannot pass vacuously.

C3, F1, and F4 are also lint rules. Deno invokes a rule once per linted file, but the rule can read
the checkout; these rules therefore use one shared whole-tree analyzer and one canonical anchor:
`scripts/terraform-destroy-guard.test.ts`. Only that file emits the whole-tree diagnostics, so a
violation is reported once rather than once per linted file. C3 checks the tracked Terraform content
gate and PR plan dataflow. F1 checks one PR and one scheduled alert sender per included Terraform
root. F4 compares each sender's `--allow-env` grant with the environment names read by the guard
module graph.

The rules are genuinely inapplicable when the checkout has no included Terraform root, or when the
canonical anchor is absent or excluded from the lint invocation. In the latter case no lint rule can
execute, so repositories that lint only a narrower path must include the anchor to enable these
checks. An applicable checkout with missing or malformed workflow, sender, or module-graph evidence
fails closed rather than passing vacuously.

## Adopt

### Plain repositories serving raw TypeScript

Use the default entry when repository modules are served as raw `.ts` files over HTTPS:

```json
"lint": {
  "plugins": ["jsr:@theozer/deno-lint-rules@0.5.0"]
}
```

It enables exactly these rules:

- `theozer/no-bare-cross-package-specifier` rejects bare scoped specifiers such as `@example/shared`
  in static imports and exports, literal dynamic imports, and type-position imports from publishable
  package modules. Use an explicit `jsr:` or `npm:` specifier instead.
- `theozer/no-service-relative-package-import` prevents services and apps from reaching into a
  repository's `packages/` tree by relative path through those same import forms.
- `theozer/no-terraform-content-gate` checks the tracked Terraform content gate and pull-request
  plan dataflow from the canonical anchor.
- `theozer/no-terraform-alert-placement` checks the alert sender cardinality and root placement.
- `theozer/no-terraform-alert-env` checks exact `--allow-env` grants against the guard module graph.
- `theozer/no-unsafe-terraform-alert-payload` checks the file-local F3 Terraform alert payload
  contract when the repository contains `scripts/terraform-destroy-guard.ts`.

### Repositories publishing packages to a registry

Use the `/packages` entry when sibling packages are installed as declared registry dependencies:

```json
"lint": {
  "plugins": ["jsr:@theozer/deno-lint-rules@0.5.0/packages"]
}
```

It enables exactly these rules:

- `theozer/no-relative-cross-package-import` rejects relative specifiers in static imports and
  exports, literal dynamic imports, and type-position imports that cross from one package into
  another. Use the target package's declared registry specifier instead.
- `theozer/no-service-relative-package-import` prevents services and apps from reaching into a
  repository's `packages/` tree by relative path through those same import forms.
- `theozer/no-terraform-content-gate` checks the tracked Terraform content gate and pull-request
  plan dataflow from the canonical anchor.
- `theozer/no-terraform-alert-placement` checks the alert sender cardinality and root placement.
- `theozer/no-terraform-alert-env` checks exact `--allow-env` grants against the guard module graph.
- `theozer/no-unsafe-terraform-alert-payload` checks the file-local F3 Terraform alert payload
  contract when the repository contains `scripts/terraform-destroy-guard.ts`.

Both entries allow relative imports that stay within the same package. They intentionally disagree
on cross-package imports: the default entry allows relative paths and rejects bare scoped
specifiers, while the `/packages` entry rejects relative paths and allows declared package
specifiers.

If a repository already sets `lint.rules.include` as an explicit allowlist, add the three Terraform
rule names there as well; Deno treats that list as an opt-in filter for plugin rules. Repositories
without an explicit allowlist get every rule from the selected entry by default.

## Disable one rule

Keep the plugin loaded and add the rule's full diagnostic name to `lint.rules.exclude`:

```json
{
  "lint": {
    "plugins": ["jsr:@theozer/deno-lint-rules@0.5.0"],
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
