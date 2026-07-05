import { Suspense } from "react";
import LiffRegisterClient from "./LiffRegisterClient";

export default function LiffRegisterPage() {
  return (
    <Suspense fallback={null}>
      <LiffRegisterClient />
    </Suspense>
  );
}
