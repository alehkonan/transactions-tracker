import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useCallback, useEffect, useState } from "react";
import {
  finishAddPasskey,
  listCredentials,
  removePasskey,
  startAddPasskey,
} from "~/api/auth.functions";
import { getSecurityErrorMessage, unwrapServerResponse } from "~/modules/auth/security-errors";

type Credentials = Exclude<Awaited<ReturnType<typeof listCredentials>>, Response>;

export function useSecuritySettings() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      setIsOnline(false);
      setCredentials(null);
      setIsLoading(false);
      return;
    }

    setIsOnline(true);
    setIsLoading(true);
    setError(null);
    try {
      setCredentials(await unwrapServerResponse(await listCredentials()));
    } catch (caught) {
      setCredentials(null);
      setError(getSecurityErrorMessage(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => void refresh();
    const handleOffline = () => {
      setIsOnline(false);
      setCredentials(null);
      setIsLoading(false);
      setError(null);
    };

    void refresh();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refresh]);

  const addPasskey = useCallback(async () => {
    setError(null);
    if (!browserSupportsWebAuthn()) {
      setError("Passkeys are not supported by this browser.");
      return;
    }

    setIsMutating(true);
    try {
      const optionsJSON = await unwrapServerResponse(await startAddPasskey());
      const response = await startRegistration({ optionsJSON });
      await unwrapServerResponse(await finishAddPasskey({ data: response }));
      await refresh();
    } catch (caught) {
      setError(getSecurityErrorMessage(caught));
    } finally {
      setIsMutating(false);
    }
  }, [refresh]);

  const deletePasskey = useCallback(
    async (credentialId: string) => {
      setError(null);
      setIsMutating(true);
      try {
        await unwrapServerResponse(await removePasskey({ data: { credentialId } }));
        await refresh();
      } catch (caught) {
        setError(getSecurityErrorMessage(caught));
      } finally {
        setIsMutating(false);
      }
    },
    [refresh],
  );

  return {
    credentials,
    isOnline,
    isLoading,
    isMutating,
    error,
    refresh,
    addPasskey,
    deletePasskey,
    setError,
  };
}
