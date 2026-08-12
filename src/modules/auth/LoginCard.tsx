import { KeyRoundIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { Button } from "~/components/Button";
import { Card } from "~/components/Card";
import { InputControl } from "~/components/InputControl";
import { Title } from "~/components/Title";
import { usePasskeyAuth } from "~/modules/auth/usePasskeyAuth";

type LoginFormValues = {
  username: string;
};

export function LoginCard() {
  const { isSupported, isPending, error, handleSignUp, handleSignIn } = usePasskeyAuth();
  const { control, handleSubmit } = useForm<LoginFormValues>({ defaultValues: { username: "" } });

  const onSubmit = handleSubmit(({ username }) => handleSignUp(username));

  return (
    <Card>
      <div className="flex flex-col gap-4 p-3">
        <div className="flex flex-col gap-1">
          <Title variant="page">Sign in</Title>
          <p className="text-text-muted text-sm">
            This app uses passkeys — your device unlocks it with a fingerprint, face, or PIN. There
            is no password to remember.
          </p>
        </div>

        {!isSupported ? (
          <p className="text-danger text-sm">
            This browser does not support passkeys. Try a recent version of Chrome, Safari, Edge, or
            Firefox over HTTPS.
          </p>
        ) : (
          <>
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <InputControl
                control={control}
                name="username"
                label="Username"
                // `webauthn` is what lets the browser offer an existing passkey right in this field.
                autoComplete="username webauthn"
                placeholder="Pick a name"
                rules={{ required: "Pick a username to create an account." }}
                description="Shown when your device asks which passkey to use."
              />
              <Button variant="primary" type="submit" disabled={isPending}>
                <KeyRoundIcon className="size-4" />
                Create a passkey
              </Button>
            </form>

            <div className="flex items-center gap-2">
              <hr className="border-border grow" />
              <span className="text-text-muted text-xs uppercase">or</span>
              <hr className="border-border grow" />
            </div>

            <Button variant="secondary" onClick={handleSignIn} disabled={isPending}>
              Sign in with a passkey
            </Button>
          </>
        )}

        {error && <p className="text-danger text-sm">{error}</p>}
      </div>
    </Card>
  );
}
