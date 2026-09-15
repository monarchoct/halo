export function DataState({ loading, error, retry, empty = "Nothing here yet", hint = "Created agents appear after their transactions are confirmed.", cards = 5 }:
  { loading?: boolean; error?: string; retry?: () => void; empty?: string; hint?: string; cards?: number }) {
  if (loading) return <div className="grid-skeleton" aria-label="Loading chain data" aria-busy="true">{Array.from({ length: cards }, (_, i) => <div className="skeleton" key={i} />)}</div>;
  return <div className="empty" role={error ? "alert" : undefined}><h3>{error ? "Data is unavailable" : empty}</h3><p>{error || hint}</p>
    {retry && <button type="button" className="pill sm" onClick={retry}>Try again</button>}</div>;
}
