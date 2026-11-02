import type { ReactNode } from "react";
import { siteName } from "../lib/env";

export const metadata = { title: "Ludion example" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>{siteName}</header>
        {children}
      </body>
    </html>
  );
}
