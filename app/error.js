"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid min-h-screen place-items-center bg-[#F7F8FC] p-6">
      <div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
        <h2 className="text-xl font-bold">The application could not load</h2>
        <p className="mt-2 text-sm text-[#6B7280]">
          Refresh the view or try loading it again.
        </p>
        <Button className="mt-5" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
