import { KeyRoundIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "~/components/Button";
import { Card } from "~/components/Card";
import { InputControl } from "~/components/InputControl";
import { Title } from "~/components/Title";
import { PasswordAuthForm } from "~/modules/auth/PasswordAuthForm";
import { usePasskeyAuth } from "~/modules/auth/usePasskeyAuth";
import { type PasswordAuthMode, usePasswordAuthForm } from "~/modules/auth/usePasswordAuthForm";

const LocalRecoveryPanel = lazy(() =>
  import("~/modules/sync/LocalRecoveryPanel").then((module) => ({
    default: module.LocalRecoveryPanel,
  })),
);
const SignOutButton = lazy(() =>
  import("~/modules/auth/SignOutButton").then((module) => ({ default: module.SignOutButton })),
);

type PasskeySignUpFormValues = {
  username: string;
};

export function LoginCard() {
  const [mode, setMode] = useState<PasswordAuthMode>("sign-in");
  const [localReplicaState, setLocalReplicaState] = useState<
    "checking" | "unbound" | "bound" | "recovery-required"
  >("checking");
  const authEnabled = localReplicaState === "unbound" || localReplicaState === "bound";
  const passkey = usePasskeyAuth(authEnabled);
  const password = usePasswordAuthForm(mode);
  const { control, handleSubmit } = useForm<PasskeySignUpFormValues>({
    defaultValues: { username: "" },
  });
  const isPending = passkey.isPending || password.isPending;
  const onPasskeySignUp = handleSubmit(({ username }) => passkey.handleSignUp(username));

  useEffect(() => {
    void import("~/modules/sync/idb")
      .then(({ readReplicaDescriptor }) => readReplicaDescriptor())
      .then((descriptor) => {
        if (descriptor.legacyOwnership.kind === "recovery-required") {
          setLocalReplicaState("recovery-required");
        } else if (descriptor.identity != null || descriptor.legacyOwnership.kind === "candidate") {
          setLocalReplicaState("bound");
        } else {
          setLocalReplicaState("unbound");
        }
        return undefined;
      })
      .catch(() => setLocalReplicaState("unbound"));
  }, []);

  if (localReplicaState === "recovery-required") {
    return (
      <Card>
        <Suspense fallback={<p className="p-4">Opening local recovery…</p>}>
          <LocalRecoveryPanel />
        </Suspense>
      </Card>
    );
  }

  const hasBoundReplica = localReplicaState === "bound";

  return (
    <Card>
      <div className="flex flex-col gap-4 p-3">
        <div className="flex flex-col gap-1">
          <Title variant="page">Welcome</Title>
          <p className="text-text-muted text-sm">
            Sign in with your password or passkey, or create a new account.
          </p>
        </div>

        {hasBoundReplica && (
          <div className="border-danger bg-danger/10 flex flex-col gap-2 rounded-xl border p-3">
            <p className="text-sm">
              This browser has a local workspace for another account. Sign in as its owner, or
              explicitly discard it before using a different account.
            </p>
            <div className="self-start">
              <Suspense fallback={null}>
                <SignOutButton />
              </Suspense>
            </div>
          </div>
        )}

        <div className="border-border grid grid-cols-2 rounded-2xl border p-1">
          <Button
            variant={mode === "sign-in" ? "primary" : "secondary"}
            className={mode === "sign-in" ? undefined : "border-0"}
            aria-pressed={mode === "sign-in"}
            data-testid="password-auth-mode-sign-in"
            disabled={isPending || localReplicaState === "checking"}
            onClick={() => setMode("sign-in")}
          >
            Sign in
          </Button>
          <Button
            variant={mode === "sign-up" ? "primary" : "secondary"}
            className={mode === "sign-up" ? undefined : "border-0"}
            aria-pressed={mode === "sign-up"}
            data-testid="password-auth-mode-sign-up"
            disabled={isPending || localReplicaState === "checking"}
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
          isDisabled={isPending || localReplicaState === "checking"}
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
                disabled={isPending || !authEnabled}
                rules={{ required: "Pick a username to create an account." }}
                description="Shown when your device asks which passkey to use."
              />
              <Button
                variant="secondary"
                type="submit"
                disabled={isPending || !authEnabled}
                data-testid="passkey-auth-sign-up"
              >
                <KeyRoundIcon className="size-4" />
                Create account with a passkey
              </Button>
            </form>
            <Button
              variant="secondary"
              onClick={passkey.handleSignIn}
              disabled={isPending || !authEnabled}
              data-testid="passkey-auth-sign-in"
            >
              Sign in with a passkey
            </Button>
          </div>
        )}

        {passkey.error && <p className="text-danger text-sm">{passkey.error}</p>}
      </div>
    </Card>
  );
}
