---
name: react-hook-form
description: Condensed reference for React Hook Form (react-hook-form.com) — useForm, register, Controller, watch/useWatch, formState, useFieldArray, FormProvider, TypeScript typing, and Zod resolver integration. This repo is already on it (`TransactionForm.tsx` / `useTransactionForm.ts`). Activate when building or modifying any form, wiring a Base UI control (Select, ToggleGroup, Combobox) into a form via Controller, or splitting form logic into focused hooks.
---

# React Hook Form (`react-hook-form`)

Installed in this repo (`react-hook-form` in `package.json`). `src/modules/transaction-form/TransactionForm.tsx` +
`useTransactionForm.ts` is the reference implementation — read those before starting a new form; the conventions section
at the bottom of this file documents the pattern they follow.

Source: https://react-hook-form.com (condensed, not verbatim).

## Install

```bash
pnpm add react-hook-form
```

## Core pattern

```tsx
type FormValues = { firstName: string; age: number };

const {
  register,
  handleSubmit,
  formState: { errors },
} = useForm<FormValues>({
  defaultValues: { firstName: "", age: 0 },
});

const onSubmit: SubmitHandler<FormValues> = (data) => {
  /* ... */
};

<form onSubmit={handleSubmit(onSubmit)}>
  <input {...register("firstName", { required: "Required" })} />
  {errors.firstName && <p>{errors.firstName.message}</p>}
  <input type="submit" />
</form>;
```

- `register(name, options)` returns `{ name, onChange, onBlur, ref }` — spread onto a **native** input/select/textarea (or
  any component that forwards `ref`). This is the default for plain HTML controls; it's uncontrolled and avoids
  re-rendering the form on every keystroke.
- `RegisterOptions`: `required`, `min`/`max`, `minLength`/`maxLength`, `pattern`, `validate`, `valueAsNumber`,
  `valueAsDate`, `setValueAs`, `disabled`, `deps` (re-validate dependent fields), and **`onChange`/`onBlur`** — extra
  callbacks that fire _in addition to_ RHF's own handler, useful for side effects tied to a field's edits (e.g. marking a
  derived field as user-touched) without hand-rolling the merge.
- `handleSubmit(onValid, onInvalid?)` validates first; `onValid` only runs when the form passes. It does **not** swallow
  errors thrown inside `onValid` — wrap in `try/catch` and call `setError` for server-side failures:

  ```tsx
  const onSubmit = handleSubmit(async (values) => {
    try {
      await save(values);
    } catch {
      setError("root", { message: "Failed to save. Please try again." });
    }
  });
  ```

## `useForm` config highlights

| Option             | Default        | Notes                                                                                                                                                                                                                                        |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`             | `'onSubmit'`   | Validation timing: `onChange`, `onBlur`, `onTouched`, `all`. `onChange` re-validates every keystroke — costs more renders.                                                                                                                   |
| `defaultValues`    | —              | Sync object or async function. Always provide one per field (an `undefined` initial value breaks `isDirty`/controlled-input tracking).                                                                                                       |
| `values`           | —              | Reactive prop for syncing form state from external/server data after mount (distinct from `defaultValues`, which is only read once unless `reset` is called).                                                                                |
| `resolver`         | —              | Plugs in schema validation (Zod, Yup, …) — see below.                                                                                                                                                                                        |
| `shouldUnregister` | `false`        | If `true`, an unmounted field's value is dropped and excluded from submission (native-`<form>`-like). Default `false` keeps values around when a field is conditionally hidden/shown, which is usually what you want in a multi-branch form. |
| `criteriaMode`     | `'firstError'` | `'all'` collects every failing rule per field instead of just the first.                                                                                                                                                                     |

## Controlled components (`Controller`)

> **Project convention:** default to `Controller` (or `useController`) for every field in this repo, not just
> non-native ones. This is a deliberate departure from upstream's "register for native inputs" guidance — it keeps every
> field wired the same way regardless of whether today's control happens to be a plain `<input>` or a Base UI primitive,
> so swapping one for the other later doesn't require rewiring the field. Reach for `register` only for a field that will
> never plausibly need `field`/`fieldState` (e.g. a hidden hardcoded value).

Anything that isn't a native input with a forwardable `ref` — Base UI's `Select`, `ToggleGroup`, a Combobox, a
third-party date picker — needs `Controller`, not `register`:

```tsx
<Controller
  control={control}
  name="accountId"
  rules={{ required: "Account is required." }}
  render={({ field, fieldState }) => (
    <>
      <Select
        value={field.value}
        onValueChange={(value) => field.onChange(value ?? "")}
        options={accountOptions}
      />
      {fieldState.error && <p>{fieldState.error.message}</p>}
    </>
  )}
