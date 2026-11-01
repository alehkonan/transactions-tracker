import { PageContainer } from "~/components/PageContainer";
import { LoginCard } from "~/modules/auth/LoginCard";

export function LoginScreen() {
  return (
    <PageContainer className="pt-[max(2rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] sm:py-12">
      <main>
        <LoginCard />
      </main>
    </PageContainer>
  );
}
