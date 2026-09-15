import { AgentProfile } from "@/components/halo/agent-profile";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AgentProfile id={id} />; }
