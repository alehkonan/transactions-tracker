import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigate, passwordSignIn, resetLocalData } = vi.hoisted(() => ({
  navigate: vi.fn(),
  passwordSignIn: vi.fn(),
  resetLocalData: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("react", () => ({ useEffect: (effect: () => void) => effect() }));
vi.mock("react-hook-form", () => ({
  useForm: () => ({
    control: {},
    getValues: vi.fn(),
    handleSubmit:
      (
        submit: (values: {
          username: string;
          password: string;
          confirmPassword: string;
        }) => unknown,
      ) =>
      () =>
        submit({ username: " replica-a ", password: "correct password", confirmPassword: "" }),
    reset: vi.fn(),
    setError: vi.fn(),
    formState: { errors: {}, isSubmitting: false },
  }),
}));
vi.mock("~/api/auth.functions", () => ({
  passwordSignIn,
  passwordSignUp: vi.fn(),
}));
vi.mock("~/modules/auth/security-errors", () => ({
  unwrapServerResponse: (result: unknown) => result,
}));
vi.mock("~/modules/sync/sync-engine", () => ({ resetLocalData }));

import { usePasswordAuthForm } from "./usePasswordAuthForm";

describe("usePasswordAuthForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    passwordSignIn.mockResolvedValue({ id: 7, username: "replica-a" });
    resetLocalData.mockResolvedValue(undefined);
    navigate.mockResolvedValue(undefined);
  });

  it("preserves the local replica after same-user sign-in", async () => {
    const form = usePasswordAuthForm("sign-in");

    await (form.onSubmit as unknown as () => Promise<void>)();

    expect(passwordSignIn).toHaveBeenCalledWith({
      data: { username: "replica-a", password: "correct password" },
    });
    expect(resetLocalData).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });
});
