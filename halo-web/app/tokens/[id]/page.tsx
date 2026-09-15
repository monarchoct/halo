import { TokenDetail } from "@/components/halo/token-detail";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <TokenDetail id={id} />; }
