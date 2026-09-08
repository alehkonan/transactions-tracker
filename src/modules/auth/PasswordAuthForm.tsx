import { Button } from "~/components/Button";
import { InputControl } from "~/components/InputControl";
import type { FormEventHandler } from "react";
import type { Control, UseFormGetValues } from "react-hook-form";
import type { PasswordAuthFormValues, PasswordAuthMode } from "~/modules/auth/usePasswordAuthForm";

type Props = {
  mode: PasswordAuthMode;
  control: Control<PasswordAuthFormValues>;
  getValues: UseFormGetValues<PasswordAuthFormValues>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  error?: string;
  isPending: boolean;
  isDisabled: boolean;
};

export function PasswordAuthForm({
  mode,
  control,
  getValues,
  onSubmit,
  error,
  isPending,
  isDisabled,
}: Props) {
  const isSignUp = mode === "sign-up";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <InputControl
        control={control}
        name="username"
        label="Username"
        autoComplete="username"
        disabled={isDisabled}
        rules={{
          validate: (value) => value.trim().length > 0 || "Enter your username.",
        }}
      />
      <InputControl
        control={control}
        name="password"
        type="password"
        label="Password"
        autoComplete={isSignUp ? "new-password" : "current-password"}
        disabled={isDisabled}
        description={isSignUp ? "Use 12–128 characters." : undefined}
        rules={{
          required: "Enter your password.",
          minLength: { value: 12, message: "Password must be at least 12 characters." },
          maxLength: { value: 128, message: "Password must be no more than 128 characters." },
        }}
      />
      {isSignUp && (
        <InputControl
          control={control}
          name="confirmPassword"
          type="password"
          label="Confirm password"
          autoComplete="new-password"
          disabled={isDisabled}
          rules={{
            required: "Confirm your password.",
            validate: (value) => value === getValues("password") || "Passwords do not match.",
          }}
        />
      )}
      <Button variant="primary" type="submit" disabled={isDisabled}>
        {isPending
          ? isSignUp
            ? "Creating account…"
            : "Signing in…"
          : isSignUp
            ? "Create account"
            : "Sign in"}
      </Button>
      {error && <p className="text-danger text-sm">{error}</p>}
    </form>
  );
}
