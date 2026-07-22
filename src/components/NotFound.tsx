import { Page } from "~/components/Page";

export function NotFound() {
  return (
    <Page center>
      <div className="flex max-w-md flex-col items-center text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Oops! Page not found
        </h1>

        <p className="mt-3 text-base text-slate-600 dark:text-slate-400">
          The page you’re looking for doesn’t exist or has been moved.
        </p>
      </div>
    </Page>
  );
}
