import Link from "next/link";
import type { CSSProperties } from "react";

/** Loading skeleton, error and empty states shared by every board. Skeleton cards stagger in with the site-wide reveal. */
export function DataState({ loading, error, retry, empty = "Nothing here yet", hint = "Created agents appear after their transactions are confirmed.", cards = 5 }:
  { loading?: boolean; error?: string; retry?: () => void; empty?: string; hint?: string; cards?: number }) {
  if (loading) return <div className="grid-skeleton" aria-label="Loading chain data" aria-busy="true">
    {Array.from({ length: cards }, (_, i) => <div className="skeleton reveal-up" key={i} style={{ "--i": i % 8 } as CSSProperties} />)}
  </div>;
  return <div className="empty reveal-up" role={error ? "alert" : undefined}>
    <p className="eyebrow">{error ? "Connection" : "Empty"}</p>
    <h3>{error ? "Data is unavailable" : empty}</h3>
    <p>{error || hint}</p>
    <div className="row" style={{ justifyContent: "center" }}>
      {retry && <button type="button" className="pill sm" onClick={retry}>Try again</button>}
      {!error && <Link href="/deploy" className="pill primary sm">Deploy an agent <span className="arrow" aria-hidden="true">→</span></Link>}
      {error && <Link href="/explore" className="pill ghost sm">Explore agents</Link>}
    </div>
  </div>;
}
