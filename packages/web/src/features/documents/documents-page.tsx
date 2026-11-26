import type { DocumentSummary, FileType } from '@lexica/shared';
import { AlertTriangle, FileText, FolderOpen } from 'lucide-react';
import { useDocuments } from './use-documents';

const fileTypeLabel: Record<FileType, string> = { pdf: 'PDF', md: 'Markdown', txt: 'Text' };

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <FolderOpen className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-base font-semibold">No documents indexed yet</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Lexica can only answer from documents it has indexed. Load the three fictional sample
        contracts by running{' '}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          npm run seed
        </code>{' '}
        in the project folder, then refresh this page. Uploading your own PDF, Markdown or text
        files is coming soon.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div>
        <p className="font-medium">Could not load documents</p>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading documents">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

function DocumentTable({ documents }: { documents: DocumentSummary[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Name
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Type
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Chunks
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Indexed
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {documents.map((doc) => (
            <tr key={doc.id}>
              <td className="px-4 py-3">
                <span className="flex items-center gap-2 font-medium">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {doc.name}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                  {fileTypeLabel[doc.fileType]}
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{doc.chunkCount}</td>
              <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                <time dateTime={doc.createdAt}>{dateFormat.format(new Date(doc.createdAt))}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocumentsPage() {
  const { data: documents, isPending, isError, error } = useDocuments();

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          The contracts Lexica searches when answering. Each document is split into chunks along its
          articles and clauses.
        </p>
      </header>

      {isPending ? (
        <LoadingRows />
      ) : isError ? (
        <ErrorState message={error.message} />
      ) : documents.length === 0 ? (
        <EmptyState />
      ) : (
        <DocumentTable documents={documents} />
      )}
    </section>
  );
}
