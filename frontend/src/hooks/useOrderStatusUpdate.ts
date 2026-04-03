import { useState } from 'react';
import api from '@/api/axios';
import toast from 'react-hot-toast';
import { Carrier } from '@/types';

export interface ShipPayload {
  carrierId: string;
  trackingNumber: string;
}

/**
 * Shared hook for updating an order's status.
 * Handles the common pattern of PUT /orders/:id/status + optional tracking info for 'shipped'.
 * Returns `updateStatus` and an `updating` boolean.
 * `onSuccess` callback is called with the orderId after a successful update.
 */
export function useOrderStatusUpdate(onSuccess?: (orderId: string) => void) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const updateStatus = async (
    orderId: string,
    status: string,
    options?: { note?: string; shipPayload?: ShipPayload }
  ) => {
    setUpdatingId(orderId);
    try {
      const body: Record<string, unknown> = { status, note: options?.note };
      if (status === 'shipped' && options?.shipPayload) {
        body.carrierId = options.shipPayload.carrierId;
        body.trackingNumber = options.shipPayload.trackingNumber;
      }
      await api.put(`/orders/${orderId}/status`, body);
      toast.success('Order updated');
      onSuccess?.(orderId);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Update failed');
    } finally {
      setUpdatingId(null);
    }
  };

  return { updateStatus, updatingId };
}

/**
 * Fetches the list of active carriers (for ship dialogs).
 * Simple one-shot fetch — returns a promise.
 */
export async function fetchActiveCarriers(): Promise<Carrier[]> {
  try {
    const { data } = await api.get('/carriers');
    return data.data as Carrier[];
  } catch {
    return [];
  }
}
