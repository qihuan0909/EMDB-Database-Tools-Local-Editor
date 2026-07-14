import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EMDB Local Editer",
  description: "A bilingual local workbench for uploading, editing, previewing, and exporting EMDB database ZIP files.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
