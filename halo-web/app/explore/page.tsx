"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Board } from "@/components/halo/board";
import { DataState } from "@/components/halo/data-state";

function ExploreView() {
  const params = useSearchParams(), router = useRouter();
  const view = params.get("view") === "coins" ? "coins" : "agents";
  const parent = params.get("parent");
  return <main id="main" className="wrap page"><h1 className="sr-only">Explore</h1><Board view={view} onView={next => router.replace(next === "coins" ? "/explore?view=coins" : "/explore")} parent={parent} /></main>;
}
export default function Explore() { return <Suspense fallback={<main id="main" className="wrap page"><DataState loading /></main>}><ExploreView /></Suspense>; }
