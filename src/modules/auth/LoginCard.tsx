import { Link } from "@tanstack/react-router";
import { KeyRoundIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "~/components/Button";
import { InputControl } from "~/components/InputControl";
import { Loader } from "~/components/Loader";
import { Title } from "~/components/Title";
import { PasswordAuthForm } from "~/modules/auth/PasswordAuthForm";
import { usePasskeyAuth } from "~/modules/auth/usePasskeyAuth";
import { type PasswordAuthMode, usePasswordAuthForm } from "~/modules/auth/usePasswordAuthForm";
import { PwaRecoveryLink } from "~/modules/pwa/PwaRecoveryLink";

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
  const [localCheck, setLocalCheck] = useState(0);
  const [localReplicaState, setLocalReplicaState] = useState<
    "checking" | "unbound" | "bound" | "recovery-required" | "error"
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
      .catch(() => setLocalReplicaState("error"));
  }, [localCheck]);

  if (localReplicaState === "error") {
    return (
      <section className="bg-surface flex flex-col gap-4 rounded-lg p-4">
        <Title variant="page">Could not open local data</Title>
        <p role="alert" className="text-danger text-sm">
          Local availability could not be checked. Try again before signing in. Your local data was
          not changed.
        </p>
        <Button
          variant="primary"
          data-testid="retry-local-availability"
          onClick={() => {
            setLocalReplicaState("checking");
            setLocalCheck((attempt) => attempt + 1);
          }}
        >
          Try again
        </Button>
        <PwaRecoveryLink />
      </section>
    );
  }

  if (localReplicaState === "recovery-required") {
    return (
      <Suspense fallback={<Loader label="Opening local recovery…" />}>
        <LocalRecoveryPanel />
      </Suspense>
    );
  }

  const hasBoundReplica = localReplicaState === "bound";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Title variant="page">Welcome</Title>
        <p className="text-text-muted text-sm">
          Sign in with your password or passkey, or create a new account.
        </p>
      </div>

      {hasBoundReplica && (
        <section
          aria-label="Local workspace"
          className="bg-surface flex flex-col gap-3 rounded-lg p-4"
        >
          <p className="text-sm">
            This browser has an existing local workspace. Sign in as its owner to resume
            synchronization, or explicitly discard it before using a different account.
          </p>
          <Link
            to="/"
            data-testid="open-local-workspace"
            className="focus-visible:ring-accent flex min-h-11 items-center rounded-lg underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Continue with local data
          </Link>
          <div className="self-start">
            <Suspense fallback={null}>
              <SignOutButton />
            </Suspense>
          </div>
        </section>
      )}

      {localReplicaState === "checking" && (
        <output className="text-text-muted text-sm">Checking local availability…</output>
      )}

      <section aria-label="Password" className="bg-surface divide-border divide-y rounded-lg">
        <div className="grid grid-cols-2 gap-1 p-2">
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

        <div className="p-4">
          <PasswordAuthForm
            mode={mode}
            control={password.control}
            getValues={password.getValues}
            onSubmit={password.onSubmit}
            error={password.error}
            isPending={password.isPending}
            isDisabled={isPending || localReplicaState === "checking"}
          />
        </div>
      </section>

      <section
        aria-labelledby="passkey-heading"
        className="bg-surface divide-border divide-y rounded-lg"
      >
        <h2 id="passkey-heading" className="px-4 py-3 font-semibold">
          Passkeys
        </h2>
        <div className="flex flex-col gap-4 p-4">
          {!passkey.isSupported ? (
            <p className="text-danger text-sm">
              This browser does not support passkeys. Try a recent version of Chrome, Safari, Edge,
              or Firefox over HTTPS.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <form onSubmit={onPasskeySignUp} className="flex flex-col gap-3">
                <InputControl
                  control={control}
                  name="username"
                  label="Username for a new passkey account"
                  autoComplete="username webauthn"
                  enterKeyHint="go"
                  className="rounded-lg"
                  data-testid="passkey-auth-username"
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
                  <KeyRoundIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="whitespace-normal">Create account with a passkey</span>
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

          {passkey.isPending && (
            <output className="text-text-muted text-sm">
              Complete the passkey request on your device…
            </output>
          )}
          {passkey.error && (
            <p role="alert" className="text-danger text-sm wrap-anywhere">
              {passkey.error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
