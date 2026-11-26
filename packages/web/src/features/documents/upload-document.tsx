import { MAX_UPLOAD_BYTES, UPLOAD_ACCEPT, type DocumentSummary } from '@lexica/shared';
import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUploadDocument } from './use-document-mutations';

const SUPPORTED = UPLOAD_ACCEPT.split(',');

/** Instant feedback for obvious mistakes; the API validates again and has the final say. */
function checkFile(file: File): string | undefined {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!SUPPORTED.includes(extension)) {
    return `"${file.name}" is not supported. Upload a .pdf, .md or .txt file.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) return 'The file is larger than the 20 MB upload limit.';
  return undefined;
}

function UploadStatus({
  fileName,
  progress,
  isPending,
  result,
  error,
}: {
  fileName: string;
  progress: number;
  isPending: boolean;
  result: DocumentSummary | undefined;
  error: string | undefined;
}) {
  if (isPending) {
    const sending = progress < 1;
    return (
      <div className="space-y-2" role="status" aria-live="polite">
        <p className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          {sending
            ? `Uploading ${fileName}… ${Math.round(progress * 100)}%`
            : `Indexing ${fileName}: parsing, chunking and embedding. This can take a moment.`}
        </p>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div
            className={cn('h-full bg-primary transition-[width]', !sending && 'animate-pulse')}
            style={{ width: `${Math.max(progress, 0.02) * 100}%` }}
          />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <span>
          <span className="font-medium">Upload failed.</span>{' '}
          <span className="text-muted-foreground">{error}</span>
        </span>
      </p>
    );
  }
  if (result) {
    return (
      <p role="status" className="flex items-start gap-2 text-sm">
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
        <span>
          <span className="font-medium">{result.name}</span> is indexed ({result.chunkCount}{' '}
          {result.chunkCount === 1 ? 'chunk' : 'chunks'}) and ready to query.
        </span>
      </p>
    );
  }
  return null;
}

/** Drop zone plus file picker. Uploading a file with an existing name replaces that document. */
export function UploadDocument() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [localError, setLocalError] = useState<string>();
  const upload = useUploadDocument();

  const start = (file: File | undefined) => {
    if (!file || upload.isPending) return;
    setFileName(file.name);
    upload.reset();
    const problem = checkFile(file);
    setLocalError(problem);
    if (!problem) upload.mutate(file);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    start(event.dataTransfer.files[0]);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'space-y-4 rounded-xl border border-dashed bg-card p-5 transition-colors',
        dragging && 'border-primary bg-primary/5',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Add a document</h2>
          <p className="text-sm text-muted-foreground">
            Drop a .pdf, .md or .txt file here (max 20 MB). A file with the same name replaces the
            existing document.
          </p>
        </div>
        <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          <Upload aria-hidden />
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a document to upload"
          onChange={(event) => {
            start(event.target.files?.[0]);
            event.target.value = ''; // allow picking the same file again
          }}
        />
      </div>
      <UploadStatus
        fileName={fileName}
        progress={upload.progress}
        isPending={upload.isPending}
        result={upload.data}
        error={localError ?? upload.error?.message}
      />
    </div>
  );
}
