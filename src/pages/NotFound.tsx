import { PageContainer } from "~/components/PageContainer";

export function NotFound() {
  return (
    <PageContainer>
      <h1 className="text-text text-center text-2xl font-bold">Oops! Page not found</h1>
      <p className="text-text mt-3 text-center">
        The page you’re looking for doesn’t exist or has been moved.
      </p>
    </PageContainer>
  );
}
