import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "~/components/Button";
import { Card } from "~/components/Card";
import { InputControl } from "~/components/InputControl";
import { Title } from "~/components/Title";
import { PasswordAuthForm } from "~/modules/auth/PasswordAuthForm";
import { usePasskeyAuth } from "~/modules/auth/usePasskeyAuth";
import { type PasswordAuthMode, usePasswordAuthForm } from "~/modules/auth/usePasswordAuthForm";

type PasskeySignUpFormValues = {
  username: string;
};

export function LoginCard() {
  const [mode, setMode] = useState<PasswordAuthMode>("sign-in");
  const passkey = usePasskeyAuth();
  const password = usePasswordAuthForm(mode);
  const { control, handleSubmit } = useForm<PasskeySignUpFormValues>({
    defaultValues: { username: "" },
  });
  const isPending = passkey.isPending || password.isPending;
  const onPasskeySignUp = handleSubmit(({ username }) => passkey.handleSignUp(username));

  return (
    <Card>
      <div className="flex flex-col gap-4 p-3">
        <div className="flex flex-col gap-1">
          <Title variant="page">Welcome</Title>
          <p className="text-text-muted text-sm">
            Sign in with your password or passkey, or create a new account.
          </p>
        </div>

        <div className="border-border grid grid-cols-2 rounded-2xl border p-1">
          <Button
            variant={mode === "sign-in" ? "primary" : "secondary"}
            className={mode === "sign-in" ? undefined : "border-0"}
            aria-pressed={mode === "sign-in"}
            disabled={isPending}
            onClick={() => setMode("sign-in")}
          >
            Sign in
          </Button>
          <Button
            variant={mode === "sign-up" ? "primary" : "secondary"}
            className={mode === "sign-up" ? undefined : "border-0"}
            aria-pressed={mode === "sign-up"}
            disabled={isPending}
            onClick={() => setMode("sign-up")}
          >
            Create account
          </Button>
        </div>

        <PasswordAuthForm
          mode={mode}
          control={password.control}
          getValues={password.getValues}
          onSubmit={password.onSubmit}
          error={password.error}
          isPending={password.isPending}
          isDisabled={isPending}
        />

        <div className="flex items-center gap-2">
          <hr className="border-border grow" />
          <span className="text-text-muted text-xs uppercase">Passkeys</span>
          <hr className="border-border grow" />
        </div>

        {!passkey.isSupported ? (
          <p className="text-danger text-sm">
            This browser does not support passkeys. Try a recent version of Chrome, Safari, Edge, or
            Firefox over HTTPS.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <form onSubmit={onPasskeySignUp} className="flex flex-col gap-3">
              <InputControl
                control={control}
                name="username"
                label="Username for a new passkey account"
                autoComplete="username webauthn"
                placeholder="Pick a name"
                disabled={isPending}
                rules={{ required: "Pick a username to create an account." }}
                description="Shown when your device asks which passkey to use."
              />
              <Button variant="secondary" type="submit" disabled={isPending}>
                <KeyRoundIcon className="size-4" />
                Create account with a passkey
              </Button>
            </form>
            <Button variant="secondary" onClick={passkey.handleSignIn} disabled={isPending}>
              Sign in with a passkey
            </Button>
          </div>
        )}

        {passkey.error && <p className="text-danger text-sm">{passkey.error}</p>}
      </div>
    </Card>
  );
}
