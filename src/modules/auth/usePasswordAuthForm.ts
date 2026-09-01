import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { passwordSignIn, passwordSignUp } from "~/api/auth.functions";
import { getPasswordAuthErrorMessage } from "~/modules/auth/password-auth-errors";
import { unwrapServerResponse } from "~/modules/auth/security-errors";
import { resetLocalData } from "~/modules/sync/sync-engine";

export type PasswordAuthMode = "sign-in" | "sign-up";

export type PasswordAuthFormValues = {
  username: string;
  password: string;
  confirmPassword: string;
};

export function usePasswordAuthForm(mode: PasswordAuthMode) {
  const navigate = useNavigate();
  const {
    control,
    getValues,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordAuthFormValues>({
    defaultValues: { username: "", password: "", confirmPassword: "" },
  });

  useEffect(() => {
    reset({ username: "", password: "", confirmPassword: "" });
  }, [mode, reset]);

  const onSubmit = handleSubmit(async ({ username, password }) => {
    try {
      const data = { username: username.trim(), password };
      if (mode === "sign-up") {
        await unwrapServerResponse(await passwordSignUp({ data }));
      } else {
        await unwrapServerResponse(await passwordSignIn({ data }));
      }

      await resetLocalData();
      await navigate({ to: "/", replace: true });
    } catch (caught) {
      setError("root", { message: getPasswordAuthErrorMessage(mode, caught) });
    }
  });

  return {
    control,
    getValues,
    onSubmit,
    error: errors.root?.message,
    isPending: isSubmitting,
  };
}
