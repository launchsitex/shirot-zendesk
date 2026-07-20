import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "המערכת מחוברת כעת ל-Aircall באמצעות Webhook" },
    { status: 410 },
  );
}

export async function POST() {
  return NextResponse.json(
    { error: "המערכת מחוברת כעת ל-Aircall באמצעות Webhook" },
    { status: 410 },
  );
}
