import { Rubik } from "next/font/google";
import { SurveyForm } from "@/components/survey-form";

const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
});

export default async function SurveyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main
      dir="rtl"
      className={`${rubik.className} min-h-screen`}
      style={{ background: "#F0F0F0" }}
    >
      <SurveyForm token={token} />
    </main>
  );
}
