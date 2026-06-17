import {
  claimInitialAdmin,
  deleteDocument,
  getMyRole,
  ingestDocument,
  listDocuments,
  triggerFtaRefresh,
} from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeftIcon, RefreshCwIcon, ShieldIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — UAE VAT Assistant" }] }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const fetchRole = useServerFn(getMyRole);
  const fetchDocs = useServerFn(listDocuments);
  const ingestFn = useServerFn(ingestDocument);
  const deleteFn = useServerFn(deleteDocument);
  const refreshFn = useServerFn(triggerFtaRefresh);
  const claimFn = useServerFn(claimInitialAdmin);

  const role = useQuery({ queryKey: ["role"], queryFn: () => fetchRole() });
  const docs = useQuery({
    queryKey: ["docs"],
    queryFn: () => fetchDocs(),
    enabled: role.data?.isAdmin === true,
  });

  const ingest = useMutation({
    mutationFn: (vars: { title: string; content: string; sourceUrl?: string }) =>
      ingestFn({ data: { ...vars, sourceKind: "manual" } }),
    onSuccess: (r) => {
      toast.success(
        r.status === "unchanged" ? "Already up to date" : `Indexed ${r.chunks} chunks`,
      );
      qc.invalidateQueries({ queryKey: ["docs"] });
      setTitle("");
      setContent("");
      setUrl("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Ingest failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Document deleted");
      qc.invalidateQueries({ queryKey: ["docs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const refresh = useMutation({
    mutationFn: () => refreshFn({ data: {} }),
    onSuccess: (r) => {
      if (r.notConfigured) {
        toast.warning(r.message ?? "Firecrawl not connected");
        return;
      }
      const indexed = r.processed.filter((p) => p.status === "indexed").length;
      const unchanged = r.processed.filter((p) => p.status === "unchanged").length;
      const failed = r.processed.filter((p) => p.status === "failed").length;
      toast.success(`Refresh complete: ${indexed} indexed, ${unchanged} unchanged, ${failed} failed`);
      qc.invalidateQueries({ queryKey: ["docs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Refresh failed"),
  });

  const claim = useMutation({
    mutationFn: () => claimFn(),
    onSuccess: (r) => {
      if (r.claimed) {
        toast.success("You are now the admin.");
        qc.invalidateQueries({ queryKey: ["role"] });
      } else {
        toast.error("An admin already exists. Ask an existing admin to grant you access.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Claim failed"),
  });

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");

  const handleFile = async (file: File) => {
    const text = await file.text();
    setContent(text);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  if (role.isLoading) {
    return <CenteredCard>Loading admin…</CenteredCard>;
  }

  if (role.data && !role.data.isAdmin) {
    return (
      <CenteredCard>
        <ShieldIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">No admin access yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          If you are the first user, claim admin access now.
        </p>
        <Button className="mt-4" onClick={() => claim.mutate()} disabled={claim.isPending}>
          {claim.isPending ? "Claiming…" : "Claim admin access"}
        </Button>
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
        </div>
      </CenteredCard>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-base font-semibold">FTA knowledge base</h1>
            <p className="text-xs text-muted-foreground">
              Manage source documents that ground the chatbot's answers.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCwIcon className="mr-2 h-3.5 w-3.5" />
            {refresh.isPending ? "Refreshing…" : "Refresh from FTA"}
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 md:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add document</CardTitle>
            <CardDescription>
              Paste FTA text (law, regulation, clarification, guide), or upload a .txt / .md file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Executive Regulations of Federal Decree-Law No. 8 of 2017"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="url">Source URL (optional)</Label>
              <Input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://tax.gov.ae/..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">Content</Label>
              <Textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste the full document text here…"
                className="min-h-[260px] font-mono text-xs"
              />
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  id="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <Button type="button" variant="outline" size="sm" asChild>
                  <label htmlFor="file" className="cursor-pointer">
                    <UploadIcon className="mr-2 h-3.5 w-3.5" />
                    Upload .txt / .md
                  </label>
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  PDFs: convert to text first or use the FTA refresh button.
                </span>
              </div>
            </div>
            <Button
              className="w-full"
              disabled={!title.trim() || content.trim().length < 20 || ingest.isPending}
              onClick={() =>
                ingest.mutate({ title: title.trim(), content, sourceUrl: url.trim() || undefined })
              }
            >
              {ingest.isPending ? "Embedding & indexing…" : "Add to knowledge base"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Indexed documents</CardTitle>
            <CardDescription>
              {docs.data?.length ?? 0} document{(docs.data?.length ?? 0) === 1 ? "" : "s"} in the knowledge base.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {docs.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !docs.data || docs.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No documents yet. Add one on the left or run "Refresh from FTA".
              </p>
            ) : (
              <ul className="space-y-2">
                {docs.data.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          {d.source_kind}
                        </Badge>
                        <span>{d.chunk_count} chunks</span>
                        <span>· {new Date(d.updated_at).toLocaleDateString()}</span>
                        {d.source_url && (
                          <a
                            href={d.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate underline underline-offset-2 hover:text-foreground"
                          >
                            source
                          </a>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        if (confirm(`Delete "${d.title}"?`)) remove.mutate(d.id);
                      }}
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
        {children}
      </div>
    </div>
  );
}
