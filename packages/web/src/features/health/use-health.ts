import { healthResponseSchema } from '@lexica/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';

/** Polls the API health endpoint so the status indicator follows containers going up or down. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/health', healthResponseSchema),
    refetchInterval: 15_000,
    retry: false,
  });
}