/>
```

- `field`: `{ name, value, onChange, onBlur, disabled, ref }` — wire `value`/`onChange` (and `ref`, when the target
  component accepts one) into the wrapped component's own controlled-value props; the prop _names_ on the target rarely
  match `field`'s, so map them explicitly (as above, `onValueChange` ← `field.onChange`).
- `fieldState`: `{ invalid, isTouched, isDirty, error }` — scoped to this one field, so `fieldState.error` is the cleanest
  way to render a per-field error message without threading `formState.errors.<name>` through.
- Upstream's rule of thumb is "`register` for native HTML controls, `Controller` for everything else" — **in this repo,
  use `Controller`/`useController` even for native controls** (see the project-convention note above). Don't reach for
  `Controller` just to read a value reactively elsewhere in the form, though — that's `watch`/`useWatch` (below), no
  field wiring needed.

## Reading values reactively: `watch` vs `useWatch`

- `watch(name)` (a method off `useForm`'s return) re-renders **the whole form component** on every change to the watched
  field(s) — fine for a small form, wasteful once the form is split into subcomponents.
- `useWatch({ control, name })` is a hook that only re-renders _the component that calls it_. Prefer it whenever the
  reactive value is consumed by something other than the top-level form component (e.g. a derived-preview hook) — this is
  what `useAccountBalancePreview.ts` in this repo does to read `type`/`accountId`/`amount` without re-rendering
  `TransactionForm` itself.

## `formState`

`{ errors, isDirty, dirtyFields, touchedFields, isSubmitted, isSubmitSuccessful, isSubmitting, isValid, isValidating, submitCount }`.

**Gotcha:** `formState` is wrapped in a Proxy that only triggers a re-render for properties you actually _read_. Destructure
what you need (`const { errors, isSubmitting } = formState`) rather than passing the whole object around and reading off
it lazily inside JSX — an unread property won't trigger updates. `isSubmitting` flips true/false automatically around an
async `handleSubmit` callback, so it's usually all you need for a submit-button pending state — no separate `useState`.

## Imperative helpers

| Function                                                                   | Use for                                                                                       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `setValue(name, value, { shouldValidate, shouldDirty, shouldTouch })`      | Programmatic updates outside the normal input flow (e.g. mirroring one field into another).   |
| `getValues(name?)`                                                         | Read current value(s) without subscribing/re-rendering.                                       |
| `setError(name, { type, message })` — `name: "root"` for a form-wide error | Surfacing server/async failures `handleSubmit` won't catch itself.                            |
| `clearErrors(name?)`                                                       | Clear one field's error, or all.                                                              |
| `trigger(name?)`                                                           | Force (re-)validation of one/some/all fields.                                                 |
| `reset(values?, options?)`                                                 | Reset the form — call after a successful create-mode submit instead of bumping a remount key. |
| `resetField(name)`                                                         | Reset a single field to its default.                                                          |

## `useFieldArray` — dynamic lists

For a variable-length set of fields (e.g. multiple line items in one form):

```tsx
const { fields, append, remove } = useFieldArray({ control, name: "contacts" });

{
  fields.map((field, index) => <input key={field.id} {...register(`contacts.${index}.name`)} />);
}
<button type="button" onClick={() => append({ name: "" })}>
  Add
</button>;
```

`fields` items carry a stable `id` (default `keyName`) for the `key` prop — don't use the array index. Not currently used
in this repo; reach for it if a form ever needs a repeatable sub-section.

## `FormProvider` / `useFormContext`

Avoids prop-drilling `register`/`control`/etc. through several JSX layers when **one component tree** renders the whole
form:

```tsx
<FormProvider {...methods}>
  <form onSubmit={methods.handleSubmit(onSubmit)}>
    <NestedField />
  </form>
