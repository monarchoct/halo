import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
export function DataState({ loading, error, retry }: { loading?: boolean; error?: string; retry?: () => void }) {
  if (loading) return <div className="loading-grid" aria-label="Loading chain data"><Skeleton className="h-80" /><Skeleton className="h-80" /><Skeleton className="h-80" /></div>;
  return <Empty><EmptyHeader><EmptyTitle>{error ? "Data is unavailable" : "No agents here yet"}</EmptyTitle>
    <EmptyDescription>{error || "Created agents will appear here after their transactions are confirmed."}</EmptyDescription></EmptyHeader>
    {retry && <EmptyContent><Button variant="outline" onClick={retry}>Try again</Button></EmptyContent>}</Empty>;
}
