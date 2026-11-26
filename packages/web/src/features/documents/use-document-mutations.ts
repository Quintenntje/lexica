import { documentSummarySchema } from '@lexica/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiUpload } from '@/lib/api-client';
import { documentsQueryKey } from './use-documents';

/**
 * Uploads a document. `progress` is the fraction of bytes sent (0–1); once it
 * reaches 1 the server is still parsing, chunking and embedding the file.
 * On success the document list is refetched.
 */
export function useUploadDocument() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: (file: File) => {
      setProgress(0);
      return apiUpload('/documents', file, documentSummarySchema, setProgress);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentsQueryKey }),
  });

  return { ...mutation, progress };
}

/** Deletes a document (all of its chunks) and refetches the document list. */
export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/documents/${encodeURIComponent(id)}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: documentsQueryKey }),
  });
}