</FormProvider>;

function NestedField() {
  const { register } = useFormContext();
  return <input {...register("test")} />;
}
```

This solves a different problem than splitting a form's _hook_ into focused pieces (this repo's pattern below) — reach for
`FormProvider` only if the _markup_ itself needs to live in a separate component file, not just the state logic.

## TypeScript

```tsx
type FormValues = { firstName: string; age: number };

const form = useForm<FormValues>({ defaultValues: { firstName: "", age: 0 } });
const onSubmit: SubmitHandler<FormValues> = (data) => {
  /* data is typed */
};
```

Pass the same `<FormValues>` generic (or a narrower `Control<FormValues>`/`UseFormSetValue<FormValues>` slice) to any hook
that takes `control`/`setValue`/etc. as a param, so field names stay typo-checked everywhere.

> **When a `resolver` is passed, skip the explicit `<FormValues>` generic** — `useForm` infers field types straight from
> the resolver/schema, and hand-writing a parallel `FormValues` type just invites the two to drift:
>
> ```tsx
> const schema = z.object({ firstName: z.string().min(1) });
> const form = useForm({ resolver: zodResolver(schema) }); // no <FormValues> — inferred from schema
> ```
>
> Exception: if the schema transforms/defaults so its input and output shapes differ (e.g. `.default(...)` on a field), a
> single generic pins input and output to the same type and conflicts with the resolver. Either keep omitting the
> generic (preferred) or, if it's ever truly needed, specify all three explicitly:
> `useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema) })`.

## Schema validation (Zod)

`@hookform/resolvers` is installed. This repo's server functions still dropped their own `zod` input-validation layer
pending rework (see `CLAUDE.md`) — that's a server-side concern, separate from a form using a resolver client-side. To
validate a form against a schema:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({ firstName: z.string().min(1, "Required") });
const form = useForm({ resolver: zodResolver(schema) });
```

Check `@hookform/resolvers`'s installed version against the project's `zod` major (`^4.x` here) — Zod v4 support has had
resolver-version-dependent breakage in the past, so confirm the pairing works (typecheck + a manual submit) rather than
assuming.

## This repo's pattern

`TransactionForm.tsx` used to hold ~10 `useState` calls plus `useActionState`; it's now `useTransactionForm.ts` composing
three single-purpose hooks, each taking `control`/`setValue` as params rather than owning a `useForm` call itself:

- `useAccountBalancePreview.ts` — derives selected account(s) + projected balance via `useWatch` (read-only, no field
  writes).
- `useTransferAmountMirror.ts` — owns a `useRef` "touched" flag and calls `setValue` in a `useEffect`; exposes a
  `markToAmountTouched` callback wired into the mirrored field's `register(..., { onChange })`.
- `useTransactionFormSubmit.ts` — the actual persistence (`create`/`update` server-fn calls, `router.invalidate()`,
  closing the dialog); throws on failure so the composing hook's `onSubmit` can `setError("root", ...)`.

`TransactionForm.tsx` predates the "always `Controller`" convention pinned earlier in this file, so its native
`amount`/`toAmount`/`comment` fields still use `register` — don't take that file as license to reach for `register` on a
new form; use `Controller`/`useController` there too.

Conventions to follow for new forms:

- One `useForm` call, in the top-level `use<Feature>Form` hook — sub-hooks receive `control`/`setValue`/etc., they don't
  call `useForm` themselves.
- `Controller`/`useController` for every field, native or not (see the pinned note under "Controlled components" above).
- Field errors rendered manually from `fieldState.error?.message` — not Base UI's own `Field.Error`/`<Form errors>`
  bridge, which is built around native constraint validation and doesn't compose cleanly with RHF-driven values.
- A form-wide submit failure goes through `setError("root", { message })`, read back as `formState.errors.root?.message`.
- After a successful **create** (not edit) submit, call `reset(getDefaultFormValues(undefined))` to clear the form — no
  remount-via-key hack needed, since `Select`/`ToggleGroup` are now driven by `Controller` and pick up the reset value.
- If the form validates against a schema, pass `resolver` and skip the explicit `<FormValues>` generic (see "TypeScript"
  above).
