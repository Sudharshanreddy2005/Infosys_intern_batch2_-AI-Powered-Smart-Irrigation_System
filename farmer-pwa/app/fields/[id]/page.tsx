"use client";

import { useParams } from "next/navigation";
import { FieldDetailsPage } from "@/components/app-pages";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <FieldDetailsPage fieldId={params.id} />;
}
