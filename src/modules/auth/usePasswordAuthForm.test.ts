import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigate, passwordSignIn, completeSignIn } = vi.hoisted(() => ({
  navigate: vi.fn(),
  passwordSignIn: vi.fn(),
  completeSignIn: vi.fn(),
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
vi.mock("~/modules/auth/complete-sign-in", () => ({
  completeSignIn,
  getSignInReturnPath: () => "/",
}));

import { usePasswordAuthForm } from "./usePasswordAuthForm";

describe("usePasswordAuthForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    passwordSignIn.mockResolvedValue({ id: 7, username: "replica-a" });
    completeSignIn.mockImplementation(async (_intent, finalize) => finalize(7));
    navigate.mockResolvedValue(undefined);
  });

  it("preserves the local replica after same-user sign-in", async () => {
    const form = usePasswordAuthForm("sign-in");

    await (form.onSubmit as unknown as () => Promise<void>)();

    expect(completeSignIn).toHaveBeenCalledWith("sign-in", expect.any(Function));
    expect(passwordSignIn).toHaveBeenCalledWith({
      data: { username: "replica-a", password: "correct password", expectedUserId: 7 },
    });
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });
});
