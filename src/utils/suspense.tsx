import { Suspense, type ComponentType, type ReactNode } from "react";
import { Loader } from "~/components/Loader";

export const withSuspense = <P extends object>(
  Component: ComponentType<P>,
  fallback: ReactNode = <Loader />,
) => {
  const WithSuspense = (props: P) => (
    <Suspense fallback={fallback}>
      <Component {...props} />
    </Suspense>
  );

  WithSuspense.displayName = `withSuspense(${Component.displayName ?? Component.name ?? "Component"})`;

  return WithSuspense;
};
