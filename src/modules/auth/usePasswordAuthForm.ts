import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { passwordSignIn, passwordSignUp } from "~/api/auth.functions";
import { completeSignIn, getSignInReturnPath } from "~/modules/auth/complete-sign-in";
import { getPasswordAuthErrorMessage } from "~/modules/auth/password-auth-errors";

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
      await completeSignIn(mode, (expectedUserId) =>
        mode === "sign-up"
          ? passwordSignUp({ data })
          : passwordSignIn({
              data: expectedUserId == null ? data : { ...data, expectedUserId },
            }),
      );
      await navigate({ to: getSignInReturnPath(), replace: true });
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
