"use client";
import { ArrowDown } from "lucide-react";
import { useProtocol } from "./protocol-provider";
export function LandingStatus() {
  const { status, statusError } = useProtocol();
  return <div className="landing-status wrap"><span><i aria-hidden="true" />{status ? status.environment === "local" ? "Local development" : status.chainName : statusError ? "Chain connection unavailable" : "Connecting to chain…"}</span><a href="#how-it-works">How HALO works <ArrowDown size={15} /></a></div>;
}
