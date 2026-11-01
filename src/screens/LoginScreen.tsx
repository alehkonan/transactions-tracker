import { LoginCard } from "~/modules/auth/LoginCard";

export function LoginScreen() {
  return (
    <main className="mx-auto w-full max-w-md pt-[max(2rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] sm:py-12">
      <LoginCard />
    </main>
  );
}
