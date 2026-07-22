import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryClient } from "./query-client";
import { UiProvider } from "../state/ui-state";

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}><UiProvider>{children}</UiProvider></QueryClientProvider>;
}
