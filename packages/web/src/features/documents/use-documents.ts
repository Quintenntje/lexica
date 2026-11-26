import { listDocumentsResponseSchema } from '@lexica/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';

/** Query key for the document list; upload and delete invalidate it. */
export const documentsQueryKey = ['documents'] as const;

/** The indexed documents, validated against the shared schema. */
export function useDocuments() {
  return useQuery({
    queryKey: documentsQueryKey,
    queryFn: async () => (await apiGet('/documents', listDocumentsResponseSchema)).documents,
  });
}
