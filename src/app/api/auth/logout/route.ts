import { redirect } from "next/navigation";
import { endSession } from "@/lib/session";

export async function POST() {
  await endSession();
  redirect("/");
}
