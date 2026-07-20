import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "City Live | מוקד שירות",
  description: "דשבורד שיחות חי למחלקות רהיטי הסיטי",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
