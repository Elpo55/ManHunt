"use client";
import dynamic from "next/dynamic";

/** Aperçu de développement, rendu uniquement dans le navigateur (données fictives). */
const PreviewInner = dynamic(() => import("./PreviewInner"), { ssr: false });

export default function DevPreviewPage() {
  return <PreviewInner />;
}
